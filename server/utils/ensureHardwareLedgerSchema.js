const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function runEnsureHardwareLedgerSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hardware_vendors (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hardware_vendors_name_lower_idx
      ON hardware_vendors (LOWER(name))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hardware_vendor_records (
      id          BIGSERIAL PRIMARY KEY,
      vendor_id   BIGINT NOT NULL REFERENCES hardware_vendors(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL CHECK (kind IN ('total', 'paid')),
      amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE hardware_vendor_records
      ADD COLUMN IF NOT EXISTS item TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS hardware_vendor_records_vendor_occurred_idx
      ON hardware_vendor_records (vendor_id, occurred_at DESC, id DESC)
  `);

  ensured = true;
}

async function ensureHardwareLedgerSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureHardwareLedgerSchema().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

module.exports = { ensureHardwareLedgerSchema };
