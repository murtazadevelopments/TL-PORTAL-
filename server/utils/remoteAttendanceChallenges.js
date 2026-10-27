const pool = require('../config/db');
const { normalizeEmploymentType } = require('./employmentType');
const { isAttendanceHoliday } = require('./workDays');
const { workHoursFromUser } = require('./workHours');
const {
  CHECK_COUNT,
  checkCountFromUser,
  hourKeyForSeq,
  hourKeyForChallenge,
  activeShiftDate,
  currentShiftDateKey,
  planChallengeTimes,
  formatClock,
  sortRemoteChecks,
  windowsForScheduled,
  shiftBounds,
  isWithinShift,
  userFlexibleHours,
  flexibleDayBounds,
  flexibleStartWindows,
  flexibleDisplayScheduledAt,
  flexibleCheckoutWindows,
  windowsForImmediateCheck,
  isOnShift,
  zonedInstant,
  pickRandomInstants,
  seededRandom,
  MIN_CHECK_GAP_MINUTES,
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
      seq                 INTEGER NOT NULL CHECK (seq >= 1 AND seq <= 12),
      kind                TEXT NOT NULL CHECK (kind IN ('start', 'random', 'checkout')),
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
  await pool.query(`ALTER TABLE attendance_challenges DROP CONSTRAINT IF EXISTS attendance_challenges_seq_check`);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE attendance_challenges
        ADD CONSTRAINT attendance_challenges_seq_check
        CHECK (seq >= 1 AND seq <= 12);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS remote_check_count INTEGER NOT NULL DEFAULT 5
  `);
  await pool.query(
    `ALTER TABLE attendance_challenges DROP CONSTRAINT IF EXISTS attendance_challenges_kind_check`
  );
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE attendance_challenges
        ADD CONSTRAINT attendance_challenges_kind_check
        CHECK (kind IN ('start', 'random', 'checkout'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
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

function windowsForPlanRow(user, shiftDate, kind, at) {
  if (kind === 'checkout') return flexibleCheckoutWindows(shiftDate, at, user);
  if (kind === 'start' && userFlexibleHours(user)) return flexibleStartWindows(shiftDate, user);
  return windowsForScheduled(at);
}

async function insertPlan(user, shiftDate, plan) {
  const flexible = userFlexibleHours(user);
  const { start, end } = flexible ? flexibleDayBounds(shiftDate) : shiftBounds(shiftDate, user);
  for (const row of plan) {
    let at = new Date(row.scheduled_at);
    if (row.kind !== 'start' && row.kind !== 'checkout') {
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
    const windows = windowsForPlanRow(user, shiftDate, row.kind, at);
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
        hourKeyForChallenge(shiftDate, row),
        windows.scheduled_at || at,
        windows.late_at,
        windows.absent_at,
      ]
    );
  }
}

const DONE_STATES = new Set(['verified', 'late', 'missed']);

async function cancelPendingFollowUps(userId, shiftDate) {
  await pool.query(
    `
      DELETE FROM attendance_challenges
      WHERE user_id = $1
        AND shift_date = $2
        AND kind IN ('random', 'checkout')
        AND status IN ('pending', 'notified')
    `,
    [userId, shiftDate]
  );
}

async function scheduleFlexibleFollowUps(user, shiftDate, now = new Date()) {
  const checkCount = checkCountFromUser(user);
  const existing = await loadChallenges(user.id, shiftDate);
  const startRow = existing.find((row) => Number(row.seq) === 1 || row.kind === 'start');
  if (!startRow || !DONE_STATES.has(startRow.status) || startRow.status === 'missed') {
    return loadChallenges(user.id, shiftDate);
  }
  if (existing.some((row) => row.kind === 'checkout' && DONE_STATES.has(row.status))) {
    return existing;
  }

  const have = new Set(existing.map((row) => Number(row.seq)));
  const assigned = shiftBounds(shiftDate, user);
  const day = flexibleDayBounds(shiftDate);
  const randomCount = Math.max(0, checkCount - 2);
  const gapMs = MIN_CHECK_GAP_MINUTES * 60 * 1000;
  const fromMs = Math.max(now.getTime() + 5 * 60 * 1000, assigned.start.getTime());
  let untilMs = assigned.end.getTime() - 40 * 60 * 1000;
  if (untilMs < assigned.start.getTime()) untilMs = assigned.end.getTime() - 60 * 1000;
  untilMs = Math.min(untilMs, day.end.getTime() - 60 * 1000);

  const plan = [];
  if (randomCount > 0 && untilMs > fromMs) {
    const rng = seededRandom(`${user.id}|${shiftDate}|flex-randoms`);
    const instants = pickRandomInstants(
      new Date(fromMs),
      new Date(untilMs),
      randomCount,
      gapMs,
      rng,
      []
    );
    instants.forEach((at, i) => {
      const seq = i + 2;
      if (!have.has(seq)) {
        plan.push({ seq, kind: 'random', scheduled_at: at });
      }
    });
  }
  if (!existing.some((row) => row.kind === 'checkout')) {
    let seq = checkCount;
    while (have.has(seq) && seq < 12) seq += 1;
    if (!have.has(seq)) {
      plan.push({ seq, kind: 'checkout', scheduled_at: now });
    }
  }
  if (plan.length) await insertPlan(user, shiftDate, plan);
  return loadChallenges(user.id, shiftDate);
}

async function ensureFlexibleChallenges(user, shiftDate, now) {
  const checkCount = checkCountFromUser(user);
  const startWindows = flexibleStartWindows(shiftDate, user);
  await pool.query(
    `
      DELETE FROM attendance_challenges
      WHERE user_id = $1
        AND shift_date = $2
        AND seq > $3
        AND status IN ('pending', 'notified')
    `,
    [user.id, shiftDate, checkCount]
  );

  let existing = await loadChallenges(user.id, shiftDate);
  const startRow = existing.find((row) => Number(row.seq) === 1 || row.kind === 'start');
  const startDone = startRow && DONE_STATES.has(startRow.status);
  if (!startDone) {
    await pool.query(
      `
        DELETE FROM attendance_challenges
        WHERE user_id = $1
          AND shift_date = $2
          AND seq > 1
          AND status IN ('pending', 'notified')
      `,
      [user.id, shiftDate]
    );
  }

  if (!startRow) {
    await insertPlan(user, shiftDate, [
      { seq: 1, kind: 'start', scheduled_at: startWindows.scheduled_at },
    ]);
  } else if (['pending', 'notified'].includes(startRow.status)) {
    await pool.query(
      `
        UPDATE attendance_challenges
        SET scheduled_at = $3, late_at = $4, absent_at = $5, kind = 'start'
        WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'notified')
      `,
      [startRow.id, user.id, startWindows.scheduled_at, startWindows.late_at, startWindows.absent_at]
    );
  } else if (new Date(startRow.scheduled_at).getTime() !== startWindows.scheduled_at.getTime()) {
    await pool.query(
      `
        UPDATE attendance_challenges
        SET scheduled_at = $3, kind = 'start'
        WHERE id = $1 AND user_id = $2
      `,
      [startRow.id, user.id, startWindows.scheduled_at]
    );
  }

  existing = await loadChallenges(user.id, shiftDate);
  const start = existing.find((row) => Number(row.seq) === 1 || row.kind === 'start');
  const checkoutDone = existing.some((row) => row.kind === 'checkout' && DONE_STATES.has(row.status));
  if (checkoutDone) {
    await cancelPendingFollowUps(user.id, shiftDate);
    return loadChallenges(user.id, shiftDate);
  }
  if (start && DONE_STATES.has(start.status) && start.status !== 'missed') {
    return scheduleFlexibleFollowUps(user, shiftDate, now);
  }
  return loadChallenges(user.id, shiftDate);
}

async function ensureChallengesForUser(user, shiftDate, now = new Date()) {
  if (normalizeEmploymentType(user.employment_type) !== 'remote') return [];
  if (isAttendanceHoliday(user, shiftDate)) {
    await dropOpenChallenges(user.id, shiftDate);
    return [];
  }
  if (userFlexibleHours(user)) {
    return ensureFlexibleChallenges(user, shiftDate, now);
  }
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
  const checkCount = checkCountFromUser(user);
  await pool.query(
    `
      DELETE FROM attendance_challenges
      WHERE user_id = $1
        AND shift_date = $2
        AND seq > $3
        AND status IN ('pending', 'notified')
    `,
    [user.id, shiftDate, checkCount]
  );
  const existing = await loadChallenges(user.id, shiftDate);
  if (existing.length < checkCount) {
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

async function loadUserHours(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, work_start_hour, work_end_hour, flexible_hours, remote_check_count, work_days, six_day_week
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function reopenForImmediateCheck(challenge, now = new Date(), user = null) {
  const person = user || (await loadUserHours(challenge.user_id));
  const windows = windowsForImmediateCheck(person, challenge.shift_date, challenge.kind, now);
  if (!windows) return null;
  const scheduledAt = windows.scheduled_at || now;
  await pool.query(
    `
      UPDATE attendance_challenges
      SET scheduled_at = $2,
          late_at = $3,
          absent_at = $4,
          notified_at = NULL,
          status = 'pending',
          attendance_log_id = NULL
      WHERE id = $1
        AND status IN ('pending', 'notified')
    `,
    [challenge.id, scheduledAt, windows.late_at, windows.absent_at]
  );
  const rows = await loadChallenges(challenge.user_id, challenge.shift_date);
  return rows.find((row) => Number(row.id) === Number(challenge.id)) || null;
}

async function reopenCheckDuringShift(user, shiftDate, hourKey = null, now = new Date()) {
  await pool.query(
    `
      UPDATE attendance_challenges
      SET status = 'pending',
          attendance_log_id = NULL,
          notified_at = NULL
      WHERE user_id = $1
        AND shift_date = $2
        AND ($3::text IS NULL OR hour_key = $3)
    `,
    [user.id, shiftDate, hourKey]
  );
  const liveShift = activeShiftDate(now, user, { includeLead: false });
  if (liveShift !== shiftDate) return null;
  const rows = await loadChallenges(user.id, shiftDate);
  const pending = rows.filter((row) => ['pending', 'notified'].includes(row.status));
  const chosen = hourKey
    ? pending.find((row) => row.hour_key === hourKey) || pending[0]
    : pending.sort((a, b) => Number(a.seq) - Number(b.seq))[0];
  if (!chosen) return null;
  return reopenForImmediateCheck(chosen, now, user);
}

async function updateChallengeSchedule(userId, challengeId, scheduledAt) {
  const at = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (!Number.isFinite(at.getTime())) {
    throw new Error('Invalid scheduled time.');
  }
  const current = (
    await pool.query(
      `SELECT kind, shift_date FROM attendance_challenges WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [challengeId, userId]
    )
  ).rows[0];
  const person = (
    await pool.query(
      `SELECT flexible_hours, work_start_hour, work_end_hour FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    )
  ).rows[0];
  let windows = windowsForScheduled(at);
  if (current?.kind === 'checkout') {
    windows = flexibleCheckoutWindows(current.shift_date, at, person);
  } else if (current?.kind === 'start' && userFlexibleHours(person)) {
    const day = flexibleDayBounds(current.shift_date);
    windows = {
      scheduled_at: at,
      late_at: new Date(day.end.getTime() - 60 * 1000),
      absent_at: day.end,
    };
  }
  const { rows } = await pool.query(
    `
      UPDATE attendance_challenges
      SET scheduled_at = $3,
          late_at = $4,
          absent_at = $5
      WHERE id = $1
        AND user_id = $2
      RETURNING id, user_id, shift_date, seq, kind, hour_key,
                scheduled_at, late_at, absent_at, notified_at, status, attendance_log_id
    `,
    [challengeId, userId, at, windows.late_at, windows.absent_at]
  );
  return rows[0] || null;
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

function publicChallenge(row, { revealFuture = false, now = new Date(), user = null, onBreak = false } = {}) {
  const scheduled = new Date(row.scheduled_at);
  const lateAt = new Date(row.late_at);
  const absentAt = new Date(row.absent_at);
  const displayAt = new Date(
    flexibleDisplayScheduledAt(user, row.shift_date, row) || row.scheduled_at
  );
  const bounds = user && row.shift_date ? shiftBounds(row.shift_date, user) : null;
  const wideWindow =
    Number.isFinite(scheduled.getTime()) &&
    Number.isFinite(absentAt.getTime()) &&
    absentAt.getTime() - scheduled.getTime() > (ABSENT_AFTER_MINUTES + 20) * 60 * 1000;
  const dayOpen =
    bounds && (row.kind === 'start' || row.kind === 'checkout') && wideWindow
      ? bounds.start
      : scheduled;
  const opened = now.getTime() >= dayOpen.getTime();
  const withinHours = bounds ? isOnShift(now, user, row.shift_date) : true;
  const pausedOnBreak = Boolean(onBreak && (row.kind === 'random' || row.kind === 'checkout'));
  const hidden =
    row.kind === 'random' &&
    ((pausedOnBreak && !revealFuture) || (!row.notified_at && !opened && !revealFuture));
  let state = row.status;
  if (state === 'pending' || state === 'notified') {
    if (pausedOnBreak) state = hidden ? 'upcoming' : 'pending';
    else if (now.getTime() >= absentAt.getTime()) state = 'missed';
    else if (opened && withinHours) state = now.getTime() >= lateAt.getTime() ? 'late_window' : 'open';
    else state = hidden ? 'upcoming' : 'pending';
  }
  const canCheckIn =
    (row.status === 'pending' || row.status === 'notified') &&
    opened &&
    withinHours &&
    now.getTime() < absentAt.getTime() &&
    !pausedOnBreak;
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    hour_key: row.hour_key,
    label:     hidden
      ? `Availability check ${row.seq}`
      : row.kind === 'checkout'
        ? 'Check out'
        : row.seq === 1 || row.kind === 'start'
          ? `First check-in (${formatClock(displayAt)})`
          : `Check ${row.seq} (${formatClock(scheduled)})`,
    scheduled_at: hidden ? null : Number.isFinite(displayAt.getTime()) ? displayAt : row.scheduled_at,
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

function openChallenge(rows, now = new Date(), user = null, { onBreak = false } = {}) {
  const pubs = rows.map((row) => ({ row, pub: publicChallenge(row, { now, user, onBreak }) }));
  const open = pubs.filter((item) => item.pub.can_check_in);
  if (onBreak) return null;
  return (
    open.find((item) => item.row.kind === 'random') ||
    open.find((item) => item.row.kind === 'start') ||
    open.find((item) => item.row.kind === 'checkout') ||
    null
  );
}

async function deferPendingRandoms(userId, now = new Date()) {
  const lateAt = new Date(now.getTime() + LATE_AFTER_MINUTES * 60 * 1000);
  const absentAt = new Date(now.getTime() + ABSENT_AFTER_MINUTES * 60 * 1000);
  await pool.query(
    `
      UPDATE attendance_challenges
      SET scheduled_at = $2,
          late_at = $3,
          absent_at = $4,
          notified_at = NULL,
          status = 'pending'
      WHERE user_id = $1
        AND kind IN ('random', 'checkout')
        AND status IN ('pending', 'notified')
        AND scheduled_at <= $2
    `,
    [userId, now, lateAt, absentAt]
  );
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
        AND u.is_active = true
        AND u.status = 'active'
        AND u.employment_type = 'remote'
        AND COALESCE(u.attendance_enabled, true) = true
        AND NOT (
          c.kind IN ('random', 'checkout')
          AND EXISTS (
            SELECT 1 FROM attendance_breaks b
            WHERE b.user_id = c.user_id AND b.ended_at IS NULL
          )
        )
      ORDER BY c.scheduled_at ASC
      LIMIT 200
    `,
    [now]
  );
  return rows;
}

