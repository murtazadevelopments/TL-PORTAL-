const pool = require('../config/db');
const audit = require('../utils/auditLog');
const permissionsMw = require('../middleware/permissions');
const employeeScope = require('../utils/employeeScope');
const attendanceSchema = require('../utils/attendanceSchema');
const faceMath = require('../utils/faceMath');
const windows = require('../utils/attendanceWindows');
const notifications = require('../services/notifications');
const workHours = require('../utils/workHours');
const attendanceDays = require('../utils/attendanceDays');
const remoteChallenges = require('../utils/remoteAttendanceChallenges');
const { runRemoteAttendanceTick } = require('../services/remoteAttendancePings');
const { normalizeEmploymentType } = require('../utils/employmentType');
const { isSundayDateKey } = require('../utils/workWeek');

function pick(obj, name) {
  const want = String(name).toLowerCase().replace(/_/g, '');
  for (const key of Object.keys(obj || {})) {
    if (String(key).toLowerCase().replace(/_/g, '') === want) return obj[key];
  }
  return undefined;
}

const writeAuditLog = pick(audit, 'writeauditlog');
const loadAdminPermissionAccess = pick(permissionsMw, 'loadadminpermissionaccess');
const isCeoRole = pick(permissionsMw, 'isceorole');
const employeeMatchesScope = pick(employeeScope, 'employeematchesscope');
const scopeWhereClause = pick(employeeScope, 'scopewhereclause');
const normalizeScope = pick(employeeScope, 'normalizescope');
const ensureAttendanceTables = pick(attendanceSchema, 'ensureattendancetables');
const persistUserWorkHours = pick(attendanceSchema, 'persistuserworkhours');
const parseEmbedding = pick(faceMath, 'parseembedding');
const euclideanDistance = pick(faceMath, 'euclideandistance');
const isFaceMatch = pick(faceMath, 'isfacematch');
const MATCH_THRESHOLD = pick(faceMath, 'matchthreshold');
const zonedParts = pick(windows, 'zonedparts');
const currentHourKey = pick(windows, 'currenthourkey');
const canCheckInHourKey = pick(windows, 'cancheckinhourkey');
const TIMEZONE = pick(windows, 'timezone');
const GRACE_MINUTES = pick(windows, 'graceminutes');
const notifyAttendanceFailed = pick(notifications, 'notifyattendancefailed');
const notifyRemoteAttendanceCheck = pick(notifications, 'notifyremoteattendancecheck');
const normalizeWorkHours = pick(workHours, 'normalizeworkhours');
const hoursBetween = pick(workHours, 'hoursbetween');
const formatHourLabel = pick(workHours, 'formathourlabel');
const workHoursFromUser = pick(attendanceDays, 'workhoursfromuser');
const slotsForUser = pick(attendanceDays, 'slotsforuser');
const isLateCheckIn = pick(attendanceDays, 'islatecheckin');
const refreshAttendanceDay = pick(attendanceDays, 'refreshattendanceday');
const monthHistory = pick(attendanceDays, 'monthhistory');
const upsertAttendanceDay = pick(attendanceDays, 'upsertattendanceday');

const recentScores = [];
const checkInAttempts = new Map();

function rememberScore(userId, score) {
  const rounded = Number(score.toFixed(6));
  recentScores.push({ userId, score: rounded, ts: Date.now() });
  if (recentScores.length > 80) recentScores.shift();
  return recentScores.some(
    (row) =>
      row.userId !== userId && row.score === rounded && Date.now() - row.ts < 10 * 60 * 1000
  );
}

function rateLimited(userId) {
  const now = Date.now();
  const row = checkInAttempts.get(userId) || { count: 0, windowStart: now };
  if (now - row.windowStart > 60 * 60 * 1000) {
    row.count = 0;
    row.windowStart = now;
  }
  row.count += 1;
  checkInAttempts.set(userId, row);
  return row.count > 10;
}

