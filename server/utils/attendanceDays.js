const pool = require('../config/db');
const windows = require('./attendanceWindows');
const workHours = require('./workHours');

function pick(obj, name) {
  const want = String(name).toLowerCase().replace(/_/g, '');
  for (const key of Object.keys(obj || {})) {
    if (String(key).toLowerCase().replace(/_/g, '') === want) return obj[key];
  }
  return undefined;
}

const hourKeyFor = pick(windows, 'hourkeyfor');
const zonedParts = pick(windows, 'zonedparts');
const GRACE_MINUTES = pick(windows, 'graceminutes');
const { shiftBounds, planChallengeTimes, hourKeyForSeq, CHECK_COUNT, sortRemoteChecks } = require('./remoteCheckWindows');
const { isSundayDateKey } = require('./workWeek');
const { normalizeEmploymentType } = require('./employmentType');
const normalizeWorkHours = pick(workHours, 'normalizeworkhours');
const hoursBetween = pick(workHours, 'hoursbetween');
const slotsForWorkHours = pick(workHours, 'slotsforworkhours');
const monthDateKeys = pick(workHours, 'monthdatekeys');
const workHoursFromLib = pick(workHours, 'workhoursfromuser');

function workHoursFromUser(user) {
  if (typeof workHoursFromLib === 'function') return workHoursFromLib(user);
  return normalizeWorkHours(user?.work_start_hour, user?.work_end_hour);
}

function slotsForUser(dateKey, user) {
  const hours = workHoursFromUser(user);
  return slotsForWorkHours(dateKey, hours.start, hours.end, hourKeyFor);
}

function isRemoteUser(user) {
  return normalizeEmploymentType(user?.employment_type) === 'remote';
}

function remoteSlotLabel(seq) {
  return Number(seq) === 1 ? 'Start' : `Check ${Number(seq)}`;
}

function slotsFromChallenges(challengeRows, logsByHour, now) {
  return sortRemoteChecks(challengeRows).map((row, i) => {
    const seq = i + 1;
    const log = logsByHour[row.hour_key];
    return {
      hour: seq,
      seq,
      kind: row.kind,
      hour_key: row.hour_key,
      label: remoteSlotLabel(seq),
      state: challengeSlotState(log || row, now),
      method: log?.method || null,
      checked_in_at: log?.checked_in_at || null,
      scheduled_at: row.scheduled_at || null,
    };
  });
}

function plannedRemoteSlots(dateKey, user, now) {
  return planChallengeTimes(dateKey, user, now, []).map((row) => ({
    hour: row.seq,
    seq: row.seq,
    kind: row.kind,
    hour_key: hourKeyForSeq(dateKey, row.seq),
    label: remoteSlotLabel(row.seq),
    state: 'pending',
    method: null,
    checked_in_at: null,
    scheduled_at: row.scheduled_at,
  }));
}

function emptyRemoteSlots(dateKey) {
  return Array.from({ length: CHECK_COUNT }, (_, i) => {
    const seq = i + 1;
    return {
      hour: seq,
      seq,
      kind: seq === 1 ? 'start' : 'random',
      hour_key: hourKeyForSeq(dateKey, seq),
      label: remoteSlotLabel(seq),
      state: 'pending',
      method: null,
      checked_in_at: null,
      scheduled_at: null,
    };
  });
}

function isChallengeKey(hourKey) {
  return /-c[1-5]$/.test(String(hourKey || ''));
}

function hourFromKey(hourKey) {
  return Number(String(hourKey || '').slice(-2));
}

function computeDayStatus(logs, user, dateKey, now = new Date()) {
  const hours = workHoursFromUser(user);
  const hourList = hoursBetween(hours.start, hours.end);
  if (logs.some((l) => l.status === 'leave')) return 'leave';
  if (isSundayDateKey(dateKey)) return 'holiday';

  const challengeLogs = logs.filter(
    (l) => isChallengeKey(l.hour_key) && ['verified', 'late', 'missed'].includes(l.status)
  );
  if (challengeLogs.length) {
    if (challengeLogs.some((l) => l.status === 'missed')) return 'absent';
    const good = challengeLogs.filter((l) => l.status === 'verified' || l.status === 'late');
    const startLog = challengeLogs.find((l) => String(l.hour_key).endsWith('-c1'));
    if (startLog?.status === 'late' || good.some((l) => l.status === 'late')) {
      if (good.length >= 5) return 'late';
    }
    if (good.length >= 5) {
      return good.some((l) => l.status === 'late') ? 'late' : 'present';
    }
    const { end } = shiftBounds(dateKey, user);
    if (now.getTime() >= end.getTime()) {
      return good.length ? (good.some((l) => l.status === 'late') ? 'late' : 'present') : 'absent';
    }
    if (good.length) return good.some((l) => l.status === 'late') || startLog?.status === 'late' ? 'late' : 'pending';
    return 'pending';
  }

  if (isRemoteUser(user)) return 'pending';

  const good = logs.filter((l) => l.status === 'verified' || l.status === 'late');
  if (good.length) {
    const first = [...good].sort((a, b) => String(a.hour_key).localeCompare(String(b.hour_key)))[0];
    const firstHour = hourFromKey(first.hour_key);
    if (first.status === 'late' || firstHour > hours.start) return 'late';
    return 'present';
  }

  const nowParts = zonedParts(now);
  const lastHour = hourList[hourList.length - 1];
  const grace = Number.isFinite(GRACE_MINUTES) ? GRACE_MINUTES : 10;
  const dayEnded =
    dateKey < nowParts.dateKey ||
    (dateKey === nowParts.dateKey &&
      (nowParts.hour > lastHour || (nowParts.hour === lastHour && nowParts.minute >= grace)));
  if (dayEnded) return 'absent';
  return 'pending';
}

