const { zonedParts } = require('./attendanceWindows');
const { workHoursFromUser, normalizeWorkHours } = require('./workHours');

const CHECK_COUNT = 5;
const RANDOM_COUNT = 4;
const START_ON_TIME_MINUTES = 15;
const LATE_AFTER_MINUTES = 15;
const ABSENT_AFTER_MINUTES = 40;
const RESPOND_TARGET_MINUTES = 20;
/** Minimum space between check start times so 40-minute windows do not overlap. */
const MIN_CHECK_GAP_MINUTES = ABSENT_AFTER_MINUTES + 10;
const MIN_RANDOM_GAP_MINUTES = MIN_CHECK_GAP_MINUTES;
const GENERATE_LEAD_MINUTES = 30;
const KARACHI_OFFSET = '+05:00';

function addDaysKey(dateKey, days) {
  const [year, month, day] = String(dateKey)
    .slice(0, 10)
    .split('-')
    .map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function zonedInstant(dateKey, hour, minute = 0) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${dateKey}T${hh}:${mm}:00${KARACHI_OFFSET}`);
}

function hourKeyForSeq(shiftDate, seq) {
  return `${shiftDate}-c${seq}`;
}

function shiftBounds(shiftDate, userOrHours) {
  const hours =
    userOrHours && typeof userOrHours.start === 'number'
      ? normalizeWorkHours(userOrHours.start, userOrHours.end)
      : workHoursFromUser(userOrHours);
  const start = zonedInstant(shiftDate, hours.start, 0);
  const endDate = hours.overnight ? addDaysKey(shiftDate, 1) : shiftDate;
  const endHour = hours.end === 24 ? 0 : hours.end;
  const end = hours.end === 24
    ? zonedInstant(addDaysKey(shiftDate, 1), 0, 0)
    : zonedInstant(endDate, endHour, 0);
  return { start, end, hours };
}

function currentShiftDateKey(now, user) {
  const hours = workHoursFromUser(user);
  const parts = zonedParts(now);
  if (hours.overnight && parts.hour < hours.end) {
    return addDaysKey(parts.dateKey, -1);
  }
  return parts.dateKey;
}

function activeShiftDate(now, user) {
  const hours = workHoursFromUser(user);
  const today = zonedParts(now).dateKey;
  const yesterday = addDaysKey(today, -1);
  const candidates = hours.overnight ? [yesterday, today] : [today];
  const lead = GENERATE_LEAD_MINUTES * 60 * 1000;
  for (const date of candidates) {
    const { start, end } = shiftBounds(date, { start: hours.start, end: hours.end });
    if (now.getTime() >= start.getTime() - lead && now.getTime() <= end.getTime()) {
      return date;
    }
  }
  return null;
}

function windowsForScheduled(scheduledAt) {
  const t = scheduledAt.getTime();
  return {
    late_at: new Date(t + LATE_AFTER_MINUTES * 60 * 1000),
    absent_at: new Date(t + ABSENT_AFTER_MINUTES * 60 * 1000),
  };
}

function alignMinute(ms) {
  return Math.round(Number(ms) / 60000) * 60000;
}

/** Different every calendar shift and every employee; stable for the same person+day. */
function seededRandom(seed) {
  let h = 2166136261;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function rand() {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomInstants(from, until, count, minGapMs, rng = Math.random) {
  const fromMs = alignMinute(from.getTime());
  const untilMs = alignMinute(until.getTime());
  if (count <= 0) return [];
  let gap = Math.max(60 * 1000, Number(minGapMs) || MIN_CHECK_GAP_MINUTES * 60 * 1000);
  if (untilMs <= fromMs) {
    return Array.from({ length: count }, (_, i) => new Date(fromMs + i * gap));
  }
  const span = untilMs - fromMs;
  if (count > 1 && (count - 1) * gap > span) {
    gap = Math.max(15 * 60 * 1000, Math.floor(span / count));
  }
  const usable = Math.max(0, span - (count - 1) * gap);
  const offsets = [];
  for (let i = 0; i < count; i += 1) {
    offsets.push(Math.floor(rng() * (usable + 1)));
  }
  offsets.sort((a, b) => a - b);
  return offsets.map((off, i) => new Date(alignMinute(fromMs + off + i * gap)));
}

function randomWindowStart(start, now, existing = []) {
  const soon = new Date(now.getTime() + 5 * 60 * 1000);
  const afterFirst = start.getTime() + MIN_CHECK_GAP_MINUTES * 60 * 1000;
  let from = Math.max(afterFirst, soon.getTime());
  for (const row of existing) {
    const at = new Date(row.scheduled_at).getTime();
    if (Number.isFinite(at)) {
      from = Math.max(from, at + MIN_CHECK_GAP_MINUTES * 60 * 1000);
    }
  }
  return new Date(from);
}

function planChallengeTimes(shiftDate, user, now = new Date(), existing = []) {
  const { start, end } = shiftBounds(shiftDate, user);
  const first = {
    seq: 1,
    kind: 'start',
    scheduled_at: start,
    ...windowsForScheduled(start),
  };
  const haveRandom = existing.filter((r) => Number(r.seq) > 1).length;
  const missing = Math.max(0, RANDOM_COUNT - haveRandom);
  const count = missing > 0 ? missing : RANDOM_COUNT;
  const rng = seededRandom(`${user?.id || user?.username || 'u'}:${shiftDate}`);
  const randomFrom = randomWindowStart(start, now, existing);
  const randomUntil = new Date(end.getTime() - ABSENT_AFTER_MINUTES * 60 * 1000);
  const until =
    randomUntil > randomFrom
      ? randomUntil
      : new Date(
          Math.max(
            randomFrom.getTime() + MIN_CHECK_GAP_MINUTES * 60 * 1000,
            end.getTime() - RESPOND_TARGET_MINUTES * 60 * 1000
          )
        );
  const instants = pickRandomInstants(
    randomFrom,
    until,
    count,
    MIN_CHECK_GAP_MINUTES * 60 * 1000,
    rng
  );
  const usedSeq = new Set(existing.map((r) => Number(r.seq)));
  const seqs = [];
  for (let seq = 2; seq <= CHECK_COUNT; seq += 1) {
    if (!usedSeq.has(seq)) seqs.push(seq);
  }
  const randoms = instants.map((at, i) => ({
    seq: seqs[i] || i + 2,
    kind: 'random',
    scheduled_at: at,
    ...windowsForScheduled(at),
  }));
  return [first, ...randoms];
}

function formatClock(date) {
  try {
    return new Date(date).toLocaleTimeString('en-PK', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Karachi',
    });
  } catch {
    return '';
  }
}

module.exports = {
  CHECK_COUNT,
  RANDOM_COUNT,
  START_ON_TIME_MINUTES,
  LATE_AFTER_MINUTES,
  ABSENT_AFTER_MINUTES,
  RESPOND_TARGET_MINUTES,
  MIN_RANDOM_GAP_MINUTES,
  MIN_CHECK_GAP_MINUTES,
  addDaysKey,
  zonedInstant,
  hourKeyForSeq,
  shiftBounds,
  currentShiftDateKey,
  activeShiftDate,
  windowsForScheduled,
  pickRandomInstants,
  planChallengeTimes,
  randomWindowStart,
  seededRandom,
  formatClock,
};
