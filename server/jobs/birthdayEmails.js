const pool = require('../config/db');
const { notifyBirthday, notifyCeoBirthdayTomorrow, getCeoEmails } = require('../services/notifications');
const { calendarYmd, addCalendarDays, birthdayKey } = require('../utils/birthdayCalendar');

const PORTAL_STAFF = `AND COALESCE(staff_kind, 'portal') <> 'lower'`;

async function findUsersBornOn(month, day) {
  const { rows } = await pool.query(
    `
      SELECT id, name, email, employee_id, username, department, branch, date_of_birth
      FROM users
      WHERE is_active = true
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

/**
 * True if we already logged a successful send for this email type since Karachi midnight.
 * Optional subject match keeps CEO previews unique per birthday person.
 */
async function alreadySentOk({ emailType, recipient, dayKey, subject }) {
  const email = String(recipient || '')
    .trim()
    .toLowerCase();
  if (!email) return false;
  try {
    const params = [emailType, email, dayKey];
    let subjectClause = '';
    if (subject) {
      params.push(String(subject));
      subjectClause = `AND meta->>'subject' = $${params.length}`;
    }
    const { rows } = await pool.query(
      `
        SELECT 1
        FROM email_log
        WHERE email_type = $1
          AND LOWER(TRIM(recipient)) = $2
          AND (meta->>'ok') = 'true'
          AND created_at >= ($3::date AT TIME ZONE 'Asia/Karachi')
          AND created_at < (($3::date + 1) AT TIME ZONE 'Asia/Karachi')
          ${subjectClause}
        LIMIT 1
      `,
      params
    );
    return Boolean(rows[0]);
  } catch (err) {
    console.warn('[birthday-job] alreadySentOk check failed:', err.message || err);
    return false;
  }
}

async function runBirthdayEmails(now = new Date(), { catchUp = false } = {}) {
  // Midnight Karachi: employees whose birthday is today; CEO preview for tomorrow (24h notice).
  const todayKey = birthdayKey(now);
  const tomorrowPeople = await findTomorrowBirthdayUsers(now);
  const todayPeople = await findBirthdayUsers(now);
  let ceoSent = 0;
  let ceoSkipped = 0;
  let employeeSent = 0;
  let employeeSkipped = 0;
  let pushSent = 0;

  const ceoEmails = await getCeoEmails();

  for (const user of tomorrowPeople) {
    const who = user.name || user.username || `Employee ${user.id}`;
    const subject = `Tomorrow is ${who}'s birthday`;
    const selfEmail = String(user.email || '')
      .trim()
      .toLowerCase();
    const targets = ceoEmails.filter((email) => email && email !== selfEmail);
    if (!targets.length) {
      ceoSkipped += 1;
      continue;
    }

    const pending = [];
    for (const email of targets) {
      const done = await alreadySentOk({
        emailType: 'birthday_ceo_preview',
        recipient: email,
        dayKey: todayKey,
        subject,
      });
      if (!done) pending.push(email);
    }
    if (!pending.length) {
      ceoSkipped += 1;
      continue;
    }

    const result = await notifyCeoBirthdayTomorrow(user, { to: pending });
    if (result) ceoSent += 1;
  }

  for (const user of todayPeople) {
    const email = String(user.email || '')
      .trim()
      .toLowerCase();
    if (
      email &&
      (await alreadySentOk({
        emailType: 'birthday',
        recipient: email,
        dayKey: todayKey,
      }))
    ) {
      employeeSkipped += 1;
      continue;
    }

    const result = await notifyBirthday(user);
    if (result?.emailOk || result?.ok) employeeSent += 1;
    if (result?.pushOk) pushSent += 1;
  }

  console.log(
    `[birthday-job] ${new Date().toISOString()}${catchUp ? ' catch-up' : ''} ` +
      `tomorrow=${tomorrowPeople.length} ceoSent=${ceoSent} ceoSkipped=${ceoSkipped} ` +
      `today=${todayPeople.length} employeeSent=${employeeSent} employeeSkipped=${employeeSkipped} pushSent=${pushSent}`
  );
  return {
    tomorrow: tomorrowPeople.length,
    ceoSent,
    ceoSkipped,
    today: todayPeople.length,
    employeeSent,
    employeeSkipped,
    pushSent,
  };
}

module.exports = {
  findUsersBornOn,
  findBirthdayUsers,
  findTomorrowBirthdayUsers,
  runBirthdayEmails,
};