async function logsForDate(userId, dateKey) {
  const { rows } = await pool.query(
    `
      SELECT id,
             hour_key AS hour_key,
             status, method, match_score, checked_in_at, note, marked_by, created_at
      FROM attendance_logs
      WHERE user_id = $1
        AND hour_key LIKE $2
      ORDER BY hour_key ASC, created_at ASC
    `,
    [userId, `${dateKey}-%`]
  );
  return rows;
}

async function upsertAttendanceDay(userId, dateKey, status, extra = {}) {
  await pool.query(
    `
      INSERT INTO attendance_days (user_id, date_key, status, first_check_in, note, marked_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, date_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        first_check_in = COALESCE(EXCLUDED.first_check_in, attendance_days.first_check_in),
        note = COALESCE(EXCLUDED.note, attendance_days.note),
        marked_by = COALESCE(EXCLUDED.marked_by, attendance_days.marked_by),
        updated_at = NOW()
    `,
    [
      userId,
      dateKey,
      status,
      extra.firstCheckIn || null,
      extra.note || null,
      extra.markedBy || null,
    ]
  );
}

async function refreshAttendanceDay(user, dateKey, extra = {}) {
  if (isSundayDateKey(dateKey) && extra.forceStatus !== 'leave') {
    await upsertAttendanceDay(user.id, dateKey, 'holiday', extra);
    return 'holiday';
  }
  const logs = await logsForDate(user.id, dateKey);
  const status = extra.forceStatus || computeDayStatus(logs, user, dateKey);
  const firstGood = logs.find((l) => l.status === 'verified' || l.status === 'late');
  await upsertAttendanceDay(user.id, dateKey, status, {
    firstCheckIn: extra.firstCheckIn || firstGood?.checked_in_at || null,
    note: extra.note,
    markedBy: extra.markedBy,
  });
  return status;
}

function challengeSlotState(log, now) {
  if (log?.status === 'verified') return 'verified';
  if (log?.status === 'late') return 'late';
  if (log?.status === 'missed') return 'missed';
  if (log?.status === 'failed') return 'failed';
  if (log?.status === 'leave') return 'leave';
  if (log?.absent_at && new Date(log.absent_at).getTime() <= now.getTime()) return 'missed';
  return 'pending';
}

function buildDayRecord(dateKey, user, logs, now, challengeRows = []) {
  const byHour = {};
  for (const log of logs) {
    const prev = byHour[log.hour_key];
    if (!prev || ['verified', 'late', 'leave'].includes(log.status)) byHour[log.hour_key] = log;
  }

  if (isRemoteUser(user)) {
    const slots = challengeRows.length
      ? slotsFromChallenges(challengeRows, byHour, now)
      : dateKey >= zonedParts(now).dateKey
        ? plannedRemoteSlots(dateKey, user, now)
        : emptyRemoteSlots(dateKey);
    return { date: dateKey, status: computeDayStatus(logs, user, dateKey, now), slots };
  }

  if (challengeRows.length) {
    return {
      date: dateKey,
      status: computeDayStatus(logs, user, dateKey, now),
      slots: slotsFromChallenges(challengeRows, byHour, now),
    };
  }

  const slots = slotsForUser(dateKey, user);
  const nowKey = `${zonedParts(now).dateKey}-${String(zonedParts(now).hour).padStart(2, '0')}`;
  const slotStates = slots.map((slot) => {
    const log = byHour[slot.hour_key];
    let state = 'pending';
    if (log?.status === 'verified') state = 'verified';
    else if (log?.status === 'late') state = 'late';
    else if (log?.status === 'missed') state = 'missed';
    else if (log?.status === 'failed') state = 'failed';
    else if (log?.status === 'leave') state = 'leave';
    else if (slot.hour_key < nowKey) state = 'missed';
    return {
      ...slot,
      state,
      method: log?.method || null,
      checked_in_at: log?.checked_in_at || null,
    };
  });
  return { date: dateKey, status: computeDayStatus(logs, user, dateKey, now), slots: slotStates };
}

