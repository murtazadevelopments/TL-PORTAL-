const pool = require('../config/db');
const { ensureAttendanceTables } = require('../utils/attendanceSchema');
const challenges = require('../utils/remoteAttendanceChallenges');
const { notifyRemoteAttendanceCheck } = require('../services/notifications');
const { refreshAttendanceDay } = require('../utils/attendanceDays');

async function loadRemote(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, employment_type, work_start_hour, work_end_hour, is_active, status
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
      SELECT id, name, username, email, employment_type, work_start_hour, work_end_hour
      FROM users
      WHERE is_active = true
        AND status = 'active'
        AND employment_type = 'remote'
    `
  );
  let created = 0;
  for (const user of remotes) {
    const shiftDate = challenges.activeShiftDate(now, user);
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
    await challenges.markNotified(row.id, now);
    try {
      await notifyRemoteAttendanceCheck(row, row);
      sent += 1;
    } catch (err) {
      console.error('[remote-attendance] notify failed:', err.message || err);
    }
  }
  return { due: due.length, sent };
}

async function markExpiredChallenges(now = new Date()) {
  const expired = await challenges.expiredOpen(now);
  let inserted = 0;
  for (const row of expired) {
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
    const user = await loadRemote(row.user_id);
    if (user) await refreshAttendanceDay(user, row.shift_date);
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
