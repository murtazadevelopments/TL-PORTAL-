const pool = require('../config/db');
const { notifyBirthday, notifyCeoBirthdayTomorrow } = require('../services/notifications');
const { calendarYmd, addCalendarDays } = require('../utils/birthdayCalendar');

const PORTAL_STAFF = `AND COALESCE(staff_kind, 'portal') <> 'lower'`;

async function findUsersBornOn(month, day) {
  const { rows } = await pool.query(
    `
      SELECT id, name, email, employee_id, username, department, branch, date_of_birth
      FROM users
      WHERE is_active = true
        AND NULLIF(TRIM(email), '') IS NOT NULL
        AND date_of_birth IS NOT NULL
        ${PORTAL_STAFF}
        AND EXTRACT(MONTH FROM date_of_birth) = $1::int
        AND EXTRACT(DAY FROM date_of_birth) = $2::int
    `,
    [Number(month), Number(day)]
  );
  return rows;
}

async function findBirthdayUsers(now = new Date()) {
  const today = calendarYmd(now);
  return findUsersBornOn(today.month, today.day);
}

async function findTomorrowBirthdayUsers(now = new Date()) {
  const tomorrow = addCalendarDays(calendarYmd(now), 1);
  return findUsersBornOn(tomorrow.month, tomorrow.day);
}

async function runBirthdayEmails(now = new Date()) {
  const tomorrowPeople = await findTomorrowBirthdayUsers(now);
  const todayPeople = await findBirthdayUsers(now);
  let ceoSent = 0;
  let employeeSent = 0;

  for (const user of tomorrowPeople) {
    const result = await notifyCeoBirthdayTomorrow(user);
    if (result) ceoSent += 1;
  }

  for (const user of todayPeople) {
    const result = await notifyBirthday(user);
    if (result) employeeSent += 1;
  }

  console.log(
    `[birthday-job] ${new Date().toISOString()} tomorrow=${tomorrowPeople.length} ceoSent=${ceoSent} today=${todayPeople.length} employeeSent=${employeeSent}`
  );
  return {
    tomorrow: tomorrowPeople.length,
    ceoSent,
    today: todayPeople.length,
    employeeSent,
  };
}

module.exports = {
  findUsersBornOn,
  findBirthdayUsers,
  findTomorrowBirthdayUsers,
  runBirthdayEmails,
};
