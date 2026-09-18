/**
 * Local birthday flow test: employee same-day email + CEO day-before email.
 * Usage: node scripts/test-birthday.js <userId-or-username> [--set-today]
 */
const pool = require('../config/db');
const { notifyBirthday, notifyCeoBirthdayTomorrow } = require('../services/notifications');
const { calendarYmd } = require('../utils/birthdayCalendar');

async function main() {
  const ident = process.argv[2];
  const setToday = process.argv.includes('--set-today');
  if (!ident) {
    console.error('Usage: node scripts/test-birthday.js <userId-or-username> [--set-today]');
    process.exit(1);
  }

  const byId = /^\d+$/.test(ident);
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, employee_id, department, branch,
             date_of_birth::text AS date_of_birth, role
      FROM users
      WHERE ${byId ? 'id = $1' : 'LOWER(username) = LOWER($1)'}
      LIMIT 1
    `,
    [byId ? Number(ident) : ident]
  );
  const user = rows[0];
  if (!user) {
    console.error('User not found.');
    process.exit(1);
  }

  const originalDob = user.date_of_birth;
  if (setToday) {
    const today = calendarYmd();
    const year = Number(String(originalDob).slice(0, 4));
    const safeYear = Number.isFinite(year) && year > 1900 ? year : today.year - 25;
    const nextDob = `${safeYear}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    await pool.query(`UPDATE users SET date_of_birth = $1::date, updated_at = NOW() WHERE id = $2`, [
      nextDob,
      user.id,
    ]);
    user.date_of_birth = nextDob;
    console.log(`Set date_of_birth to ${nextDob} (was ${originalDob || 'null'}) so the dashboard overlay can show.`);
    console.log(`Restore later: UPDATE users SET date_of_birth = ${originalDob ? `'${String(originalDob).slice(0, 10)}'` : 'NULL'} WHERE id = ${user.id};`);
  }

  console.log(
    `Testing birthday emails for ${user.name} (@${user.username}, id=${user.id}) employee=${user.email}`
  );
  const employee = await notifyBirthday(user);
  const ceo = await notifyCeoBirthdayTomorrow(user, { includeBirthdayPerson: true });
  console.log(`Employee email: ${employee ? 'sent' : 'failed/skipped'}`);
  console.log(`CEO reminder: ${ceo ? 'sent' : 'failed/skipped'}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
