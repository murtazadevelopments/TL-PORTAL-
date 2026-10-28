const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function ensureAutoReminderColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `ALTER TABLE users
           ADD COLUMN IF NOT EXISTS auto_reminder BOOLEAN NOT NULL DEFAULT true`
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

/** Default on so existing remote staff keep random check-in emails. */
function userAutoReminder(user) {
  return user?.auto_reminder !== false;
}

async function setUserAutoReminder(userId, enabled) {
  await ensureAutoReminderColumn();
  const on = Boolean(enabled);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET auto_reminder = $2
      WHERE id = $1
      RETURNING id, auto_reminder
    `,
    [userId, on]
  );
  return rows[0] || null;
}

module.exports = {
  ensureAutoReminderColumn,
  userAutoReminder,
  setUserAutoReminder,
};
