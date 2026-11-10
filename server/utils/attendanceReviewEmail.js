const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function ensureAttendanceReviewEmailColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS attendance_review_email_at TIMESTAMPTZ
        `
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

/** Disabled: "Your attendance was reviewed" emails are not sent to anyone. */
async function notifyRemoteAttendanceOpened() {
  return { sent: false, reason: 'disabled' };
}

module.exports = {
  ensureAttendanceReviewEmailColumn,
  notifyRemoteAttendanceOpened,
};
