const pool = require('../config/db');
const { weekdayKarachi } = require('./workWeek');
const { normalizeEmploymentType } = require('./employmentType');

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_WORK_DAYS = {
  mon: true,
  tue: true,
  wed: true,
  thu: true,
  fri: true,
  sat: true,
  sun: true,
};

let ensured = false;
let ensurePromise = null;

function truthyDay(value) {
  return value !== false && value !== 0 && value !== '0' && value !== 'false' && value !== 'off';
}

function normalizeWorkDays(raw, sixDayWeek = false) {
  const days = { ...DEFAULT_WORK_DAYS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of DAY_KEYS) {
      if (raw[key] !== undefined) days[key] = truthyDay(raw[key]);
    }
  } else if (sixDayWeek === true) {
    days.sun = false;
  }
  return days;
}

function workDaysFromUser(user) {
  return normalizeWorkDays(user?.work_days, user?.six_day_week === true);
}

function weekdayKeyForDate(dateKey) {
  const weekday = weekdayKarachi(dateKey);
  if (weekday == null) return null;
  return JS_DAY_TO_KEY[weekday] || null;
}

function isWorkDayOn(user, dateKey) {
  const key = weekdayKeyForDate(dateKey);
  if (!key) return true;
  return workDaysFromUser(user)[key] !== false;
}

function isAttendanceHoliday(user, dateKey) {
  if (normalizeEmploymentType(user?.employment_type) !== 'remote') {
    return weekdayKeyForDate(dateKey) === 'sun';
  }
  return !isWorkDayOn(user, dateKey);
}

function workDaysSummary(days) {
  const normalized = normalizeWorkDays(days);
  const on = DAY_KEYS.filter((key) => normalized[key]);
  if (on.length === 7) return 'All 7 days';
  if (on.length === 6 && normalized.sun === false) return 'Mon–Sat';
  if (on.length === 5 && !normalized.sat && !normalized.sun) return 'Mon–Fri';
  const labels = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    sun: 'Sun',
  };
  return on.map((key) => labels[key]).join(', ') || 'No days';
}

async function ensureWorkDaysColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(
        `ALTER TABLE users
           ADD COLUMN IF NOT EXISTS work_days JSONB NOT NULL DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":true,"sun":true}'::jsonb`
      );
      await pool.query(
        `ALTER TABLE users
           ADD COLUMN IF NOT EXISTS six_day_week BOOLEAN NOT NULL DEFAULT false`
      );
      await pool.query(
        `UPDATE users
            SET work_days = jsonb_set(COALESCE(work_days, '{}'::jsonb), '{sun}', 'false'::jsonb)
          WHERE six_day_week = true
            AND COALESCE(work_days->>'sun', 'true') <> 'false'`
      );
      ensured = true;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

async function setUserWorkDays(userId, rawDays) {
  await ensureWorkDaysColumn();
  const days = normalizeWorkDays(rawDays);
  if (!DAY_KEYS.some((key) => days[key])) {
    const error = new Error('Turn on at least one weekday.');
    error.statusCode = 400;
    throw error;
  }
  const { rows } = await pool.query(
    `
      UPDATE users
      SET work_days = $2::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING id, work_days
    `,
    [userId, JSON.stringify(days)]
  );
  return rows[0] || null;
}

module.exports = {
  DAY_KEYS,
  DEFAULT_WORK_DAYS,
  ensureWorkDaysColumn,
  ensureSixDayWeekColumn: ensureWorkDaysColumn,
  normalizeWorkDays,
  workDaysFromUser,
  weekdayKeyForDate,
  isWorkDayOn,
  isAttendanceHoliday,
  workDaysSummary,
  setUserWorkDays,
};
