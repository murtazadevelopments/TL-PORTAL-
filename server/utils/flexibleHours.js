const pool = require('../config/db');

const FLEXIBLE_DEFAULT_CHECK_COUNT = 3;

let ensured = false;
let ensurePromise = null;

async function ensureFlexibleHoursColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `ALTER TABLE users
           ADD COLUMN IF NOT EXISTS flexible_hours BOOLEAN NOT NULL DEFAULT false`
      )
      .then(() => {
        ensured = true;
      })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

function userFlexibleHours(user) {
  return user?.flexible_hours === true;
}

async function setUserFlexibleHours(userId, enabled) {
  await ensureFlexibleHoursColumn();
  const on = Boolean(enabled);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET flexible_hours = $2
      WHERE id = $1
      RETURNING id, flexible_hours, remote_check_count
    `,
    [userId, on]
  );
  const row = rows[0] || null;
  if (on && row) {
    const { persistRemoteCheckCount } = require('./attendanceSchema');
    await persistRemoteCheckCount(userId, FLEXIBLE_DEFAULT_CHECK_COUNT);
    row.remote_check_count = FLEXIBLE_DEFAULT_CHECK_COUNT;
  }
  return row;
}

module.exports = {
  FLEXIBLE_DEFAULT_CHECK_COUNT,
  ensureFlexibleHoursColumn,
  userFlexibleHours,
  setUserFlexibleHours,
};
