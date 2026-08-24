const pool = require('../config/db');

const EMPLOYMENT_TYPES = new Set(['onsite', 'remote']);

let ensured = false;

async function ensureEmploymentTypeColumn() {
  if (ensured) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT;
  `);
  await pool.query(`
    UPDATE users
    SET employment_type = 'onsite'
    WHERE employment_type IS NULL OR TRIM(employment_type) = '';
  `);
  await pool.query(`
    ALTER TABLE users
      ALTER COLUMN employment_type SET DEFAULT 'onsite';
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_employment_type_check'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_employment_type_check
          CHECK (employment_type IN ('onsite', 'remote'));
      END IF;
    END $$;
  `);
  ensured = true;
}

function normalizeEmploymentType(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return EMPLOYMENT_TYPES.has(key) ? key : null;
}

module.exports = {
  EMPLOYMENT_TYPES,
  ensureEmploymentTypeColumn,
  normalizeEmploymentType,
};
