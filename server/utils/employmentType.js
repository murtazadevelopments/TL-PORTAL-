const pool = require('../config/db');

const EMPLOYMENT_TYPES = new Set(['onsite', 'remote']);

let ensured = false;

async function ensureEmploymentTypeColumn() {
  if (ensured) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT;
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
