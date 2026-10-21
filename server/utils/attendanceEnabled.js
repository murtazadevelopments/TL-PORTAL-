const pool = require('../config/db');

const ATTENDANCE_STOPPED_MESSAGE =
  'Attendance is paused for this employee. Check-in will open again when an admin turns it on.';

let ensured = false;
let ensurePromise = null;

async function ensureAttendanceEnabledColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `ALTER TABLE users
           ADD COLUMN IF NOT EXISTS attendance_enabled BOOLEAN NOT NULL DEFAULT true`
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

function userAttendanceEnabled(user) {
  return user?.attendance_enabled !== false;
}

async function isUserAttendanceEnabled(userId) {
  await ensureAttendanceEnabledColumn();
  const { rows } = await pool.query(
    `SELECT attendance_enabled FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (!rows[0]) return true;
  return rows[0].attendance_enabled !== false;
}

async function setUserAttendanceEnabled(userId, enabled) {
  await ensureAttendanceEnabledColumn();
  const { rows } = await pool.query(
    `
      UPDATE users
      SET attendance_enabled = $2
      WHERE id = $1
      RETURNING id, attendance_enabled
    `,
    [userId, Boolean(enabled)]
  );
  return rows[0] || null;
}

async function rejectIfUserAttendanceStopped(res, user) {
  if (userAttendanceEnabled(user)) return false;
  res.status(403).json({
    code: 'ATTENDANCE_STOPPED',
    message: ATTENDANCE_STOPPED_MESSAGE,
  });
  return true;
}

module.exports = {
  ATTENDANCE_STOPPED_MESSAGE,
  ensureAttendanceEnabledColumn,
  userAttendanceEnabled,
  isUserAttendanceEnabled,
  setUserAttendanceEnabled,
  rejectIfUserAttendanceStopped,
};
