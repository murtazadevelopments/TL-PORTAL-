const pool = require('../config/db');
const { ensureAttendanceTables } = require('../utils/attendanceSchema');
const challenges = require('../utils/remoteAttendanceChallenges');
const { enqueueAttendanceReminder } = require('../services/notificationOutbox');
const { refreshAttendanceDay } = require('../utils/attendanceDays');
const { isRemoteProfileIncomplete } = require('../utils/profileCompleteness');
const { userFlexibleHours } = require('../utils/flexibleHours');
const { userAutoReminder } = require('../utils/autoReminder');

async function loadRemote(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, employment_type, work_start_hour, work_end_hour, is_active, status,
             remote_check_count, flexible_hours, auto_reminder, six_day_week, work_days, employee_id, department, designation, branch, shift,
             staff_kind, reference_person, emergency_contact_name, emergency_contact_number,
             bank_name, account_title, iban, account_number,
             profile_picture_url, cnic_front_url, cnic_back_url, cv_url
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function ensureActiveShiftChallenges(now = new Date()) {
  const { rows: remotes } = await pool.query(
    `
      SELECT id, name, username, email, employee_id, employment_type, work_start_hour, work_end_hour,
             remote_check_count, flexible_hours, auto_reminder, six_day_week, work_days, department, designation, branch, shift, staff_kind,
             status, reference_person, emergency_contact_name, emergency_contact_number,
             bank_name, account_title, iban, account_number,
             profile_picture_url, cnic_front_url, cnic_back_url, cv_url
      FROM users
      WHERE is_active = true
        AND status = 'active'
        AND employment_type = 'remote'
        AND COALESCE(attendance_enabled, true) = true
    `
  );
  let created = 0;
  for (const user of remotes) {
    const shiftDate = challenges.activeShiftDate(now, user);
    if (isRemoteProfileIncomplete(user)) {
      if (shiftDate) {
        await pool.query(
          `
            DELETE FROM attendance_challenges
            WHERE user_id = $1
              AND shift_date = $2
              AND status IN ('pending', 'notified')
          `,
          [user.id, shiftDate]
        );
      }
      continue;
    }
    if (!shiftDate) continue;
    const before = await challenges.loadChallenges(user.id, shiftDate);
    const rows = await challenges.ensureChallengesForUser(user, shiftDate);
    if (rows.length && rows.length !== before.length) created += rows.length - before.length;
  }
  return { remotes: remotes.length, created };
}

function stepMs(label, started) {
  const ms = Date.now() - started;
  console.log(`[attendance-missed] step ${label} ${ms}ms`);
  return ms;
}

async function runStep(label, fn, fallback) {
  const started = Date.now();
  try {
    const result = await fn();
    stepMs(label, started);
    return result;
  } catch (err) {
    console.error(`[attendance-missed] step ${label} failed:`, err.message || err);
    stepMs(label, started);
    return fallback;
  }
}

/**
 * One round trip: anything due, expiring, or missing today's/yesterday's challenge rows.
 * Holiday cleanup and schedule realignment still run when this is non-idle.
 */
async function probeAttendanceWork(now) {
  const { rows } = await pool.query(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM attendance_challenges c
          JOIN users u ON u.id = c.user_id
          WHERE c.notified_at IS NULL
            AND c.status = 'pending'
            AND c.scheduled_at <= $1
            AND c.absent_at > $1
            AND u.is_active = true
            AND u.status = 'active'
            AND u.employment_type = 'remote'
            AND COALESCE(u.attendance_enabled, true) = true
        ) AS due,
        EXISTS (
          SELECT 1
          FROM attendance_challenges c
          JOIN users u ON u.id = c.user_id
          WHERE c.status IN ('pending', 'notified')
            AND c.absent_at <= $1
            AND u.employment_type = 'remote'
            AND COALESCE(u.attendance_enabled, true) = true
        ) AS expired,
        EXISTS (
          SELECT 1
          FROM users u
          WHERE u.is_active = true
            AND u.status = 'active'
            AND u.employment_type = 'remote'
            AND COALESCE(u.attendance_enabled, true) = true
            AND NOT EXISTS (
              SELECT 1
              FROM attendance_challenges c
              WHERE c.user_id = u.id
                AND c.shift_date IN (
                  to_char(NOW() AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD'),
                  to_char((NOW() AT TIME ZONE 'Asia/Karachi') - INTERVAL '1 day', 'YYYY-MM-DD')
                )
            )
        ) AS needs_challenges,
        EXISTS (
          SELECT 1
          FROM users u
          WHERE u.is_active = true
            AND u.status = 'active'
            AND u.employment_type = 'remote'
            AND COALESCE(u.attendance_enabled, true) = true
            AND u.updated_at > NOW() - INTERVAL '2 minutes'
        ) AS recent_edit
    `,
    [now]
  );
  return rows[0] || { due: false, expired: false, needs_challenges: false, recent_edit: false };
}

async function loadRemotesByIds(ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, employment_type, work_start_hour, work_end_hour, is_active, status,
             remote_check_count, flexible_hours, auto_reminder, six_day_week, work_days, employee_id, department, designation, branch, shift,
             staff_kind, reference_person, emergency_contact_name, emergency_contact_number,
             bank_name, account_title, iban, account_number,
             profile_picture_url, cnic_front_url, cnic_back_url, cv_url
      FROM users
      WHERE id = ANY($1::int[])
    `,
    [ids]
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
}

async function dispatchDueNotifications(now = new Date()) {
  const due = await challenges.dueNotifications(now);
  const people = await loadRemotesByIds([...new Set(due.map((row) => Number(row.user_id)))]);
  const breakIds = await openBreakUserIds(due.map((row) => row.user_id));
  let sent = 0;
  for (const row of due) {
    const person = people.get(Number(row.user_id)) || null;
    if (isRemoteProfileIncomplete(person)) continue;
    if ((row.kind === 'random' || row.kind === 'checkout') && breakIds.has(Number(row.user_id))) {
      continue;
    }
    const isFirstCheck = row.kind === 'start' || Number(row.seq) === 1;
    const isRandom = row.kind === 'random' || (!isFirstCheck && row.kind !== 'checkout');
    if (isFirstCheck && userFlexibleHours(person)) {
      await challenges.markNotified(row.id, now);
      continue;
    }
    if (isRandom && !userAutoReminder(person)) {
      await challenges.markNotified(row.id, now);
      continue;
    }
    try {
      const queued = await enqueueAttendanceReminder(person, row, now);
      if (queued.queued) sent += 1;
    } catch (err) {
      console.error('[remote-attendance] enqueue failed:', err.message || err);
    }
  }
  return { due: due.length, sent };
}

async function openBreakUserIds(userIds) {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isFinite(id)))];
  if (!ids.length) return new Set();
  const { rows } = await pool.query(
    `
      SELECT DISTINCT user_id
      FROM attendance_breaks
      WHERE ended_at IS NULL
        AND user_id = ANY($1::int[])
    `,
    [ids]
  );
  return new Set(rows.map((row) => Number(row.user_id)));
}