function tallyDays(days) {
  const totals = { present: 0, late: 0, absent: 0, leave: 0, pending: 0, holiday: 0 };
  for (const day of days) {
    if (totals[day.status] != null) totals[day.status] += 1;
  }
  return totals;
}

async function monthHistory(user, monthKey, now = new Date()) {
  const today = zonedParts(now).dateKey;
  const pastOrToday = monthDateKeys(monthKey, today);
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) {
    return { month: monthKey, days: [], totals: tallyDays([]) };
  }

  const { rows } = await pool.query(
    `
      SELECT id,
             hour_key AS hour_key,
             status, method, match_score, checked_in_at, note, marked_by, created_at
      FROM attendance_logs
      WHERE user_id = $1
        AND hour_key LIKE $2
      ORDER BY hour_key ASC, created_at ASC
    `,
    [user.id, `${monthKey}-%`]
  );

  const { rows: dayRows } = await pool.query(
    `
      SELECT date_key, status, first_check_in, note
      FROM attendance_days
      WHERE user_id = $1
        AND date_key LIKE $2
    `,
    [user.id, `${monthKey}-%`]
  );
  const leaveByDate = new Map(
    dayRows.filter((d) => d.status === 'leave').map((d) => [d.date_key, d])
  );

  let challengeRows = (
    await pool.query(
      `
        SELECT user_id, shift_date, seq, kind, hour_key, scheduled_at, late_at, absent_at, notified_at, status
        FROM attendance_challenges
        WHERE user_id = $1
          AND shift_date LIKE $2
        ORDER BY seq ASC
      `,
      [user.id, `${monthKey}-%`]
    ).catch(() => ({ rows: [] }))
  ).rows;
  const challengesByDate = new Map();
  for (const row of challengeRows) {
    if (!challengesByDate.has(row.shift_date)) challengesByDate.set(row.shift_date, []);
    challengesByDate.get(row.shift_date).push(row);
  }

  const logsByDate = new Map();
  for (const row of rows) {
    const dateKey = String(row.hour_key).slice(0, 10);
    if (!logsByDate.has(dateKey)) logsByDate.set(dateKey, []);
    logsByDate.get(dateKey).push(row);
  }

  const dateKeys = [...pastOrToday];
  const extra = new Set([...logsByDate.keys(), ...leaveByDate.keys(), ...challengesByDate.keys()]);
  for (const key of extra) {
    if (String(key).startsWith(monthKey) && !dateKeys.includes(key)) dateKeys.push(key);
  }
  dateKeys.sort();

  const days = dateKeys.map((dateKey) => {
    const logs = logsByDate.get(dateKey) || [];
    const dayChallenges = challengesByDate.get(dateKey) || [];
    if (leaveByDate.has(dateKey)) {
      const leaveSlots = (dayChallenges.length
        ? slotsFromChallenges(dayChallenges, {}, now)
        : isRemoteUser(user)
          ? emptyRemoteSlots(dateKey)
          : slotsForUser(dateKey, user)
      ).map((s) => ({ ...s, state: 'leave' }));
      return { date: dateKey, status: 'leave', slots: leaveSlots };
    }
    if (isSundayDateKey(dateKey)) {
      return { date: dateKey, status: 'holiday', slots: [] };
    }
    return buildDayRecord(dateKey, user, logs, now, dayChallenges);
  });

  const hours = workHoursFromUser(user);
  return {
    month: monthKey,
    work_start_hour: hours.start,
    work_end_hour: hours.end,
    days,
    totals: tallyDays(days),
  };
}

function isLateCheckIn(user, hour, minute) {
  const { start, end } = workHoursFromUser(user);
  const grace = Number.isFinite(GRACE_MINUTES) ? GRACE_MINUTES : 10;
  if (hour === start) return minute >= grace;
  if (end <= start) return true;
  return hour > start;
}

function isWithinWorkHours(user, hour) {
  const hours = workHoursFromUser(user);
  return hoursBetween(hours.start, hours.end).includes(Number(hour));
}

module.exports = {
  workHoursFromUser,
  slotsForUser,
  computeDayStatus,
  logsForDate,
  refreshAttendanceDay,
  upsertAttendanceDay,
  buildDayRecord,
  monthHistory,
  tallyDays,
  isLateCheckIn,
  isWithinWorkHours,
};
