const { zonedParts } = require('./attendanceWindows');

function timeToMinutes(value) {
  if (value == null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatTime(value) {
  const mins = timeToMinutes(value);
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutesSinceStart(clockMinutes, startMinutes) {
  return (clockMinutes - startMinutes + 24 * 60) % (24 * 60);
}

function addDaysToDateKey(dateKey, delta) {
  const [y, mo, d] = String(dateKey)
    .split('-')
    .map((n) => Number(n));
  const dt = new Date(Date.UTC(y, mo - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/**
 * Status vs the assigned shift, using Asia/Karachi clock of checkedInAt.
 * Offsets are measured from shift start so overnight (absent after midnight) works.
 * Arrivals more than 12 hours after start (i.e. early, before the next start) are on time.
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

  const lateOff = minutesSinceStart(late, start);
  const absentOff = minutesSinceStart(absent, start);
  const checkOff = minutesSinceStart(clock, start);

  let status = 'on_time';
  if (checkOff <= 12 * 60) {
    if (checkOff >= absentOff) status = 'absent';
    else if (checkOff >= lateOff) status = 'late';
  }

  // Evening/night shift continuing after midnight still belongs to the previous calendar date.
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
};
