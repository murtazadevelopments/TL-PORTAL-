const pool = require('../config/db');
const { formatDurationMinutes } = require('./attendanceDays');

let ensured = false;
let ensurePromise = null;

async function ensureBreaksSupport() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureBreaksSupport()
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

async function runEnsureBreaksSupport() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS breaks_enabled BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_breaks (
      id            BIGSERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_date    TEXT NOT NULL,
      started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at      TIMESTAMPTZ,
      match_score   DOUBLE PRECISION,
      status        TEXT NOT NULL DEFAULT 'open',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS attendance_breaks_user_date_idx
      ON attendance_breaks (user_id, shift_date, started_at)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_breaks_one_open
      ON attendance_breaks (user_id)
      WHERE ended_at IS NULL
  `);
  await pool.query(`
    ALTER TABLE attendance_days
      ADD COLUMN IF NOT EXISTS work_minutes INTEGER
  `);
  await pool.query(`
    ALTER TABLE attendance_days
      ADD COLUMN IF NOT EXISTS break_minutes INTEGER
  `);
}

function userBreaksEnabled(user) {
  return user?.breaks_enabled === true;
}

async function setUserBreaksEnabled(userId, enabled) {
  await ensureBreaksSupport();
  const on = Boolean(enabled);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET breaks_enabled = $2
      WHERE id = $1
      RETURNING id, breaks_enabled
    `,
    [userId, on]
  );
  if (!on) await forceCloseOpenBreak(userId);
  return rows[0] || null;
}

function sessionPublic(row, now = new Date()) {
  if (!row) return null;
  const start = new Date(row.started_at);
  const open = !row.ended_at;
  const end = open ? now : new Date(row.ended_at);
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return {
    id: row.id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    open,
    minutes,
    minutes_label: formatDurationMinutes(minutes) || '0m',
    status: open ? 'on_break' : 'closed',
  };
}

function summarizeBreaks(rows, options = {}) {
  const now = options.now || new Date();
  const firstCheckIn = options.firstCheckIn || options.first_check_in || null;
  const checkedOutAt = options.checkedOutAt || options.checked_out_at || null;
  const details = (rows || []).map((row) => sessionPublic(row, now)).filter(Boolean);
  const breakMinutes = details.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
  let workMinutes = null;
  if (firstCheckIn) {
    const cap = checkedOutAt ? new Date(checkedOutAt) : now;
    const span = Math.max(0, Math.round((cap.getTime() - new Date(firstCheckIn).getTime()) / 60000));
    workMinutes = Math.max(0, span - breakMinutes);
  }
  return {
    breaks: details,
    on_break: details.some((row) => row.open),
    current_break: details.find((row) => row.open) || null,
    break_minutes: breakMinutes,
    break_label: formatDurationMinutes(breakMinutes) || '0m',
    work_minutes: workMinutes,
    work_label: workMinutes == null ? '' : formatDurationMinutes(workMinutes) || '0m',
  };
}

async function loadBreaks(userId, shiftDate) {
  await ensureBreaksSupport();
  const { rows } = await pool.query(
    `
      SELECT id, user_id, shift_date, started_at, ended_at, match_score, status
      FROM attendance_breaks
      WHERE user_id = $1 AND shift_date = $2
      ORDER BY started_at ASC
    `,
    [userId, shiftDate]
  );
  return rows;
}

async function loadBreaksForUsers(userIds, dateKeys) {
  await ensureBreaksSupport();
  if (!userIds?.length || !dateKeys?.length) return [];
  const { rows } = await pool.query(
    `
      SELECT id, user_id, shift_date, started_at, ended_at, match_score, status
      FROM attendance_breaks
      WHERE user_id = ANY($1::int[])
        AND shift_date = ANY($2::text[])
      ORDER BY started_at ASC
    `,
    [userIds, dateKeys]
  );
  return rows;
}

async function attachBreakSummaries(userId, days, now = new Date()) {
  if (!days?.length) return days;
  const rows = await loadBreaksForUsers(
    [userId],
    days.map((day) => day.date)
  );
  const byDate = new Map();
  for (const row of rows) {
    const key = String(row.shift_date).slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(row);
  }
  return days.map((day) => {
    const summary = summarizeBreaks(byDate.get(day.date) || [], {
      firstCheckIn: day.first_check_in,
      checkedOutAt: day.checked_out_at,
      now,
    });
    return {
      ...day,
      ...summary,
      duration_minutes: summary.work_minutes ?? day.duration_minutes ?? null,
      duration_label: summary.work_label || day.duration_label || '',
    };
  });
}

async function persistShiftDurations(userId, shiftDate, summary) {
  if (!userId || !shiftDate || !summary) return;
  await pool.query(
    `
      UPDATE attendance_days
      SET work_minutes = $3,
          break_minutes = $4,
          duration_minutes = COALESCE($3, duration_minutes),
          updated_at = NOW()
      WHERE user_id = $1 AND date_key = $2
    `,
    [userId, shiftDate, summary.work_minutes, summary.break_minutes]
  );
}

async function openBreak(userId, shiftDate) {
  await ensureBreaksSupport();
  const { rows } = await pool.query(
    `
      INSERT INTO attendance_breaks (user_id, shift_date, started_at, status)
      VALUES ($1, $2, NOW(), 'open')
      RETURNING id, user_id, shift_date, started_at, ended_at, match_score, status
    `,
    [userId, shiftDate]
  );
  return rows[0];
}

async function closeOpenBreak(userId, matchScore = null) {
  await ensureBreaksSupport();
  const { rows } = await pool.query(
    `
      UPDATE attendance_breaks
      SET ended_at = NOW(),
          match_score = $2,
          status = 'closed'
      WHERE user_id = $1 AND ended_at IS NULL
      RETURNING id, user_id, shift_date, started_at, ended_at, match_score, status
    `,
    [userId, matchScore]
  );
  return rows[0] || null;
}

async function forceCloseOpenBreak(userId) {
  await ensureBreaksSupport();
  await pool.query(
    `
      UPDATE attendance_breaks
      SET ended_at = COALESCE(ended_at, NOW()),
          status = CASE WHEN ended_at IS NULL THEN 'closed' ELSE status END
      WHERE user_id = $1 AND ended_at IS NULL
    `,
    [userId]
  );
}

async function findOpenBreak(userId) {
  await ensureBreaksSupport();
  const { rows } = await pool.query(
    `
      SELECT id, user_id, shift_date, started_at, ended_at, match_score, status
      FROM attendance_breaks
      WHERE user_id = $1 AND ended_at IS NULL
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function shiftHasStarted(userId, shiftDate) {
  const { rows: day } = await pool.query(
    `
      SELECT first_check_in FROM attendance_days
      WHERE user_id = $1 AND date_key = $2
      LIMIT 1
    `,
    [userId, shiftDate]
  );
  if (day[0]?.first_check_in) return true;
  const { rows: log } = await pool.query(
    `
      SELECT 1 FROM attendance_logs
      WHERE user_id = $1
        AND hour_key LIKE $2
        AND status IN ('verified', 'late')
      LIMIT 1
    `,
    [userId, `${shiftDate}-%`]
  );
  return Boolean(log[0]);
}

module.exports = {
  ensureBreaksSupport,
  userBreaksEnabled,
  setUserBreaksEnabled,
  summarizeBreaks,
  loadBreaks,
  loadBreaksForUsers,
  attachBreakSummaries,
  persistShiftDurations,
  openBreak,
  closeOpenBreak,
  forceCloseOpenBreak,
  findOpenBreak,
  shiftHasStarted,
  sessionPublic,
};
