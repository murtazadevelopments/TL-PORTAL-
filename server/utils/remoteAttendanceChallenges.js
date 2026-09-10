const pool = require('../config/db');
const { normalizeEmploymentType } = require('./employmentType');
const { isSundayDateKey } = require('./workWeek');
const { workHoursFromUser } = require('./workHours');
const {
  CHECK_COUNT,
  hourKeyForSeq,
  activeShiftDate,
  currentShiftDateKey,
  planChallengeTimes,
  formatClock,
  sortRemoteChecks,
  windowsForScheduled,
  shiftBounds,
  isWithinShift,
  START_ON_TIME_MINUTES,
  LATE_AFTER_MINUTES,
  ABSENT_AFTER_MINUTES,
  RESPOND_TARGET_MINUTES,
} = require('./remoteCheckWindows');

async function ensureChallengeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_challenges (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_date          TEXT NOT NULL,
      seq                 INTEGER NOT NULL CHECK (seq BETWEEN 1 AND 5),
      kind                TEXT NOT NULL CHECK (kind IN ('start', 'random')),
      hour_key            TEXT NOT NULL,
      scheduled_at       TIMESTAMPTZ NOT NULL,
      late_at             TIMESTAMPTZ NOT NULL,
      absent_at           TIMESTAMPTZ NOT NULL,
      notified_at         TIMESTAMPTZ,
      status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'notified', 'verified', 'late', 'missed')),
      attendance_log_id  BIGINT REFERENCES attendance_logs(id) ON DELETE SET NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_challenges_user_date_seq
      ON attendance_challenges (user_id, shift_date, seq)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_challenges_user_hour_key
      ON attendance_challenges (user_id, hour_key)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS attendance_challenges_due_idx
      ON attendance_challenges (scheduled_at, status)
  `);
}

async function loadChallenges(userId, shiftDate) {
  const { rows } = await pool.query(
    `
      SELECT id, user_id, shift_date, seq, kind, hour_key,
             scheduled_at, late_at, absent_at, notified_at, status, attendance_log_id
      FROM attendance_challenges
      WHERE user_id = $1 AND shift_date = $2
      ORDER BY seq ASC
    `,
    [userId, shiftDate]
  );
  return rows;
}

async function minuteTaken(userId, at) {
  const { rows } = await pool.query(
    `
      SELECT 1
      FROM attendance_challenges
      WHERE user_id <> $1
        AND status IN ('pending', 'notified')
        AND date_trunc('minute', scheduled_at) = date_trunc('minute', $2::timestamptz)
      LIMIT 1
    `,
    [userId, at]
  );
  return Boolean(rows[0]);
}

async function insertPlan(user, shiftDate, plan) {
  const { start, end } = shiftBounds(shiftDate, user);
  for (const row of plan) {
    let at = new Date(row.scheduled_at);
    if (row.kind !== 'start') {
      if (!isWithinShift(at, start, end)) continue;
      for (let n = 0; n < 40; n += 1) {
        if (!(await minuteTaken(user.id, at))) break;
        const next = new Date(at.getTime() + 2 * 60 * 1000);
        if (!isWithinShift(next, start, end)) {
          const prev = new Date(at.getTime() - 2 * 60 * 1000);
          if (isWithinShift(prev, start, end) && !(await minuteTaken(user.id, prev))) {
            at = prev;
          }
          break;
        }
        at = next;
      }
      if (!isWithinShift(at, start, end)) continue;
    }
    const windows = windowsForScheduled(at);
    await pool.query(
      `
        INSERT INTO attendance_challenges (
          user_id, shift_date, seq, kind, hour_key,
          scheduled_at, late_at, absent_at, status
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'pending'
        WHERE NOT EXISTS (
          SELECT 1 FROM attendance_challenges
          WHERE user_id = $1 AND shift_date = $2 AND seq = $3
        )
      `,
      [
        user.id,
        shiftDate,
        row.seq,
        row.kind,
        hourKeyForSeq(shiftDate, row.seq),
        at,
        windows.late_at,
        windows.absent_at,
      ]
    );
  }
}

async function ensureChallengesForUser(user, shiftDate, now = new Date()) {
  if (normalizeEmploymentType(user.employment_type) !== 'remote') return [];
  if (isSundayDateKey(shiftDate)) {
    await pool.query(
      `
        DELETE FROM attendance_challenges
        WHERE user_id = $1
          AND shift_date = $2
          AND status IN ('pending', 'notified')
      `,
      [user.id, shiftDate]
    );
    return [];
  }
  await pool.query(
    `
      DELETE FROM attendance_challenges
      WHERE user_id = $1
        AND shift_date = $2
        AND kind = 'random'
        AND notified_at IS NULL
        AND status = 'pending'
        AND scheduled_at < $3
    `,
    [user.id, shiftDate, now]
  );
  const { start, end } = shiftBounds(shiftDate, user);
  await pool.query(
    `
      DELETE FROM attendance_challenges
      WHERE user_id = $1
        AND shift_date = $2
        AND kind = 'random'
        AND status IN ('pending', 'notified')
        AND (scheduled_at < $3 OR scheduled_at >= $4)
    `,
    [user.id, shiftDate, start, end]
  );
  const firstWindows = windowsForScheduled(start);
  await pool.query(
    `
      UPDATE attendance_challenges
      SET scheduled_at = $3, late_at = $4, absent_at = $5
      WHERE user_id = $1
        AND shift_date = $2
        AND seq = 1
        AND status IN ('pending', 'notified')
        AND scheduled_at IS DISTINCT FROM $3
    `,
    [user.id, shiftDate, start, firstWindows.late_at, firstWindows.absent_at]
  );
  const existing = await loadChallenges(user.id, shiftDate);
  if (existing.length < CHECK_COUNT) {
    const have = new Set(existing.map((r) => Number(r.seq)));
    const planned = planChallengeTimes(shiftDate, user, now, existing);
    const plan = planned.filter((row) => !have.has(Number(row.seq)));
    const futurePlan = plan.filter((row) => {
      if (row.kind === 'start') return true;
      return new Date(row.scheduled_at).getTime() >= now.getTime();
    });
    if (futurePlan.length) await insertPlan(user, shiftDate, futurePlan);
  }
  return loadChallenges(user.id, shiftDate);
}

async function realignRandomSeqs() {
  return undefined;
}

async function dropOpenChallenges(userId, shiftDate) {
  await pool.query(
    `
      DELETE FROM attendance_challenges
      WHERE user_id = $1
        AND shift_date = $2
        AND status IN ('pending', 'notified')
    `,
    [userId, shiftDate]
  );
}

function publicChallenge(row, { revealFuture = false, now = new Date() } = {}) {
  const scheduled = new Date(row.scheduled_at);
  const lateAt = new Date(row.late_at);
  const absentAt = new Date(row.absent_at);
  const opened = now.getTime() >= scheduled.getTime();
  const hidden = row.kind === 'random' && !row.notified_at && !opened && !revealFuture;
  let state = row.status;
  if (state === 'pending' || state === 'notified') {
    if (now.getTime() >= absentAt.getTime()) state = 'missed';
    else if (opened) state = now.getTime() >= lateAt.getTime() ? 'late_window' : 'open';
    else state = hidden ? 'upcoming' : 'pending';
  }
  const canCheckIn =
    (row.status === 'pending' || row.status === 'notified') &&
    opened &&
    now.getTime() < absentAt.getTime();
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    hour_key: row.hour_key,
    label: hidden
      ? `Availability check ${row.seq}`
      : row.seq === 1
        ? `Shift start (${formatClock(scheduled)})`
        : `Check ${row.seq} (${formatClock(scheduled)})`,
    scheduled_at: hidden ? null : row.scheduled_at,
    late_at: hidden ? null : row.late_at,
    absent_at: hidden ? null : row.absent_at,
    notified_at: row.notified_at,
    status: row.status,
    state,
    can_check_in: canCheckIn,
    remaining_ms: canCheckIn ? Math.max(0, absentAt.getTime() - now.getTime()) : 0,
    on_time_remaining_ms: canCheckIn ? Math.max(0, lateAt.getTime() - now.getTime()) : 0,
  };
}

function openChallenge(rows, now = new Date()) {
  const pubs = rows.map((row) => ({ row, pub: publicChallenge(row, { now }) }));
  return pubs.find((item) => item.pub.can_check_in) || null;
}

async function markChallengeResult(challenge, status, logId) {
  await pool.query(
    `
      UPDATE attendance_challenges
      SET status = $1, attendance_log_id = $2
      WHERE id = $3
        AND status IN ('pending', 'notified')
    `,
    [status, logId || null, challenge.id]
  );
}

async function dueNotifications(now = new Date()) {
  const { rows } = await pool.query(
    `
      SELECT c.*, u.name, u.username, u.email, u.employment_type
      FROM attendance_challenges c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.notified_at IS NULL
        AND c.status = 'pending'
        AND c.scheduled_at <= $1
        AND c.absent_at > $1
        AND (
          c.kind = 'start'
          OR c.scheduled_at >= $1::timestamptz - INTERVAL '5 minutes'
        )
        AND u.is_active = true
        AND u.status = 'active'
        AND u.employment_type = 'remote'
      ORDER BY c.scheduled_at ASC
      LIMIT 200
    `,
    [now]
  );
  return rows.filter((row) => !isSundayDateKey(row.shift_date));
}

async function markNotified(id, now = new Date()) {
  await pool.query(
    `
      UPDATE attendance_challenges
      SET notified_at = $2, status = 'notified'
      WHERE id = $1 AND notified_at IS NULL AND status = 'pending'
    `,
    [id, now]
  );
}

async function expiredOpen(now = new Date()) {
  const { rows } = await pool.query(
    `
      SELECT c.*, u.work_start_hour, u.work_end_hour, u.employment_type
      FROM attendance_challenges c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.status IN ('pending', 'notified')
        AND c.absent_at <= $1
        AND u.employment_type = 'remote'
      ORDER BY c.absent_at ASC
      LIMIT 400
    `,
    [now]
  );
  return rows.filter((row) => !isSundayDateKey(row.shift_date));
}

module.exports = {
  CHECK_COUNT,
  START_ON_TIME_MINUTES,
  LATE_AFTER_MINUTES,
  ABSENT_AFTER_MINUTES,
  RESPOND_TARGET_MINUTES,
  ensureChallengeTable,
  loadChallenges,
  ensureChallengesForUser,
  dropOpenChallenges,
  realignRandomSeqs,
  publicChallenge,
  openChallenge,
  markChallengeResult,
  dueNotifications,
  markNotified,
  expiredOpen,
  activeShiftDate,
  currentShiftDateKey,
  shiftBounds,
  workHoursFromUser,
  formatClock,
  sortRemoteChecks,
};
