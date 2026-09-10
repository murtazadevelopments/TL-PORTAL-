const { zonedParts } = require('./attendanceWindows');
const { workHoursFromUser, normalizeWorkHours } = require('./workHours');
const { isSundayDateKey } = require('./workWeek');

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
    if (isSundayDateKey(date)) continue;
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

function personSeed(user, shiftDate, extra) {
  return [
    user?.id || 'u',
    user?.username || '',
    user?.employee_id || '',
    shiftDate,
    extra || '',
  ].join('|');
}

function randomBounds(start, end) {
  const earliest = new Date(start.getTime() + MIN_CHECK_GAP_MINUTES * 60 * 1000);
  let latest = new Date(end.getTime() - ABSENT_AFTER_MINUTES * 60 * 1000);
  if (latest.getTime() < earliest.getTime()) {
    latest = new Date(end.getTime() - 60 * 1000);
  }
  return { earliest, latest };
}

function isWithinShift(at, start, end) {
  const t = new Date(at).getTime();
  return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
}

function freeRanges(fromMs, untilMs, occupiedMs, gap) {
  const blocked = [...occupiedMs].filter(Number.isFinite).sort((a, b) => a - b);
  const ranges = [];
  let cursor = fromMs;
  for (const t of blocked) {
    const rangeEnd = t - gap;
    if (rangeEnd >= cursor) ranges.push([cursor, rangeEnd]);
    cursor = Math.max(cursor, t + gap);
  }
  if (untilMs >= cursor) ranges.push([cursor, untilMs]);
  return ranges.filter(([a, b]) => b >= a);
}

function pickRandomInstants(from, until, count, minGapMs, rng = Math.random, occupied = []) {
  const fromMs = alignMinute(from.getTime());
  const untilMs = alignMinute(until.getTime());
  if (count <= 0 || untilMs < fromMs) return [];
  let gap = Math.max(60 * 1000, Number(minGapMs) || MIN_CHECK_GAP_MINUTES * 60 * 1000);
  const occupiedMs = occupied
    .map((value) => alignMinute(value instanceof Date ? value.getTime() : new Date(value).getTime()))
    .filter((t) => Number.isFinite(t));

  function clampTimes(raw) {
    const times = raw.map((t) => alignMinute(t)).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      const minNext = times[i - 1] + gap;
      if (times[i] < minNext) times[i] = minNext;
    }
    if (times.length && times[times.length - 1] > untilMs) {
      times[times.length - 1] = untilMs;
      for (let i = times.length - 2; i >= 0; i -= 1) {
        times[i] = Math.min(times[i], times[i + 1] - gap);
      }
    }
    return times.filter((t) => t >= fromMs && t <= untilMs).map((t) => new Date(t));
  }

  if (!occupiedMs.length) {
    const span = untilMs - fromMs;
    if (count > 1 && (count - 1) * gap > span) {
      gap = Math.max(60 * 1000, Math.floor(span / Math.max(1, count - 1)));
    }
    const slot = Math.max(gap, Math.floor(span / count));
    const times = [];
    for (let i = 0; i < count; i += 1) {
      const slotFrom = fromMs + i * slot;
      const slotTo = i === count - 1 ? untilMs : Math.min(untilMs, fromMs + (i + 1) * slot);
      const inner = Math.max(0, slotTo - slotFrom);
      const pick = slotFrom + Math.floor(rng() * (inner + 1));
      times.push(Math.min(untilMs, Math.max(fromMs, pick)));
    }
    return clampTimes(times);
  }

  const ranges = freeRanges(fromMs, untilMs, occupiedMs, gap);
  const weights = ranges.map(([a, b]) => Math.max(0, b - a));
  const total = weights.reduce((s, w) => s + w, 0);
  if (!ranges.length || total <= 0) return [];
  const times = [];
  for (let i = 0; i < count; i += 1) {
    let pick = rng() * total;
    let chosen = ranges[ranges.length - 1];
    for (let r = 0; r < ranges.length; r += 1) {
      pick -= weights[r];
      if (pick <= 0) {
        chosen = ranges[r];
        break;
      }
    }
    const inner = Math.max(0, chosen[1] - chosen[0]);
    const at = chosen[0] + Math.floor(rng() * (inner + 1));
    times.push(Math.min(chosen[1], Math.max(chosen[0], at)));
  }
  return clampTimes(times).filter((at) =>
    occupiedMs.every((o) => Math.abs(at.getTime() - o) >= gap)
  ).slice(0, count);
}

function randomWindowStart(start, now, existing = [], firstAt = null) {
  const soon = new Date(now.getTime() + 5 * 60 * 1000);
  const anchor = firstAt || start;
  const afterFirst = new Date(anchor).getTime() + MIN_CHECK_GAP_MINUTES * 60 * 1000;
  let from = Math.max(afterFirst, soon.getTime());
  for (const row of existing) {
    if (Number(row.seq) === 1) continue;
    const at = new Date(row.scheduled_at).getTime();
    if (Number.isFinite(at)) {
      from = Math.max(from, at + MIN_CHECK_GAP_MINUTES * 60 * 1000);
    }
  }
  return new Date(from);
}

function planChallengeTimes(shiftDate, user, now = new Date(), existing = []) {
  const { start, end } = shiftBounds(shiftDate, user);
  const { earliest, latest } = randomBounds(start, end);
  const first = {
    seq: 1,
    kind: 'start',
    scheduled_at: start,
    ...windowsForScheduled(start),
  };
  const inWindow = existing.filter((row) => {
    if (Number(row.seq) === 1) return true;
    return isWithinShift(row.scheduled_at, start, end);
  });
  const haveRandom = inWindow.filter((r) => Number(r.seq) > 1).length;
  const count = Math.max(0, RANDOM_COUNT - haveRandom);
  if (count <= 0 || latest.getTime() < earliest.getTime()) return [first];
  let from = earliest;
  if (now.getTime() > start.getTime()) {
    from = new Date(Math.max(earliest.getTime(), now.getTime() + 5 * 60 * 1000));
  }
  if (from.getTime() > latest.getTime()) return [first];
  const occupied = inWindow
    .filter((r) => Number(r.seq) > 1)
    .map((r) => r.scheduled_at);
  const rng = seededRandom(personSeed(user, shiftDate, 'randoms-v4'));
  const instants = pickRandomInstants(
    from,
    latest,
    count,
    MIN_CHECK_GAP_MINUTES * 60 * 1000,
    rng,
    occupied
  ).filter((at) => isWithinShift(at, start, end) && at.getTime() <= latest.getTime());
  const usedSeq = new Set(inWindow.map((r) => Number(r.seq)));
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

function sortRemoteChecks(rows) {
  const list = [...(rows || [])];
  const start = list.filter((row) => Number(row.seq) === 1 || row.kind === 'start');
  const rest = list
    .filter((row) => Number(row.seq) !== 1 && row.kind !== 'start')
    .sort((a, b) => {
      const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return ta - tb;
    });
  return [...start, ...rest];
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
  randomBounds,
  isWithinShift,
  seededRandom,
  formatClock,
  sortRemoteChecks,
};
