-- Petty cash item fields: name, price, quantity, branch, person, status, receipt.
-- Safe to re-run.

BEGIN;

ALTER TABLE petty_cash_entries
  ADD COLUMN IF NOT EXISTS item_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS price NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS person_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS receipt_path TEXT,
  ADD COLUMN IF NOT EXISTS receipt_mime TEXT;

UPDATE petty_cash_entries
SET
  item_name = COALESCE(NULLIF(BTRIM(item_name), ''), NULLIF(BTRIM(description), ''), 'Item'),
  price = COALESCE(price, amount, 0),
  status = CASE
    WHEN status IN ('pending', 'used') THEN status
    WHEN direction = 'in' THEN 'pending'
    ELSE 'used'
  END
WHERE TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'petty_cash_entries_status_check'
  ) THEN
    ALTER TABLE petty_cash_entries
      ADD CONSTRAINT petty_cash_entries_status_check
      CHECK (status IN ('pending', 'used'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS petty_cash_entries_owner_status_idx
  ON petty_cash_entries (owner_user_id, status, id DESC);

COMMIT;