async function markNotified(id, now = new Date()) {
  const { rows } = await pool.query(
    `
      UPDATE attendance_challenges
      SET notified_at = $2, status = 'notified'
      WHERE id = $1 AND notified_at IS NULL AND status = 'pending'
      RETURNING id
    `,
    [id, now]
  );
  return Boolean(rows[0]);
}

async function clearNotifiedIfUnused(id) {
  const { rows } = await pool.query(
    `
      UPDATE attendance_challenges
      SET notified_at = NULL, status = 'pending'
      WHERE id = $1
        AND status = 'notified'
        AND attendance_log_id IS NULL
      RETURNING id
    `,
    [id]
  );
  return Boolean(rows[0]);
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
        AND COALESCE(u.attendance_enabled, true) = true
        AND NOT (
          c.kind IN ('random', 'checkout')
          AND EXISTS (
            SELECT 1 FROM attendance_breaks b
            WHERE b.user_id = c.user_id AND b.ended_at IS NULL
          )
        )
      ORDER BY c.absent_at ASC
      LIMIT 400
    `,
    [now]
  );
  return rows;
}

module.exports = {
  CHECK_COUNT,
  checkCountFromUser,
  START_ON_TIME_MINUTES,
  LATE_AFTER_MINUTES,
  ABSENT_AFTER_MINUTES,
  RESPOND_TARGET_MINUTES,
  ensureChallengeTable,
  loadChallenges,
  ensureChallengesForUser,
  dropOpenChallenges,
  cancelPendingFollowUps,
  scheduleFlexibleFollowUps,
  updateChallengeSchedule,
  reopenForImmediateCheck,
  reopenCheckDuringShift,
  realignRandomSeqs,
  publicChallenge,
  openChallenge,
  deferPendingRandoms,
  markChallengeResult,
  dueNotifications,
  markNotified,
  clearNotifiedIfUnused,
  expiredOpen,
  activeShiftDate,
  currentShiftDateKey,
  isOnShift,
  shiftBounds,
  workHoursFromUser,
  formatClock,
  sortRemoteChecks,
  userFlexibleHours,
};