async function loadUser(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, role, employment_type, branch, department,
             is_active, status, profile_picture_url, employee_id, shift,
             work_start_hour, work_end_hour, remote_check_request_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

function enrollmentPublic(row) {
  if (!row) return { enrolled: false };
  return {
    enrolled: true,
    sample_count: row.sample_count,
    enrolled_at: row.enrolled_at,
    updated_at: row.updated_at,
  };
}

function slotHourKey(slot) {
  return slot.hour_key || slot.hour_key;
}

async function getEnrollment(req, res) {
  try {
    await ensureAttendanceTables();
    const user = await loadUser(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const { rows } = await pool.query(
      `SELECT sample_count, enrolled_at, updated_at FROM face_enrollments WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    return res.json({
      employment_type: user.employment_type,
      timezone: TIMEZONE,
      threshold: MATCH_THRESHOLD,
      grace_minutes: remoteChallenges.LATE_AFTER_MINUTES,
      start_window_minutes: remoteChallenges.START_ON_TIME_MINUTES,
      absent_after_minutes: remoteChallenges.ABSENT_AFTER_MINUTES,
      respond_target_minutes: remoteChallenges.RESPOND_TARGET_MINUTES,
      checks_per_shift: remoteChallenges.CHECK_COUNT,
      ...enrollmentPublic(rows[0]),
    });
  } catch (err) {
    console.error('getEnrollment error:', err);
    return res.status(500).json({ message: 'Server error loading enrollment.' });
  }
}

async function saveEnrollment(req, res) {
  try {
    await ensureAttendanceTables();
    const user = await loadUser(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (normalizeEmploymentType(user.employment_type) !== 'remote') {
      return res.status(403).json({
        message: 'Face enrollment is only available for remote employees.',
      });
    }

    const embedding = parseEmbedding(req.body?.embedding);
    const sampleCount = Number(req.body?.sample_count || 0);
    if (!embedding) {
      return res.status(400).json({ message: 'A valid face embedding is required.' });
    }
    if (sampleCount < 3 || sampleCount > 5) {
      return res.status(400).json({ message: 'Capture 3 to 5 face samples.' });
    }

    const { rows: existing } = await pool.query(
      `SELECT id FROM face_enrollments WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );

    const { rows } = await pool.query(
      `
        INSERT INTO face_enrollments (user_id, embedding, sample_count, enrolled_at, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW(), NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          embedding = EXCLUDED.embedding,
          sample_count = EXCLUDED.sample_count,
          updated_at = NOW()
        RETURNING sample_count, enrolled_at, updated_at
      `,
      [req.user.id, JSON.stringify(embedding), sampleCount]
    );

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username || user.username,
      action: existing[0] ? 'face_reenroll' : 'face_enroll',
      targetTable: 'face_enrollments',
      targetId: req.user.id,
      reason: existing[0]
        ? 'Remote employee re-enrolled face template'
        : 'Remote employee enrolled face template',
    });

    return res.json({
      message: existing[0] ? 'Face template updated.' : 'Face enrolled.',
      ...enrollmentPublic(rows[0]),
    });
  } catch (err) {
    console.error('saveEnrollment error:', err);
    return res.status(500).json({ message: 'Server error saving enrollment.' });
  }
}

