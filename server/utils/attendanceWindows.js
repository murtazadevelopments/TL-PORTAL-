const TIMEZONE = 'Asia/Karachi';
const SHIFT_START = Number(process.env.ATTENDANCE_SHIFT_START || 9);
const SHIFT_END = Number(process.env.ATTENDANCE_SHIFT_END || 18);
const GRACE_MINUTES = Number(process.env.ATTENDANCE_GRACE_MINUTES || 10);

function zonedParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function hourKeyFor(dateKey, hour) {
  return `${dateKey}-${String(hour).padStart(2, '0')}`;
}

function shiftHours() {
  const start = Number.isFinite(SHIFT_START) ? SHIFT_START : 9;
  const end = Number.isFinite(SHIFT_END) ? SHIFT_END : 18;
  const hours = [];
  for (let h = start; h < end; h += 1) hours.push(h);
  return hours;
}

function isShiftHour(hour) {
  return shiftHours().includes(Number(hour));
}

function currentHourKey(date = new Date()) {
  const p = zonedParts(date);
  return hourKeyFor(p.dateKey, p.hour);
}

function slotsForDateKey(dateKey) {
  return shiftHours().map((hour) => ({
    hour,
    hour_key: hourKeyFor(dateKey, hour),
    label: `${String(hour).padStart(2, '0')}:00`,
  }));
}

function slotsDueForMissed(date = new Date()) {
  const p = zonedParts(date);
  const grace = Number.isFinite(GRACE_MINUTES) ? GRACE_MINUTES : 10;
  const due = [];
  for (const hour of shiftHours()) {
    const hourEndPassed =
      p.hour > hour + 1 || (p.hour === hour + 1 && p.minute >= grace) || p.hour > hour + 1;
    const closed =
      p.hour > hour && (p.hour > hour + 1 || p.minute >= grace || p.hour > hour);
    // Slot is missed once we are at least `grace` minutes into the next hour.
    const nextHour = hour + 1;
    const pastGrace =
      p.hour > nextHour || (p.hour === nextHour && p.minute >= grace);
    if (pastGrace) {
      due.push(hourKeyFor(p.dateKey, hour));
    }
    void hourEndPassed;
    void closed;
  }
  return due;
}

function slotsForDateKeyWithCurrent(dateKey, date = new Date()) {
  const slots = [...slotsForDateKey(dateKey)];
  const current = currentHourKey(date);
  if (current.startsWith(`${dateKey}-`) && !slots.some((s) => s.hour_key === current)) {
    const hour = Number(current.slice(-2));
    slots.push({
      hour,
      hour_key: current,
      label: `${String(hour).padStart(2, '0')}:00`,
    });
    slots.sort((a, b) => a.hour - b.hour);
  }
  return slots;
}

function canCheckInHourKey(hourKey, date = new Date()) {
  return hourKey === currentHourKey(date);
}

module.exports = {
  TIMEZONE,
  GRACE_MINUTES,
  zonedParts,
  zonedParts: zonedParts,
  hourKeyFor,
  hourKeyFor: hourKeyFor,
  shiftHours,
  isShiftHour,
  isShiftHour: isShiftHour,
  currentHourKey,
  currentHourKey: currentHourKey,
  slotsForDateKey,
  slotsForDateKey: slotsForDateKey,
  slotsForDateKeyWithCurrent,
  slotsForDateKeyWithCurrent: slotsForDateKeyWithCurrent,
  slotsDueForMissed,
  slotsDueForMissed: slotsDueForMissed,
  canCheckInHourKey,
  canCheckInHourKey: canCheckInHourKey,
};
