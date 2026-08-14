const pool = require('../config/db');
const { notifyBirthday } = require('../services/notifications');

/**
 * Find active users whose DOB month/day matches today (in APP_TIMEZONE).
 */
async function findBirthdayUsers(now = new Date()) {
  const tz = process.env.APP_TIMEZONE || 'Asia/Karachi';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!month || !day) return [];

  const { rows } = await pool.query(
    `
      SELECT id, name, email, employee_id, date_of_birth
      FROM users
      WHERE is_active = true
        AND email IS NOT NULL
        AND date_of_birth IS NOT NULL
        AND EXTRACT(MONTH FROM date_of_birth) = $1::int
        AND EXTRACT(DAY FROM date_of_birth) = $2::int
    `,
    [Number(month), Number(day)]
  );

  return rows;
}

async function runBirthdayEmails() {
  const users = await findBirthdayUsers();
  let sent = 0;
  for (const user of users) {
    const result = await notifyBirthday(user);
    if (result) sent += 1;
  }
  console.log(
    `[birthday-job] ${new Date().toISOString()} candidates=${users.length} sent=${sent}`
  );
  return { candidates: users.length, sent };
}

module.exports = {
  findBirthdayUsers,
  runBirthdayEmails,
};
