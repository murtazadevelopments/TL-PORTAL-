-- History of amounts added to petty cash total (additive).
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS petty_cash_fund_additions (
  id            BIGSERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS petty_cash_fund_additions_owner_occurred_idx
  ON petty_cash_fund_additions (owner_user_id, occurred_at DESC, id DESC);

-- Backfill one history row from existing fund totals (once per owner).
INSERT INTO petty_cash_fund_additions (owner_user_id, amount, occurred_at, created_by)
SELECT
  f.owner_user_id,
  f.total_amount,
  COALESCE(f.updated_at, NOW()),
  f.updated_by
FROM petty_cash_funds f
WHERE f.total_amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM petty_cash_fund_additions a
    WHERE a.owner_user_id = f.owner_user_id
  );

COMMIT;
