const { zonedParts } = require('./attendanceWindows');

function timeToMinutes(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  if (typeof value === 'object' && Number.isFinite(Number(value.hours))) {
    const h = Number(value.hours);
    const min = Number(value.minutes || 0);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const iso = value.toISOString();
    if (/^1970-01-01T/.test(iso) || /^1899-12-3/.test(iso)) {
      return value.getUTCHours() * 60 + value.getUTCMinutes();
    }
    return value.getHours() * 60 + value.getMinutes();
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

/**
 * On time: from shift start until late threshold (and up to 3 hours early).
 * Late: from late threshold until absent threshold.
 * Absent: at/after absent threshold, or so early that it is the previous day's miss
 * (e.g. 02:03 for a 09:00 start).
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

  const EARLY_ON_TIME_MIN = 3 * 60;
  let status;

  if (absent >= late) {
    if (clock >= start && clock < late) status = 'on_time';
    else if (clock >= late && clock < absent) status = 'late';
    else if (clock >= absent) status = 'absent';
    else if (start >= 18 * 60 && clock < 12 * 60) status = 'absent';
    else status = start - clock <= EARLY_ON_TIME_MIN ? 'on_time' : 'absent';
  } else if (clock >= start && clock < late) {
    status = 'on_time';
  } else if (clock >= late || clock < absent) {
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
  if (!isNightShift(shiftOrName)) return true;
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