async function getMyAttendance(req, res) {
  try {
    await ensureAttendanceTables();
    const user = await loadUser(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const now = new Date();
    const parts = zonedParts(now);
    const shiftDate =
      String(req.query.date || '').slice(0, 10) ||
      remoteChallenges.activeShiftDate(now, user) ||
      remoteChallenges.currentShiftDateKey(now, user) ||
      parts.dateKey;
    const hours = workHoursFromUser(user);

    const sundayHoliday = isSundayDateKey(shiftDate);
    if (normalizeEmploymentType(user.employment_type) === 'remote' && !sundayHoliday) {
      const active = remoteChallenges.activeShiftDate(now, user);
      if (!req.query.date && active) {
        await remoteChallenges.ensureChallengesForUser(user, active);
      } else if (req.query.date === shiftDate && active === shiftDate) {
        await remoteChallenges.ensureChallengesForUser(user, shiftDate);
      }
    }

    const challengeRows = await remoteChallenges.loadChallenges(req.user.id, shiftDate);
    const { rows } = await pool.query(
      `
        SELECT id, hour_key AS hour_key, status, method, match_score, checked_in_at, note, created_at
        FROM attendance_logs
        WHERE user_id = $1
          AND hour_key LIKE $2
        ORDER BY hour_key ASC, created_at ASC
      `,
      [req.user.id, `${shiftDate}-%`]
    );

    const byHour = {};
    for (const row of rows) {
      const prev = byHour[row.hour_key];
      const better =
        !prev ||
        ((row.status === 'verified' || row.status === 'late') &&
          prev.status !== 'verified' &&
          prev.status !== 'late');
      if (better) byHour[row.hour_key] = row;
    }

    const revealAdmin = false;
    const timeline = (challengeRows.length
      ? remoteChallenges.sortRemoteChecks(challengeRows).map((row, i) => {
          const pub = remoteChallenges.publicChallenge(row, { revealFuture: revealAdmin, now });
          const seq = i + 1;
          const log = byHour[row.hour_key];
          return {
            ...pub,
            seq,
            label:
              seq === 1
                ? `Shift start (${remoteChallenges.formatClock(row.scheduled_at)})`
                : pub.state === 'upcoming'
                  ? `Availability check ${seq}`
                  : `Check ${seq} (${remoteChallenges.formatClock(row.scheduled_at)})`,
            log: log
              ? {
                  id: log.id,
                  status: log.status,
                  method: log.method,
                  checked_in_at: log.checked_in_at,
                  note: log.note,
                }
              : null,
          };
        })
      : []
    );

    const opened = sundayHoliday ? null : remoteChallenges.openChallenge(challengeRows, now);
    const canCheckIn = Boolean(!sundayHoliday && opened?.pub?.can_check_in);
    const month = await monthHistory(user, shiftDate.slice(0, 7));
    return res.json({
      date: shiftDate,
      timezone: TIMEZONE,
      current_hour_key: opened?.pub?.hour_key || null,
      can_check_in: canCheckIn,
      open_check: opened?.pub || null,
      work_start_hour: hours.start,
      work_end_hour: hours.end,
      work_hours_label: `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
      start_window_minutes: remoteChallenges.START_ON_TIME_MINUTES,
      late_after_minutes: remoteChallenges.LATE_AFTER_MINUTES,
      absent_after_minutes: remoteChallenges.ABSENT_AFTER_MINUTES,
      respond_target_minutes: remoteChallenges.RESPOND_TARGET_MINUTES,
      checks_per_shift: remoteChallenges.CHECK_COUNT,
      holiday: sundayHoliday,
      timeline: sundayHoliday ? [] : timeline,
      month: month.month,
      totals: month.totals,
      days: month.days,
    });
  } catch (err) {
    console.error('getMyAttendance error:', err);
    return res.status(500).json({ message: 'Server error loading attendance.' });
  }
}

async function checkIn(req, res) {
  try {
    await ensureAttendanceTables();
    const user = await loadUser(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (normalizeEmploymentType(user.employment_type) !== 'remote') {
      return res.status(403).json({ message: 'Face check-in is only for remote employees.' });
    }
    if (rateLimited(req.user.id)) {
      return res.status(429).json({ message: 'Too many check-in attempts. Try again later.' });
    }

    const now = new Date();
    const shiftDate = remoteChallenges.activeShiftDate(now, user);
    if (!shiftDate || isSundayDateKey(shiftDate)) {
      return res.status(400).json({
        message: isSundayDateKey(shiftDate)
          ? 'Sunday is a holiday. Attendance checks are not required.'
          : 'There is no open attendance check during this shift.',
      });
    }
    const challengeRows = await remoteChallenges.ensureChallengesForUser(user, shiftDate);
    const opened = remoteChallenges.openChallenge(challengeRows, now);
    if (!opened) {
      return res.status(400).json({
        message:
          'No attendance check is open right now. Wait for your shift-start window or a random availability ping.',
      });
    }
    const challenge = opened.row;
    const hourKey = challenge.hour_key;

    const livenessOk = Boolean(pick(req.body || {}, 'livenesspassed'));
    const livenessAction = String(pick(req.body || {}, 'livenessaction') || '').trim();
    if (!livenessOk || !livenessAction) {
      return res.status(400).json({ message: 'Complete the liveness prompt before check-in.' });
    }

    const probe = parseEmbedding(req.body?.embedding);
    if (!probe) {
      return res.status(400).json({ message: 'A valid face embedding is required.' });
    }

    const { rows: enrolled } = await pool.query(
      `SELECT embedding FROM face_enrollments WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (!enrolled[0]) {
      return res.status(400).json({ message: 'Enroll your face before checking in.' });
    }
    const stored = parseEmbedding(enrolled[0].embedding);
    if (!stored) {
      return res.status(500).json({ message: 'Stored face template is invalid. Please re-enroll.' });
    }

    const { rows: already } = await pool.query(
      `
        SELECT id, status, method FROM attendance_logs
        WHERE user_id = $1 AND hour_key = $2
          AND (status IN ('verified', 'missed', 'late', 'leave') OR method = 'manual')
        LIMIT 1
      `,
      [req.user.id, hourKey]
    );
    if (already[0]) {
      return res.status(409).json({
        message: 'This check is already recorded.',
        hour_key: hourKey,
        status: already[0].status,
      });
    }

    const distance = euclideanDistance(stored, probe);
    const matched = isFaceMatch(distance);
    const suspicious = rememberScore(req.user.id, distance);
    const late = matched && now.getTime() >= new Date(challenge.late_at).getTime();
    const status = !matched ? 'failed' : late ? 'late' : 'verified';

    const { rows } = await pool.query(
      `
        INSERT INTO attendance_logs (
          user_id, checked_in_at, hour_key, match_score, method, status, note
        )
        VALUES ($1, NOW(), $2, $3, 'face', $4, $5)
        RETURNING id, hour_key AS hour_key, status, method, match_score, checked_in_at
      `,
      [req.user.id, hourKey, distance, status, suspicious ? 'flagged_similar_score' : null]
    );

    if (matched) {
      await remoteChallenges.markChallengeResult(challenge, status, rows[0].id);
      await refreshAttendanceDay(user, hourKey.slice(0, 10), {
        firstCheckIn: rows[0].checked_in_at,
      });
    }

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username || user.username,
      action: matched ? 'attendance_verified' : 'attendance_failed',
      targetTable: 'attendance_logs',
      targetId: rows[0].id,
      reason: matched
        ? `Face check-in verified for ${hourKey}`
        : `Face check-in failed for ${hourKey}`,
    });

    if (!matched) {
      const { rows: fails } = await pool.query(
        `
          SELECT COUNT(*)::int AS n FROM attendance_logs
          WHERE user_id = $1 AND hour_key = $2 AND status = 'failed'
        `,
        [req.user.id, hourKey]
      );
      if (fails[0]?.n >= 3) {
        notifyAttendanceFailed(user, hourKey).catch((err) => {
          console.error('notifyAttendanceFailed:', err.message || err);
        });
      }
      return res.status(422).json({
        message: 'Face did not match your enrolled template. Look at the camera and try again.',
        matched: false,
        status,
        hour_key: hourKey,
        log: {
          id: rows[0].id,
          status: rows[0].status,
          method: rows[0].method,
          checked_in_at: rows[0].checked_in_at,
        },
      });
    }

    return res.status(201).json({
      matched,
      status,
      hour_key: hourKey,
      log: {
        id: rows[0].id,
        status: rows[0].status,
        method: rows[0].method,
        checked_in_at: rows[0].checked_in_at,
      },
    });
  } catch (err) {
    console.error('checkIn error:', err);
    return res.status(500).json({ message: 'Server error during check-in.' });
  }
}

async function resolveAttendanceScope(req, permissionKey) {
  if (isCeoRole(req.user?.role)) return { type: 'all' };
  const access = await loadAdminPermissionAccess(req.user.id);
  const scopes = access.scopes || {};
  const keys = access.permissions || [];
  if (!keys.includes('employees:remote') && !keys.includes('*')) {
    return { type: 'branch', values: [] };
  }
  if (permissionKey === 'attendance:edit') {
    return normalizeScope(scopes['employees:remote'] || scopes['attendance:edit']);
  }
  return normalizeScope(
    scopes['employees:remote'] || scopes['attendance:view'] || scopes['attendance:edit']
  );
}

const CHECK_REQUEST_COOLDOWN_MS = 60 * 60 * 1000;
const CHECK_DONE_STATES = new Set(['verified', 'late', 'missed']);

function checkInRequestGate(now, lastRequestAt, completedCount) {
  if (Number(completedCount) >= remoteChallenges.CHECK_COUNT) {
    return { allowed: false, reason: 'complete', available_at: null };
  }
  const last = lastRequestAt ? new Date(lastRequestAt).getTime() : 0;
  if (Number.isFinite(last) && last > 0 && now.getTime() - last < CHECK_REQUEST_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: 'cooldown',
      available_at: new Date(last + CHECK_REQUEST_COOLDOWN_MS).toISOString(),
    };
  }
  return { allowed: true, reason: null, available_at: null };
}

