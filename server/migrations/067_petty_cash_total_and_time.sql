-- Settable total amount per assignee + editable occurred_at on each item.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS petty_cash_funds (
  owner_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_amount  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE petty_cash_entries
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

UPDATE petty_cash_entries
SET occurred_at = COALESCE(occurred_at, created_at, NOW())
WHERE occurred_at IS NULL;

ALTER TABLE petty_cash_entries
  ALTER COLUMN occurred_at SET DEFAULT NOW();

UPDATE petty_cash_entries
SET occurred_at = COALESCE(occurred_at, NOW())
WHERE occurred_at IS NULL;

ALTER TABLE petty_cash_entries
  ALTER COLUMN occurred_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS petty_cash_entries_owner_occurred_idx
  ON petty_cash_entries (owner_user_id, occurred_at DESC, id DESC);

COMMIT;
