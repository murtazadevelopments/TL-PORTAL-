const DEFAULT_START = 9;
const DEFAULT_END = 18;

function clampHour(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function pickUserHour(user, kind) {
  for (const [key, value] of Object.entries(user || {})) {
    const compact = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact.includes('work') || !compact.includes('hour')) continue;
    const isStart = compact.includes('start');
    const isEnd = compact.includes('end');
    if (kind === 'start' && !isStart) continue;
    if (kind === 'end' && !isEnd) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function workHoursFromUser(user) {
  return normalizeWorkHours(pickUserHour(user, 'start'), pickUserHour(user, 'end'));
}

function normalizeWorkHours(startHour, endHour) {
  const start = clampHour(startHour, DEFAULT_START, 0, 23);
  let end = clampHour(endHour, DEFAULT_END, 1, 24);
  if (end === start) end = Math.min(24, start + 1);
  return { start, end, overnight: end < start };
}

function hoursBetween(startHour, endHour) {
  const { start, end } = normalizeWorkHours(startHour, endHour);
  const hours = [];
  if (end > start) {
    for (let h = start; h < end; h += 1) hours.push(h);
    return hours;
  }
  for (let h = start; h < 24; h += 1) hours.push(h);
  for (let h = 0; h < end; h += 1) hours.push(h);
  return hours;
}

function formatHourLabel(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h) || h === 0 || h === 24) return '12:00 AM';
  const period = h >= 12 ? 'PM' : 'AM';
  const clock = h % 12 === 0 ? 12 : h % 12;
  return `${clock}:00 ${period}`;
}

function slotsForWorkHours(dateKey, startHour, endHour, hourKeyFor) {
  return hoursBetween(startHour, endHour).map((hour) => {
    const hourKey = hourKeyFor(dateKey, hour);
    return {
      hour,
      hour_key: hourKey,
      hour_key: hourKey,
      label: formatHourLabel(hour),
    };
  });
}

function monthDateKeys(monthKey, untilDateKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const keys = [];
  for (let day = 1; day <= last; day += 1) {
    const key = `${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`;
    if (untilDateKey && key > untilDateKey) break;
    keys.push(key);
  }
  return keys;
}

function currentMonthKey(dateKey) {
  return String(dateKey || '').slice(0, 7);
}

module.exports = {
  DEFAULT_START,
  DEFAULT_END,
  pickUserHour,
  workHoursFromUser,
  normalizeWorkHours,
  hoursBetween,
  hoursBetween: hoursBetween,
  formatHourLabel,
  formatHourLabel: formatHourLabel,
  slotsForWorkHours,
  slotsForWorkHours: slotsForWorkHours,
  monthDateKeys,
  monthDateKeys: monthDateKeys,
  currentMonthKey,
};