async function adminOverview(req, res) {
  try {
    await ensureAttendanceTables();
    const parts = zonedParts();
    const dateKey = String(req.query.date || parts.dateKey).slice(0, 10);
    const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const branchFilter = String(req.query.branch || '').trim().toLowerCase();

    const viewScope = await resolveAttendanceScope(req, 'attendance:view');
    const editScope = isCeoRole(req.user?.role)
      ? { type: 'all' }
      : await resolveAttendanceScope(req, 'attendance:edit');
    const filter = scopeWhereClause(viewScope, 1);

    const { rows: people } = await pool.query(
      `
        SELECT id, employee_id, name, username, branch, department, employment_type,
               profile_picture_url, shift, is_active, status, work_start_hour, work_end_hour,
               remote_check_request_at
        FROM users
        WHERE is_active = true
          AND status = 'active'
          AND employment_type = 'remote'
          ${filter.sql}
        ORDER BY name ASC NULLS LAST, id ASC
      `,
      filter.params
    );

    const ids = people.map((p) => p.id);
    const now = new Date();
    const challengeDates = new Set([dateKey]);
    for (const person of people) {
      const activeDate = remoteChallenges.activeShiftDate(now, person);
      if (activeDate) challengeDates.add(activeDate);
    }
    let logs = [];
    let challengeRows = [];
    if (ids.length) {
      const { rows } = await pool.query(
        `
          SELECT DISTINCT ON (user_id, hour_key)
            id, user_id, hour_key AS hour_key, status, method, match_score, checked_in_at, note, marked_by
          FROM attendance_logs
          WHERE user_id = ANY($1::int[])
            AND hour_key LIKE $2
          ORDER BY user_id, hour_key, created_at DESC
        `,
        [ids, `${dateKey}-%`]
      );
      logs = rows;
      const loaded = await pool.query(
        `
          SELECT user_id, shift_date, seq, kind, hour_key, scheduled_at, late_at, absent_at, notified_at, status
          FROM attendance_challenges
          WHERE user_id = ANY($1::int[])
            AND shift_date = ANY($2::text[])
          ORDER BY seq ASC
        `,
        [ids, [...challengeDates]]
      );
      challengeRows = loaded.rows;
    }

    const logsByUser = new Map();
    for (const log of logs) {
      const uid = String(log.user_id);
      if (!logsByUser.has(uid)) logsByUser.set(uid, []);
      logsByUser.get(uid).push(log);
    }
    const challengesByUser = new Map();
    for (const row of challengeRows) {
      const uid = String(row.user_id);
      if (!challengesByUser.has(uid)) challengesByUser.set(uid, []);
      challengesByUser.get(uid).push(row);
    }

    const { rows: dayRows } = ids.length
      ? await pool.query(
          `SELECT user_id, status FROM attendance_days WHERE date_key = $1 AND user_id = ANY($2::int[])`,
          [dateKey, ids]
        )
      : { rows: [] };
    const dayByUser = new Map(dayRows.map((d) => [String(d.user_id), d.status]));

    const employees = people
      .map((person) => {
        const personLogs = logsByUser.get(String(person.id)) || [];
        const latest = personLogs[0] || null;
        const mapped = remoteChallenges
          .sortRemoteChecks(
            (challengesByUser.get(String(person.id)) || []).filter((row) => String(row.shift_date).slice(0, 10) === dateKey)
          )
          .map((row, i) => {
          const pub = remoteChallenges.publicChallenge(row, { revealFuture: true, now });
          const seq = i + 1;
          const log = personLogs.find((l) => l.hour_key === row.hour_key);
          let state = pub.state;
          if (log?.status === 'verified') state = 'verified';
          else if (log?.status === 'late') state = 'late';
          else if (log?.status === 'missed') state = 'missed';
          else if (log?.status === 'failed') state = 'failed';
          else if (log?.status === 'leave') state = 'leave';
          return {
            ...pub,
            seq,
            hour_key: row.hour_key,
            label: seq === 1 ? 'Start' : `Check ${seq}`,
            state,
            method: log?.method || null,
          };
        });
        const sundayHoliday = isSundayDateKey(dateKey);
        const slots = sundayHoliday
          ? []
          : mapped.length
            ? mapped
            : [1, 2, 3, 4, 5].map((seq) => ({
                seq,
                hour_key: `${dateKey}-c${seq}`,
                label: seq === 1 ? 'Start' : `Check ${seq}`,
                state: 'pending',
                method: null,
              }));
        const verifiedCount = slots.filter(
          (s) => s.state === 'verified' || s.state === 'late'
        ).length;
        const missedCount = slots.filter((s) => s.state === 'missed').length;
        const failedCount = slots.filter((s) => s.state === 'failed').length;
        const manualCount = personLogs.filter((l) => l.method === 'manual').length;

        let rowStatus = dayByUser.get(String(person.id)) || (sundayHoliday ? 'holiday' : 'pending');
        if (rowStatus === 'pending' && !sundayHoliday) {
          if (missedCount > 0 && verifiedCount === 0) rowStatus = 'missed';
          else if (failedCount > 0 && verifiedCount === 0) rowStatus = 'failed';
          else if (verifiedCount > 0) rowStatus = 'verified';
        }
        if (sundayHoliday && rowStatus !== 'leave') rowStatus = 'holiday';

        const activeDate = remoteChallenges.activeShiftDate(now, person);
        const activeRows = (challengesByUser.get(String(person.id)) || []).filter(
          (row) => String(row.shift_date).slice(0, 10) === String(activeDate || '')
        );
        const doneCount = activeRows.filter((row) => CHECK_DONE_STATES.has(row.status)).length;
        let requestGate = { allowed: false, reason: 'no_shift', available_at: null };
        if (activeDate && isSundayDateKey(activeDate)) {
          requestGate = { allowed: false, reason: 'holiday', available_at: null };
        } else if (activeDate) {
          requestGate = checkInRequestGate(now, person.remote_check_request_at, doneCount);
        }

        const hours = workHoursFromUser(person);
        return {
          id: person.id,
          employee_id: person.employee_id,
          name: person.name,
          username: person.username,
          branch: person.branch,
          department: person.department,
          shift: person.shift,
          employment_type: person.employment_type,
          profile_picture_url: person.profile_picture_url && !/^https?:\/\//i.test(String(person.profile_picture_url))
            ? `/api/documents/${person.id}/profile`
            : person.profile_picture_url,
          work_start_hour: hours.start,
          work_end_hour: hours.end,
          work_hours_label: `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
          day_status: rowStatus,
          can_manual: employeeMatchesScope(person, editScope),
          can_delete: Boolean(
            isCeoRole(req.user?.role) && (personLogs.length > 0 || dayByUser.has(String(person.id)))
          ),
          row_status: rowStatus,
          verified_count: verifiedCount,
          missed_count: missedCount,
          manual_count: manualCount,
          slots,
          latest,
          can_check_in_request: Boolean(requestGate.allowed),
          check_in_request_reason: requestGate.reason,
          check_in_request_available_at: requestGate.available_at,
        };
      })
      .filter((row) => {
        if (
          branchFilter &&
          branchFilter !== 'all' &&
          String(row.branch || '').trim().toLowerCase() !== branchFilter
        ) {
          return false;
        }
        if (statusFilter !== 'all' && row.row_status !== statusFilter) return false;
        if (!search) return true;
        const blob = `${row.name} ${row.username} ${row.employee_id} ${row.branch} ${row.department}`.toLowerCase();
        return blob.includes(search);
      });

    let verified = 0;
    let missed = 0;
    let manual = 0;
    let failed = 0;
    for (const row of employees) {
      verified += row.verified_count;
      missed += row.missed_count;
      failed += (row.slots || []).filter((s) => s.state === 'failed').length;
      manual += row.manual_count || 0;
    }

    const branches = [
      ...new Set(
        people
          .map((p) => String(p.branch || '').trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    return res.json({
      date: dateKey,
      timezone: TIMEZONE,
      summary: { verified, missed, failed, manual, employees: employees.length },
      employees,
      branches,
    });
  } catch (err) {
    console.error('adminOverview error:', err);
    return res.status(500).json({ message: 'Server error loading attendance overview.' });
  }
}

async function adminManualMark(req, res) {
  try {
    await ensureAttendanceTables();
    const targetId = Number(req.params.userId);
    const hourKey = String(req.body?.hour_key || req.body?.hour_key || '').trim();
    const dateKey = String(req.body?.date_key || req.body?.date_key || hourKey.slice(0, 10)).slice(
      0,
      10
    );
    const status = String(req.body?.status || 'verified').trim().toLowerCase();
    const note = String(req.body?.note || '').trim();

    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ message: 'Invalid employee id.' });
    }
    if (!['verified', 'missed', 'late', 'leave'].includes(status)) {
      return res.status(400).json({ message: 'status must be verified, late, missed, or leave.' });
    }
    if (status !== 'leave' && !/^\d{4}-\d{2}-\d{2}-(?:\d{2}|c[1-5])$/.test(hourKey)) {
      return res.status(400).json({ message: 'hour_key must look like YYYY-MM-DD-c1 (check 1–5).' });
    }
    if (status === 'leave' && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ message: 'date_key must look like YYYY-MM-DD.' });
    }
    const stampDay = status === 'leave' ? dateKey : hourKey.slice(0, 10);
    const today = zonedParts().dateKey;
    const yesterday = (() => {
      const [y, mo, d] = today.split('-').map(Number);
      return new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
    })();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stampDay) || stampDay > today) {
      return res.status(400).json({
        message: isCeoRole(req.user?.role)
          ? 'Manual attendance cannot be saved for a future date.'
          : 'Manual attendance can only be saved for today or yesterday.',
      });
    }
    if (!isCeoRole(req.user?.role) && stampDay < yesterday) {
      return res.status(400).json({ message: 'Manual attendance can only be saved for today or yesterday.' });
    }
    if (note.length < 8) {
      return res.status(400).json({ message: 'A reason of at least 8 characters is required.' });
    }

    const target = await loadUser(targetId);
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (target.employment_type !== 'remote') {
      return res.status(400).json({ message: 'Attendance is only tracked for remote employees.' });
    }

    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    if (!isCeoRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
      return res.status(403).json({
        message: 'You can only mark attendance for employees in your assigned branch or team.',
      });
    }

    if (status === 'leave') {
      await upsertAttendanceDay(targetId, dateKey, 'leave', {
        note,
        markedBy: req.user.id,
      });
      await refreshAttendanceDay(target, dateKey, {
        forceStatus: 'leave',
        note,
        markedBy: req.user.id,
      });
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'attendance_leave',
        targetTable: 'attendance_days',
        targetId: targetId,
        reason: `Leave for user ${targetId} on ${dateKey}: ${note}`,
      });
      return res.status(201).json({ message: 'Leave recorded.', date_key: dateKey, status: 'leave' });
    }

    const { rows: existing } = await pool.query(
      `
        SELECT id FROM attendance_logs
        WHERE user_id = $1 AND hour_key = $2
          AND (status IN ('verified', 'missed', 'late', 'leave') OR method = 'manual')
        LIMIT 1
      `,
      [targetId, hourKey]
    );

    let log;
    if (existing[0]) {
      const updated = await pool.query(
        `
          UPDATE attendance_logs
          SET status = $1,
              method = 'manual',
              marked_by = $2,
              note = $3,
              match_score = NULL,
              checked_in_at = NOW()
          WHERE id = $4
          RETURNING id, hour_key AS hour_key, status, method, checked_in_at, note
        `,
        [status, req.user.id, note, existing[0].id]
      );
      log = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `
          INSERT INTO attendance_logs (
            user_id, checked_in_at, hour_key, match_score, method, status, marked_by, note
          )
          VALUES ($1, NOW(), $2, NULL, 'manual', $3, $4, $5)
          RETURNING id, hour_key AS hour_key, status, method, checked_in_at, note
        `,
        [targetId, hourKey, status, req.user.id, note]
      );
      log = inserted.rows[0];
    }

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance_manual',
      targetTable: 'attendance_logs',
      targetId: log.id,
      reason: `Manual ${status} for user ${targetId} slot ${hourKey}: ${note}`,
    });

    await refreshAttendanceDay(target, hourKey.slice(0, 10), { note, markedBy: req.user.id });
    const { rows: challengeHit } = await pool.query(
      `SELECT id, status FROM attendance_challenges WHERE user_id = $1 AND hour_key = $2 LIMIT 1`,
      [targetId, hourKey]
    );
    if (challengeHit[0] && ['verified', 'late', 'missed'].includes(status)) {
      await pool.query(
        `UPDATE attendance_challenges SET status = $1, attendance_log_id = $2 WHERE id = $3`,
        [status, log.id, challengeHit[0].id]
      );
    }

    return res.status(201).json({ message: 'Attendance updated.', log });
  } catch (err) {
    console.error('adminManualMark error:', err);
    return res.status(500).json({ message: 'Server error saving manual attendance.' });
  }
}

async function adminRequestCheckIn(req, res) {
  try {
    await ensureAttendanceTables();
    const targetId = Number(req.params.userId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ message: 'Invalid employee.' });
    }
    const target = await loadUser(targetId);
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (normalizeEmploymentType(target.employment_type) !== 'remote') {
      return res.status(400).json({ message: 'Check-in requests are only for remote employees.' });
    }
    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    if (!isCeoRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }

    const now = new Date();
    const shiftDate = remoteChallenges.activeShiftDate(now, target);
    if (!shiftDate || isSundayDateKey(shiftDate)) {
      return res.status(400).json({
        message: 'This employee is not in an active shift right now.',
      });
    }

    await remoteChallenges.ensureChallengesForUser(target, shiftDate, now);
    const rows = await remoteChallenges.loadChallenges(targetId, shiftDate);
    const doneCount = rows.filter((row) => CHECK_DONE_STATES.has(row.status)).length;
    const gate = checkInRequestGate(now, target.remote_check_request_at, doneCount);
    if (!gate.allowed && gate.reason === 'complete') {
      return res.status(409).json({
        message: 'All five checks for this shift are already recorded. The button opens again on the next shift day.',
      });
    }
    if (!gate.allowed && gate.reason === 'cooldown') {
      return res.status(429).json({
        message: 'Wait at least 1 hour after a check-in request before sending another.',
        available_at: gate.available_at,
      });
    }

    const openable = rows.filter((row) => ['pending', 'notified'].includes(row.status));
    if (!openable.length) {
      return res.status(409).json({
        message: 'All five checks for this shift are already recorded. The button opens again on the next shift day.',
      });
    }

    const inWindow = openable.find((row) => {
      const startAt = new Date(row.scheduled_at).getTime();
      const absentAt = new Date(row.absent_at).getTime();
      return startAt <= now.getTime() && now.getTime() < absentAt;
    });
    const chosen =
      inWindow ||
      [...openable].sort((a, b) => Number(a.seq) - Number(b.seq))[0];

    const opened = inWindow
      ? chosen
      : await remoteChallenges.reopenForImmediateCheck(chosen, now);
    if (!opened) {
      return res.status(409).json({ message: 'Could not open a check for this employee.' });
    }

    await notifyRemoteAttendanceCheck(target, opened);
    await remoteChallenges.markNotified(opened.id, now);
    await pool.query(`UPDATE users SET remote_check_request_at = $2 WHERE id = $1`, [target.id, now]);

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance.check_in_request',
      targetTable: 'attendance_challenges',
      targetId: opened.id,
      reason: `Sent check-in request to employee id ${target.id} for shift ${shiftDate} check ${opened.seq}`,
    });

    return res.json({
      message: 'Check-in request sent. The employee will get the usual attendance notification.',
    });
  } catch (err) {
    console.error('adminRequestCheckIn error:', err);
    return res.status(500).json({ message: 'Server error sending check-in request.' });
  }
}

async function markMissedSlots(now = new Date()) {
  return runRemoteAttendanceTick(now);
}

async function adminSetHours(req, res) {
  try {
    await ensureAttendanceTables();
    const targetId = Number(req.params.userId);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ message: 'Invalid employee id.' });
    }
    const hours = normalizeWorkHours(
      req.body?.work_start_hour ?? req.body?.work_start_hour,
      req.body?.work_end_hour ?? req.body?.work_end_hour
    );
    const target = await loadUser(targetId);
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    if (!isCeoRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }
    await persistUserWorkHours(targetId, hours.start, hours.end);
    const updated = await loadUser(targetId);
    const shiftDate =
      remoteChallenges.activeShiftDate(new Date(), updated) ||
      remoteChallenges.currentShiftDateKey(new Date(), updated);
    if (shiftDate && !isSundayDateKey(shiftDate)) {
      await remoteChallenges.dropOpenChallenges(targetId, shiftDate);
      await remoteChallenges.ensureChallengesForUser(updated, shiftDate);
    }
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance_hours',
      targetTable: 'users',
      targetId: targetId,
      reason: `Set working hours ${hours.start}:00–${hours.end}:00`,
    });
    return res.json({
      message: 'Working hours updated.',
      work_start_hour: hours.start,
      work_end_hour: hours.end,
      work_hours_label: `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
    });
  } catch (err) {
    console.error('adminSetHours error:', err);
    return res.status(500).json({ message: 'Server error saving working hours.' });
  }
}

async function adminEmployeeDays(req, res) {
  try {
    await ensureAttendanceTables();
    const targetId = Number(req.params.userId);
    const target = await loadUser(targetId);
    if (!target) return res.status(404).json({ message: 'Employee not found.' });
    const viewScope = await resolveAttendanceScope(req, 'attendance:view');
    if (!isCeoRole(req.user?.role) && !employeeMatchesScope(target, viewScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance view scope.' });
    }
    const parts = zonedParts();
    const month = String(req.query.month || parts.dateKey.slice(0, 7)).slice(0, 7);
    const history = await monthHistory(target, month);
    return res.json({
      employee: {
        id: target.id,
        name: target.name,
        employee_id: target.employee_id,
        work_start_hour: workHoursFromUser(target).start,
        work_end_hour: workHoursFromUser(target).end,
      },
      ...history,
    });
  } catch (err) {
    console.error('adminEmployeeDays error:', err);
    return res.status(500).json({ message: 'Server error loading attendance history.' });
  }
}

async function getMyHistory(req, res) {
  try {
    await ensureAttendanceTables();
    const user = await loadUser(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const parts = zonedParts();
    const month = String(req.query.month || parts.dateKey.slice(0, 7)).slice(0, 7);
    const history = await monthHistory(user, month);
    return res.json(history);
  } catch (err) {
    console.error('getMyHistory error:', err);
    return res.status(500).json({ message: 'Server error loading attendance history.' });
  }
}

/**
 * DELETE /api/admin/attendance/:userId/days/:dateKey
 * CEO only — removes remote face/manual logs and the day rollup for that date.
 */
async function adminDeleteRemoteDay(req, res) {
  try {
    if (!isCeoRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only the CEO can delete attendance.' });
    }
    await ensureAttendanceTables();
    const userId = Number(req.params.userId);
    const dateKey = String(req.params.dateKey || '').slice(0, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid employee.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ message: 'date must look like YYYY-MM-DD.' });
    }

    const user = await loadUser(userId);
    if (!user) return res.status(404).json({ message: 'Employee not found.' });

    const { rowCount: logCount } = await pool.query(
      `DELETE FROM attendance_logs WHERE user_id = $1 AND hour_key LIKE $2`,
      [userId, `${dateKey}-%`]
    );
    const { rowCount: challengeCount } = await pool.query(
      `DELETE FROM attendance_challenges WHERE user_id = $1 AND shift_date = $2`,
      [userId, dateKey]
    );
    const { rowCount: dayCount } = await pool.query(
      `DELETE FROM attendance_days WHERE user_id = $1 AND date_key = $2`,
      [userId, dateKey]
    );
    if (!logCount && !dayCount && !challengeCount) {
      return res.status(404).json({ message: 'No attendance found for that date.' });
    }

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance.delete_day',
      targetTable: 'attendance_logs',
      targetId: userId,
      reason: `Deleted remote attendance for ${user.name || user.username} (${user.employee_id || user.id}) on ${dateKey} (${logCount} log(s), ${challengeCount} check(s), ${dayCount} day row(s))`,
    });

    return res.json({
      message: `Deleted attendance for ${dateKey}.`,
      logs_deleted: logCount,
      day_deleted: dayCount,
    });
  } catch (err) {
    console.error('adminDeleteRemoteDay error:', err);
    return res.status(500).json({ message: 'Server error deleting attendance.' });
  }
}

module.exports = {
  getEnrollment,
  saveEnrollment,
  getMyAttendance,
  getMyHistory,
  checkIn,
  adminOverview,
  adminManualMark,
  adminRequestCheckIn,
  adminSetHours,
  adminEmployeeDays,
  adminDeleteRemoteDay,
  markMissedSlots,
};
