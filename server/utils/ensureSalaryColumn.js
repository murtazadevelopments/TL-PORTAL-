const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function runEnsureSalaryColumn() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS salary NUMERIC;
  `);
  ensured = true;
}

async function ensureSalaryColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureSalaryColumn().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

module.exports = { ensureSalaryColumn };
