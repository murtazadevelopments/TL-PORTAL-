const pool = require('../config/db');

const STAFF_KINDS = new Set(['portal', 'lower']);

let ensured = false;

async function ensureStaffKindColumn() {
  if (ensured) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_kind TEXT;
  `);
  await pool.query(`
    UPDATE users
    SET staff_kind = 'portal'
    WHERE staff_kind IS NULL OR TRIM(staff_kind) = '';
  `);
  await pool.query(`
    ALTER TABLE users
      ALTER COLUMN staff_kind SET DEFAULT 'portal';
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_staff_kind_check'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_staff_kind_check
          CHECK (staff_kind IN ('portal', 'lower'));
      END IF;
    END $$;
  `);
  ensured = true;
}

let extraEnsured = false;

async function ensureLowerStaffExtraColumns() {
  await ensureStaffKindColumn();
  if (extraEnsured) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_kind TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_label TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_text TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_kind TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_label TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_text TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_url TEXT;
  `);
  extraEnsured = true;
}

function normalizeStaffKind(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return STAFF_KINDS.has(key) ? key : null;
}

function isLowerStaff(row) {
  return String(row?.staff_kind || '').toLowerCase() === 'lower';
}

module.exports = {
  STAFF_KINDS,
  ensureStaffKindColumn,
  ensureLowerStaffExtraColumns,
  normalizeStaffKind,
  isLowerStaff,
};
