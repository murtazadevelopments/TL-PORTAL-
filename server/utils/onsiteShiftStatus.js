const { zonedParts } = require('./attendanceWindows');

function timeToMinutes(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 24 * 60) return Math.floor(value);
    if (value >= 0 && value < 24 * 3600 * 1000) {
      return Math.floor(value / 60000) % (24 * 60);
    }
    return null;
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const iso = value.toISOString();
    if (/^1970-01-01T/.test(iso) || /^1899-12-3/.test(iso)) {
      return value.getUTCHours() * 60 + value.getUTCMinutes();
    }
    if (/^1969-12-31T/.test(iso)) {
      return value.getHours() * 60 + value.getMinutes();
    }
    const parts = zonedParts(value);
    return parts.hour * 60 + parts.minute;
  }
  if (typeof value === 'object' && Number.isFinite(Number(value.hours))) {
    const h = Number(value.hours);
    const min = Number(value.minutes || 0);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}

function formatTime(value) {
  const mins = timeToMinutes(value);
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function pgDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const iso = value.toISOString();
    if (/T00:00:00(?:\.000)?Z$/.test(iso)) return iso.slice(0, 10);
    return zonedParts(value).dateKey;
  }
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function addDaysToDateKey(dateKey, delta) {
  const [y, mo, d] = String(dateKey)
    .split('-')
    .map((n) => Number(n));
  const dt = new Date(Date.UTC(y, mo - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

const DAY_MIN = 24 * 60;
const EARLY_ON_TIME_MIN = 3 * 60;

function wrapDelta(from, to) {
  return (to - from + DAY_MIN) % DAY_MIN;
}

/**
 * Pakistan wall clock vs Manage Shifts times.
 * On time: from 3 hours before start through "Late after" (inclusive).
 * Late: after "Late after", before "Absent after".
 * Absent: at/after "Absent after", or more than 3 hours before start.
 *
 * Example: start 09:00, late after 09:30, absent after 10:00
 *   09:30 → on time, 09:31 → late, 10:00 → absent.
 */
function statusForCheckIn(checkedInAt, shift) {
  const parts = zonedParts(checkedInAt);
  const clock = parts.hour * 60 + parts.minute;
  const start = timeToMinutes(shift?.start_time);
  const late = timeToMinutes(shift?.late_after);
  const absent = timeToMinutes(shift?.absent_after);

  if (start == null || late == null || absent == null) {
    throw new Error('Shift times are not configured.');
  }

  const beforeStart = wrapDelta(clock, start);
  const afterStart = wrapDelta(start, clock);
  const lateAfterStart = wrapDelta(start, late);
  const absentAfterStart = wrapDelta(start, absent) || DAY_MIN;

  let status;
  if (beforeStart > 0 && beforeStart <= EARLY_ON_TIME_MIN) {
    status = 'on_time';
  } else if (afterStart <= lateAfterStart) {
    status = 'on_time';
  } else if (afterStart < absentAfterStart) {
    status = 'late';
  } else {
    status = 'absent';
  }

  let workDate = parts.dateKey;
  if (start >= 18 * 60 && clock < 12 * 60) {
    workDate = addDaysToDateKey(parts.dateKey, -1);
  }

  return {
    status,
    workDate,
    clockLabel: formatTime(`${parts.hour}:${String(parts.minute).padStart(2, '0')}`),
  };
}

function isNightShift(shiftOrName) {
  const name = String(
    typeof shiftOrName === 'string' ? shiftOrName : shiftOrName?.name || ''
  )
    .trim()
    .toLowerCase();
  return name === 'night' || /(^|[\s/_-])night([\s/_-]|$)/.test(name);
}

const NIGHT_SELF_CHECKIN_START_MIN = 21 * 60;
const NIGHT_SELF_CHECKIN_END_MIN = 23 * 60 + 59;

function isWithinNightSelfCheckInWindow(at = new Date()) {
  const parts = zonedParts(at);
  const clock = parts.hour * 60 + parts.minute;
  return clock >= NIGHT_SELF_CHECKIN_START_MIN && clock <= NIGHT_SELF_CHECKIN_END_MIN;
}

function employeeCanSelfCheckIn(shiftOrName, at = new Date()) {
  const start = timeToMinutes(
    typeof shiftOrName === 'object' && shiftOrName ? shiftOrName.start_time : null
  );
  const overnight = start != null ? start >= 18 * 60 : isNightShift(shiftOrName);
  if (!overnight) return true;
  return isWithinNightSelfCheckInWindow(at);
}

function parseCheckInAt(value) {
  if (value == null || value === '') return new Date();
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

module.exports = {
  timeToMinutes,
  formatTime,
  statusForCheckIn,
  parseCheckInAt,
  pgDateKey,
  addDaysToDateKey,
  isNightShift,
  isWithinNightSelfCheckInWindow,
  employeeCanSelfCheckIn,
};
