const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function runEnsureSalesTargetsSchema() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_pin_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_pin_otp_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_pin_otp_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_pin_change_until TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_agent_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      target_amount NUMERIC(14, 2),
      achieved_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, period)
    )
  `);
  await pool.query(`
    ALTER TABLE sales_agent_targets
      ADD COLUMN IF NOT EXISTS achieved_amount NUMERIC(14, 2) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sales_agent_targets_period_idx
      ON sales_agent_targets (period, user_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_agent_daily_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      day_number SMALLINT NOT NULL CHECK (day_number >= 1 AND day_number <= 31),
      target_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      achieved_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, period, day_number)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sales_agent_daily_targets_period_idx
      ON sales_agent_daily_targets (user_id, period, day_number)
  `);
  ensured = true;
}

async function ensureSalesTargetsSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureSalesTargetsSchema().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

module.exports = { ensureSalesTargetsSchema };
