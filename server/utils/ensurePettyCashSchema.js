const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function runEnsurePettyCashSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_entries (
      id            BIGSERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_date    DATE NOT NULL DEFAULT (CURRENT_DATE),
      direction     TEXT,
      amount        NUMERIC(14, 2),
      description   TEXT NOT NULL DEFAULT '',
      item_name     TEXT NOT NULL DEFAULT '',
      price         NUMERIC(14, 2),
      quantity      NUMERIC(12, 2),
      branch        TEXT,
      person_name   TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      receipt_path  TEXT,
      receipt_mime  TEXT,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_funds (
      owner_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      total_amount  NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
      updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE petty_cash_entries
      ADD COLUMN IF NOT EXISTS item_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS price NUMERIC(14, 2),
      ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS branch TEXT,
      ADD COLUMN IF NOT EXISTS person_name TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS receipt_path TEXT,
      ADD COLUMN IF NOT EXISTS receipt_mime TEXT,
      ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ
  `);

  await pool.query(`
    UPDATE petty_cash_entries
    SET occurred_at = COALESCE(occurred_at, created_at, NOW())
    WHERE occurred_at IS NULL
  `);

  await pool.query(`
    ALTER TABLE petty_cash_entries
      ALTER COLUMN occurred_at SET DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE petty_cash_entries
    SET occurred_at = COALESCE(occurred_at, NOW())
    WHERE occurred_at IS NULL
  `);

  await pool.query(`
    DO $occ$
    BEGIN
      BEGIN
        ALTER TABLE petty_cash_entries ALTER COLUMN occurred_at SET NOT NULL;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END
    $occ$;
  `);

  await pool.query(`
    UPDATE petty_cash_entries
    SET
      item_name = COALESCE(NULLIF(BTRIM(item_name), ''), NULLIF(BTRIM(description), ''), 'Item'),
      price = COALESCE(price, amount, 0),
      status = CASE
        WHEN status IN ('pending', 'used') THEN status
        WHEN direction = 'in' THEN 'pending'
        ELSE COALESCE(NULLIF(status, ''), 'pending')
      END
  `);

  await pool.query(`
    DO $chk$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'petty_cash_entries_status_check'
      ) THEN
        ALTER TABLE petty_cash_entries
          ADD CONSTRAINT petty_cash_entries_status_check
          CHECK (status IN ('pending', 'used'));
      END IF;
    END
    $chk$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS petty_cash_entries_owner_date_idx
      ON petty_cash_entries (owner_user_id, entry_date DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS petty_cash_entries_owner_status_idx
      ON petty_cash_entries (owner_user_id, status, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS petty_cash_entries_owner_occurred_idx
      ON petty_cash_entries (owner_user_id, occurred_at DESC, id DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_fund_additions (
      id            BIGSERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount        NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS petty_cash_fund_additions_owner_occurred_idx
      ON petty_cash_fund_additions (owner_user_id, occurred_at DESC, id DESC)
  `);

  await pool.query(`
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
      )
  `);

  ensured = true;
}

async function ensurePettyCashSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsurePettyCashSchema().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

module.exports = { ensurePettyCashSchema };
