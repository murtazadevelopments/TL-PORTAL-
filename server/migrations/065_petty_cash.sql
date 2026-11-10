-- Personal petty cash ledgers. Rows belong to the assigned person (owner_user_id).
-- Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS petty_cash_entries (
  id            BIGSERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date    DATE NOT NULL DEFAULT (CURRENT_DATE),
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount        NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  description   TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS petty_cash_entries_owner_date_idx
  ON petty_cash_entries (owner_user_id, entry_date DESC, id DESC);

COMMIT;
