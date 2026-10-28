const pool = require('../config/db');
const { ensureAttendanceTables } = require('../utils/attendanceSchema');
const challenges = require('../utils/remoteAttendanceChallenges');
const { notifyRemoteAttendanceCheck } = require('../services/notifications');
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

async function dispatchDueNotifications(now = new Date()) {
  const due = await challenges.dueNotifications(now);
  let sent = 0;
  for (const row of due) {
    const person = await loadRemote(row.user_id);
    if (isRemoteProfileIncomplete(person)) continue;
    if (row.kind === 'random' || row.kind === 'checkout') {
      const { findOpenBreak } = require('../utils/breakHours');
      if (await findOpenBreak(row.user_id)) continue;
    }
    const isFirstCheck = row.kind === 'start' || Number(row.seq) === 1;
    const isRandom = row.kind === 'random' || (!isFirstCheck && row.kind !== 'checkout');
    // Flexible staff start work on their own — no first check-in email/push from the portal.
    if (isFirstCheck && userFlexibleHours(person)) {
      await challenges.markNotified(row.id, now);
      continue;
    }
    // Auto reminder off: open the random check in the portal, but send no email/push.
    if (isRandom && !userAutoReminder(person)) {
      await challenges.markNotified(row.id, now);
      continue;
    }
    const claimed = await challenges.markNotified(row.id, now);
    if (!claimed) continue;
    try {
      const result = await notifyRemoteAttendanceCheck(person, row);
      if (!result?.ok) {
        await challenges.clearNotifiedIfUnused(row.id);
        continue;
      }
      sent += 1;
    } catch (err) {
      await challenges.clearNotifiedIfUnused(row.id);
      console.error('[remote-attendance] notify failed:', err.message || err);
    }
  }
  return { due: due.length, sent };
}

async function markExpiredChallenges(now = new Date()) {
  const expired = await challenges.expiredOpen(now);
  let inserted = 0;
  for (const row of expired) {
    const person = await loadRemote(row.user_id);
    if (isRemoteProfileIncomplete(person)) continue;
    if (row.kind === 'random' || row.kind === 'checkout') {
      const { findOpenBreak } = require('../utils/breakHours');
      if (await findOpenBreak(row.user_id)) continue;
    }
    const result = await pool.query(
      `
        INSERT INTO attendance_logs (
          user_id, checked_in_at, hour_key, match_score, method, status, note
        )
        SELECT $1, NOW(), $2, NULL, 'face', 'missed', 'No check-in within 40 minutes'
        WHERE NOT EXISTS (
          SELECT 1 FROM attendance_logs
          WHERE user_id = $1 AND hour_key = $2
            AND (status IN ('verified', 'missed', 'late', 'leave') OR method = 'manual')
        )
        RETURNING id
      `,
      [row.user_id, row.hour_key]
    );
    const logId = result.rows[0]?.id || null;
    inserted += result.rowCount || 0;
    await challenges.markChallengeResult(row, 'missed', logId);
    if (person) await refreshAttendanceDay(person, row.shift_date);
  }
  return { expired: expired.length, inserted };
}

async function runRemoteAttendanceTick(now = new Date()) {
  await ensureAttendanceTables();
  const ensured = await ensureActiveShiftChallenges(now);
  const notified = await dispatchDueNotifications(now);
  const missed = await markExpiredChallenges(now);
  return { ...ensured, ...notified, ...missed };
}

module.exports = {
  runRemoteAttendanceTick,
  ensureActiveShiftChallenges,
};