async function markExpiredChallenges(now = new Date()) {
  const expired = await challenges.expiredOpen(now);
  const people = await loadRemotesByIds([...new Set(expired.map((row) => Number(row.user_id)))]);
  const breakIds = await openBreakUserIds(expired.map((row) => row.user_id));
  const actionable = [];
  for (const row of expired) {
    const person = people.get(Number(row.user_id)) || null;
    if (isRemoteProfileIncomplete(person)) continue;
    if ((row.kind === 'random' || row.kind === 'checkout') && breakIds.has(Number(row.user_id))) {
      continue;
    }
    actionable.push({ row, person });
  }
  if (!actionable.length) return { expired: expired.length, inserted: 0 };

  const userIds = actionable.map((item) => item.row.user_id);
  const hourKeys = actionable.map((item) => item.row.hour_key);
  const inserted = await pool.query(
    `
      INSERT INTO attendance_logs (
        user_id, checked_in_at, hour_key, match_score, method, status, note
      )
      SELECT x.user_id, NOW(), x.hour_key, NULL, 'face', 'missed', 'No check-in within 40 minutes'
      FROM UNNEST($1::int[], $2::text[]) AS x(user_id, hour_key)
      WHERE NOT EXISTS (
        SELECT 1 FROM attendance_logs l
        WHERE l.user_id = x.user_id
          AND l.hour_key = x.hour_key
          AND (l.status IN ('verified', 'missed', 'late', 'leave') OR l.method = 'manual')
      )
      RETURNING id, user_id, hour_key
    `,
    [userIds, hourKeys]
  );
  const logByKey = new Map(
    inserted.rows.map((row) => [`${row.user_id}:${row.hour_key}`, row.id])
  );
  await Promise.all(
    actionable.map(async (item) => {
      const logId = logByKey.get(`${item.row.user_id}:${item.row.hour_key}`) || null;
      await challenges.markChallengeResult(item.row, 'missed', logId);
      if (item.person) await refreshAttendanceDay(item.person, item.row.shift_date);
    })
  );
  return { expired: expired.length, inserted: inserted.rowCount || 0 };
}

async function runRemoteAttendanceTick(now = new Date()) {
  const started = Date.now();
  await runStep('schema', () => ensureAttendanceTables(), null);

  const probe = await runStep('probe', () => probeAttendanceWork(now), null);
  const idle =
    probe && !probe.due && !probe.expired && !probe.needs_challenges && !probe.recent_edit;
  if (idle) {
    console.log(`[attendance-missed] idle ${Date.now() - started}ms`);
    return { remotes: 0, created: 0, due: 0, sent: 0, expired: 0, inserted: 0 };
  }

  // A failed probe must not skip reminders or expiry.
  const runEnsure = !probe || probe.needs_challenges || probe.recent_edit;
  const runNotify = !probe || probe.due;
  const runExpire = !probe || probe.expired;

  const [ensured, notified, missed] = await Promise.all([
    runEnsure
      ? runStep('ensure', () => ensureActiveShiftChallenges(now), { remotes: 0, created: 0 })
      : Promise.resolve({ remotes: 0, created: 0 }),
    runNotify
      ? runStep('notify', () => dispatchDueNotifications(now), { due: 0, sent: 0 })
      : Promise.resolve({ due: 0, sent: 0 }),
    runExpire
      ? runStep('expire', () => markExpiredChallenges(now), { expired: 0, inserted: 0 })
      : Promise.resolve({ expired: 0, inserted: 0 }),
  ]);
  console.log(`[attendance-missed] total ${Date.now() - started}ms`);
  return { ...ensured, ...notified, ...missed };
}

module.exports = {
  runRemoteAttendanceTick,
  ensureActiveShiftChallenges,
};
