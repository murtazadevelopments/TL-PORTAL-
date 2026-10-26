const pool = require('../config/db');
const audit = require('../utils/auditLog');
const {
  loadAdminPermissionAccess,
  isCeoRole,
  isManagerRole,
  isCeoOrManagerRole,
} = require('../middleware/permissions');
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
const { addDaysKey } = require('../utils/remoteCheckWindows');
const {
  userAttendanceEnabled,
  setUserAttendanceEnabled,
  rejectIfUserAttendanceStopped,
} = require('../utils/attendanceEnabled');
const { userFlexibleHours, setUserFlexibleHours } = require('../utils/flexibleHours');
const {
  workDaysFromUser,
  workDaysSummary,
  isAttendanceHoliday,
  setUserWorkDays,
} = require('../utils/workDays');
const {
  userFaceCheckCapture,
  setUserFaceCheckCapture,
  saveCheckInSnapshot,
  streamCaptureImage,
  listCapturesForUserMonth,
} = require('../utils/faceCheckCapture');
const { notifyRemoteAttendanceOpened } = require('../utils/attendanceReviewEmail');
const { notifyAfterResponse } = require('../utils/notifyAfterResponse');
const {
  isRemoteProfileIncomplete,
  rejectIfRemoteProfileIncomplete,
  PROFILE_INCOMPLETE_ATTENDANCE_MESSAGE,
} = require('../utils/profileCompleteness');

function pick(obj, name) {
  const want = String(name).toLowerCase().replace(/_/g, '');
  for (const key of Object.keys(obj || {})) {
    if (String(key).toLowerCase().replace(/_/g, '') === want) return obj[key];
  }
  return undefined;
}

const writeAuditLog = pick(audit, 'writeauditlog');

function hasFullAttendanceDays(role) {
  return Boolean(isCeoOrManagerRole(role) || isCeoRole(role) || isManagerRole(role));
}
const employeeMatchesScope = pick(employeeScope, 'employeematchesscope');
const scopeWhereClause = pick(employeeScope, 'scopewhereclause');
const normalizeScope = pick(employeeScope, 'normalizescope');
const ensureAttendanceTables = pick(attendanceSchema, 'ensureattendancetables');
const persistUserWorkHours = pick(attendanceSchema, 'persistuserworkhours');
const persistRemoteCheckCount = pick(attendanceSchema, 'persistremotecheckcount');
const parseEmbedding = pick(faceMath, 'parseembedding');
const embeddingDistance =
  pick(faceMath, 'embeddingdistance') || faceMath.embeddingDistance || faceMath.euclideanDistance;
const isFaceMatch = pick(faceMath, 'isfacematch');
const MATCH_THRESHOLD = pick(faceMath, 'matchthreshold');
const zonedParts = pick(windows, 'zonedparts');
const currentHourKey = pick(windows, 'currenthourkey');
const canCheckInHourKey = pick(windows, 'cancheckinhourkey');
const TIMEZONE = pick(windows, 'timezone');
const GRACE_MINUTES = pick(windows, 'graceminutes');
const notifyAttendanceFailed = pick(notifications, 'notifyattendancefailed');
const notifyRemoteAttendanceCheck = pick(notifications, 'notifyremoteattendancecheck');
const notifyCeoRemoteFaceAttendance =
  pick(notifications, 'notifyceoremotefaceattendance') || notifications.notifyCeoRemoteFaceAttendance;
const queueCeoBranchManagerNotice = pick(notifications, 'queueceobranchmanagernotice');
const normalizeWorkHours = pick(workHours, 'normalizeworkhours');
const hoursBetween = pick(workHours, 'hoursbetween');
const formatHourLabel = pick(workHours, 'formathourlabel');
const workHoursFromUser = pick(attendanceDays, 'workhoursfromuser');
const slotsForUser = pick(attendanceDays, 'slotsforuser');
const isLateCheckIn = pick(attendanceDays, 'islatecheckin');
const refreshAttendanceDay = pick(attendanceDays, 'refreshattendanceday');
const monthHistory = pick(attendanceDays, 'monthhistory');
const upsertAttendanceDay = pick(attendanceDays, 'upsertattendanceday');
const formatDurationMinutes = pick(attendanceDays, 'formatdurationminutes');

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
             is_active, status, profile_picture_url, employee_id, shift, designation,
             work_start_hour, work_end_hour, remote_check_request_at, attendance_enabled,
             remote_check_count, flexible_hours, six_day_week, work_days, face_check_capture, staff_kind,
             reference_person, emergency_contact_name, emergency_contact_number,
             bank_name, account_title, iban, account_number,
             cnic_front_url, cnic_back_url, cv_url
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
      checks_per_shift: remoteChallenges.checkCountFromUser(user),
      flexible_hours: userFlexibleHours(user),
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
    if (existing[0]) {
      return res.status(409).json({
        message: 'Your face is already enrolled. Enrollment can only be done once.',
      });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO face_enrollments (user_id, embedding, sample_count, enrolled_at, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW(), NOW())
        ON CONFLICT (user_id) DO NOTHING
        RETURNING sample_count, enrolled_at, updated_at
      `,
      [req.user.id, JSON.stringify(embedding), sampleCount]
    );
    if (!rows[0]) {
      return res.status(409).json({
        message: 'Your face is already enrolled. Enrollment can only be done once.',
      });
    }

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username || user.username,
      action: 'face_enroll',
      targetTable: 'face_enrollments',
      targetId: req.user.id,
      reason: 'Remote employee enrolled face template',
    });

    return res.json({
      message: 'Face enrolled.',
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

    const sundayHoliday = isAttendanceHoliday(user, shiftDate);
    const attendanceEnabled = userAttendanceEnabled(user);
    const profileComplete = !isRemoteProfileIncomplete(user);
    if (
      attendanceEnabled &&
      profileComplete &&
      normalizeEmploymentType(user.employment_type) === 'remote'
    ) {
      const active = remoteChallenges.activeShiftDate(now, user);
      if (!req.query.date && active) {
        await remoteChallenges.ensureChallengesForUser(user, active);
      } else if (req.query.date === shiftDate && active === shiftDate) {
        await remoteChallenges.ensureChallengesForUser(user, shiftDate);
      }
    }

    const challengeRows = await remoteChallenges.loadChallenges(req.user.id, shiftDate);
    const [{ rows }, lastPunch] = await Promise.all([
      pool.query(
        `
          SELECT id, hour_key AS hour_key, status, method, match_score, checked_in_at, note, created_at
          FROM attendance_logs
          WHERE user_id = $1
            AND hour_key LIKE $2
          ORDER BY hour_key ASC, created_at ASC
        `,
        [req.user.id, `${shiftDate}-%`]
      ),
      pool.query(
        `
          SELECT checked_in_at
          FROM attendance_logs
          WHERE user_id = $1
            AND checked_in_at IS NOT NULL
          ORDER BY checked_in_at DESC
          LIMIT 1
        `,
        [req.user.id]
      ),
    ]);

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
          const pub = remoteChallenges.publicChallenge(row, {
            revealFuture: revealAdmin,
            now,
            user,
          });
          const seq = i + 1;
          const log = byHour[row.hour_key];
          return {
            ...pub,
            seq,
            label:
              row.kind === 'checkout'
                ? 'Check out'
                : seq === 1
                  ? `First check-in (${remoteChallenges.formatClock(pub.scheduled_at || row.scheduled_at)})`
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

    const opened = sundayHoliday ? null : remoteChallenges.openChallenge(challengeRows, now, user);
    const onShift = remoteChallenges.isOnShift(
      now,
      user,
      remoteChallenges.activeShiftDate(now, user, { includeLead: false })
    );
    const canCheckIn = Boolean(
      attendanceEnabled &&
        profileComplete &&
        !sundayHoliday &&
        onShift &&
        opened?.pub?.can_check_in
    );
    const month = await monthHistory(user, shiftDate.slice(0, 7));
    const todayMeta = (month.days || []).find((d) => d.date === shiftDate) || {};
    const flexible = userFlexibleHours(user);
    return res.json({
      date: shiftDate,
      timezone: TIMEZONE,
      current_hour_key: opened?.pub?.hour_key || null,
      attendance_enabled: attendanceEnabled,
      profile_complete: profileComplete,
      profile_incomplete_message: profileComplete
        ? ''
        : PROFILE_INCOMPLETE_ATTENDANCE_MESSAGE,
      flexible_hours: flexible,
      work_days: workDaysFromUser(user),
      work_days_label: workDaysSummary(workDaysFromUser(user)),
      face_check_capture: userFaceCheckCapture(user),
      can_check_in: canCheckIn,
      open_check: opened?.pub || null,
      work_start_hour: hours.start,
      work_end_hour: hours.end,
      work_hours_label: flexible
        ? `Flexible · assigned ${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`
        : `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
      start_window_minutes: remoteChallenges.START_ON_TIME_MINUTES,
      late_after_minutes: remoteChallenges.LATE_AFTER_MINUTES,
      absent_after_minutes: remoteChallenges.ABSENT_AFTER_MINUTES,
      respond_target_minutes: remoteChallenges.RESPOND_TARGET_MINUTES,
      checks_per_shift: remoteChallenges.checkCountFromUser(user),
      duration_minutes: todayMeta.duration_minutes ?? null,
      duration_label: todayMeta.duration_label || '',
      checked_out_at: todayMeta.checked_out_at || null,
      first_check_in: todayMeta.first_check_in || null,
      last_checked_in_at: lastPunch.rows[0]?.checked_in_at || null,
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
    if (await rejectIfUserAttendanceStopped(res, user)) return;
    if (rejectIfRemoteProfileIncomplete(res, user)) return;
    if (rateLimited(req.user.id)) {
      return res.status(429).json({ message: 'Too many check-in attempts. Try again later.' });
    }

    const now = new Date();
    const shiftDate = remoteChallenges.activeShiftDate(now, user, { includeLead: false });
    if (!shiftDate) {
      return res.status(400).json({
        message: 'There is no open attendance check during your working hours.',
      });
    }
    const challengeRows = await remoteChallenges.ensureChallengesForUser(user, shiftDate);
    const opened = remoteChallenges.openChallenge(challengeRows, now, user);
    if (!opened) {
      return res.status(400).json({
        message: userFlexibleHours(user)
          ? 'No attendance check is open right now. Start with first check-in, wait for a random ping, or check out when you finish.'
          : 'No attendance check is open right now. Wait for your shift-start window or a random availability ping.',
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
      return res.status(500).json({ message: 'Stored face template is invalid. Ask an admin for help.' });
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

    const distance = embeddingDistance(stored, probe);
    const matched = isFaceMatch(distance);
    console.log('[face-match]', {
      userId: req.user.id,
      distance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : null,
      threshold: MATCH_THRESHOLD,
      matched,
      hourKey,
    });
    const suspicious = rememberScore(req.user.id, distance);
    const flexible = userFlexibleHours(user);
    const skipLate =
      challenge.kind === 'checkout' ||
      (flexible && (challenge.kind === 'start' || Number(challenge.seq) === 1));
    const late =
      matched && !skipLate && now.getTime() >= new Date(challenge.late_at).getTime();
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

    if (userFaceCheckCapture(user)) {
      try {
        const saved = await saveCheckInSnapshot(req.user.id, rows[0], req.body?.snapshot);
        if (!saved) {
          console.warn('face check capture skipped: no usable snapshot on check-in', {
            userId: req.user.id,
            logId: rows[0].id,
            hasSnapshot: Boolean(req.body?.snapshot),
          });
        }
      } catch (err) {
        console.error('face check capture:', err.message || err);
      }
    }

    if (matched) {
      await remoteChallenges.markChallengeResult(challenge, status, rows[0].id);
      if (flexible && (challenge.kind === 'start' || Number(challenge.seq) === 1)) {
        await remoteChallenges.scheduleFlexibleFollowUps(user, shiftDate, now);
      }
      if (challenge.kind === 'checkout') {
        await remoteChallenges.cancelPendingFollowUps(user.id, shiftDate);
      }
      await refreshAttendanceDay(user, hourKey.slice(0, 10), {
        firstCheckIn: challenge.kind === 'checkout' ? undefined : rows[0].checked_in_at,
        checkedOutAt: challenge.kind === 'checkout' ? rows[0].checked_in_at : undefined,
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

    let durationMinutes = null;
    if (matched && challenge.kind === 'checkout') {
      const first = (
        await pool.query(
          `
            SELECT first_check_in, duration_minutes, checked_out_at
            FROM attendance_days
            WHERE user_id = $1 AND date_key = $2
            LIMIT 1
          `,
          [user.id, shiftDate]
        )
      ).rows[0];
      durationMinutes = first?.duration_minutes ?? null;
    }
    void notifyAfterResponse('ceo-remote-face', user.id, () =>
      notifyCeoRemoteFaceAttendance(user, {
        kind: challenge.kind,
        seq: challenge.seq,
        status,
        hourKey,
        checkedInAt: rows[0].checked_in_at,
        durationLabel: formatDurationMinutes ? formatDurationMinutes(durationMinutes) : '',
      })
    );
    return res.status(201).json({
      matched,
      status,
      hour_key: hourKey,
      kind: challenge.kind,
      match_score: rows[0].match_score == null ? null : Number(rows[0].match_score),
      duration_minutes: durationMinutes,
      duration_label: formatDurationMinutes ? formatDurationMinutes(durationMinutes) : '',
      log: {
        id: rows[0].id,
        status: rows[0].status,
        method: rows[0].method,
        checked_in_at: rows[0].checked_in_at,
        match_score: rows[0].match_score == null ? null : Number(rows[0].match_score),
      },
    });
  } catch (err) {
    console.error('checkIn error:', err);
    return res.status(500).json({ message: 'Server error during check-in.' });
  }
}

async function resolveAttendanceScope(req, permissionKey) {
  if (isCeoRole(req.user?.role) || isManagerRole(req.user?.role)) return { type: 'all' };
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

function checkInRequestGate(now, lastRequestAt, completedCount, checkCount) {
  const needed = Number(checkCount) > 0 ? Number(checkCount) : remoteChallenges.CHECK_COUNT;
  if (Number(completedCount) >= needed) {
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
    const teamFilter = String(req.query.team || req.query.department || '').trim().toLowerCase();

    const viewScope = await resolveAttendanceScope(req, 'attendance:view');
    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    const filter = scopeWhereClause(viewScope, 1);

    const { rows: people } = await pool.query(
      `
        SELECT id, employee_id, name, username, branch, department, employment_type,
               profile_picture_url, shift, designation, is_active, status, work_start_hour, work_end_hour,
               remote_check_request_at, attendance_enabled, remote_check_count, flexible_hours, six_day_week, work_days,
               face_check_capture, staff_kind, reference_person,
               emergency_contact_name, emergency_contact_number,
               bank_name, account_title, iban, account_number,
               cnic_front_url, cnic_back_url, cv_url
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
      const logPatterns = [...challengeDates].map((d) => `${d}-%`);
      const { rows } = await pool.query(
        `
          SELECT DISTINCT ON (user_id, hour_key)
            id, user_id, hour_key AS hour_key, status, method, match_score, checked_in_at, note, marked_by
          FROM attendance_logs
          WHERE user_id = ANY($1::int[])
            AND hour_key LIKE ANY($2::text[])
          ORDER BY user_id, hour_key, created_at DESC
        `,
        [ids, logPatterns]
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
          `SELECT user_id, date_key, status, first_check_in, checked_out_at, duration_minutes FROM attendance_days WHERE date_key = ANY($1::text[]) AND user_id = ANY($2::int[])`,
          [[...challengeDates], ids]
        )
      : { rows: [] };
    const dayRowsByUser = new Map();
    for (const day of dayRows) {
      const uid = String(day.user_id);
      if (!dayRowsByUser.has(uid)) dayRowsByUser.set(uid, []);
      dayRowsByUser.get(uid).push(day);
    }

    const employees = people
      .map((person) => {
        const personDate =
          dateKey === parts.dateKey
            ? remoteChallenges.activeShiftDate(now, person) || dateKey
            : dateKey;
        const personLogs = (logsByUser.get(String(person.id)) || []).filter(
          (log) => String(log.hour_key || '').slice(0, 10) === personDate
        );
        const latest = personLogs[0] || null;
        const personDay = (dayRowsByUser.get(String(person.id)) || []).find(
          (day) => String(day.date_key).slice(0, 10) === personDate
        );
        const mapped = remoteChallenges
          .sortRemoteChecks(
            (challengesByUser.get(String(person.id)) || []).filter((row) => String(row.shift_date).slice(0, 10) === personDate)
          )
          .map((row, i) => {
          const pub = remoteChallenges.publicChallenge(row, { revealFuture: true, now, user: person });
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
            kind: row.kind || (seq === 1 ? 'start' : 'random'),
            hour_key: row.hour_key,
            label: row.kind === 'checkout' ? 'Check out' : seq === 1 ? 'Start' : `Check ${seq}`,
            state,
            method: log?.method || null,
            checked_in_at: log?.checked_in_at || null,
          };
        });
        const holiday = isAttendanceHoliday(person, personDate);
        const slotCount = remoteChallenges.checkCountFromUser(person);
        const slots = holiday
          ? []
          : mapped.length
          ? mapped
          : Array.from({ length: slotCount }, (_, i) => {
              const seq = i + 1;
              return {
                seq,
                hour_key: `${personDate}-c${seq}`,
                label: seq === 1 ? 'Start' : `Check ${seq}`,
                state: 'pending',
                method: null,
                kind: seq === 1 ? 'start' : 'random',
              };
            });
        const verifiedCount = slots.filter(
          (s) => s.state === 'verified' || s.state === 'late'
        ).length;
        const missedCount = slots.filter((s) => s.state === 'missed').length;
        const failedCount = slots.filter((s) => s.state === 'failed').length;
        const manualCount = personLogs.filter((l) => l.method === 'manual').length;

        let rowStatus = personDay?.status || 'pending';
        if (holiday && rowStatus !== 'leave') rowStatus = 'holiday';
        if (rowStatus === 'pending') {
          if (missedCount > 0 && verifiedCount === 0) rowStatus = 'missed';
          else if (failedCount > 0 && verifiedCount === 0) rowStatus = 'failed';
          else if (verifiedCount > 0) rowStatus = 'verified';
        }

        const activeDate = remoteChallenges.activeShiftDate(now, person);
        const activeRows = (challengesByUser.get(String(person.id)) || []).filter(
          (row) => String(row.shift_date).slice(0, 10) === String(activeDate || '')
        );
        const doneCount = activeRows.filter((row) => CHECK_DONE_STATES.has(row.status)).length;
        let requestGate = { allowed: false, reason: 'no_shift', available_at: null };
        if (holiday) {
          requestGate = { allowed: false, reason: 'holiday', available_at: null };
        } else if (activeDate) {
          requestGate = checkInRequestGate(
            now,
            person.remote_check_request_at,
            doneCount,
            remoteChallenges.checkCountFromUser(person)
          );
        }

        const hours = workHoursFromUser(person);
        const flexible = userFlexibleHours(person);
        const profileComplete = !isRemoteProfileIncomplete(person);
        const bounds = personDate ? remoteChallenges.shiftBounds(personDate, person) : null;
        const liveShift = remoteChallenges.activeShiftDate(now, person, { includeLead: false });
        const inShift = Boolean(
          liveShift && liveShift === personDate && remoteChallenges.isOnShift(now, person, liveShift)
        );
        const lastCheckedInAt = personLogs.reduce((best, log) => {
          const t = log.checked_in_at ? new Date(log.checked_in_at).getTime() : 0;
          if (!Number.isFinite(t) || t <= 0) return best;
          if (!best || t > new Date(best).getTime()) return log.checked_in_at;
          return best;
        }, null);
        const nextSlot = slots.find(
          (slot) => !['verified', 'late', 'missed', 'leave'].includes(slot.state)
        );
        const checksNeeded = remoteChallenges.checkCountFromUser(person);
        const checksDone = slots.filter(
          (slot) => slot.state === 'verified' || slot.state === 'late'
        ).length;
        const shiftComplete = slots.length > 0 && slots.every((slot) =>
          ['verified', 'late', 'missed', 'leave'].includes(slot.state)
        );
        let liveStatus = rowStatus;
        if (rowStatus === 'leave') liveStatus = 'leave';
        else if (holiday) liveStatus = 'holiday';
        else if (shiftComplete) liveStatus = 'complete';
        else if (inShift) liveStatus = 'in_shift';
        else if (rowStatus === 'missed' || rowStatus === 'absent' || rowStatus === 'failed') {
          liveStatus = 'absent';
        } else {
          liveStatus = 'off_shift';
        }
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
          work_hours_label: flexible
            ? `Flexible · ${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`
            : `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
          day_status: rowStatus,
          can_manual: employeeMatchesScope(person, editScope),
          can_toggle_attendance: employeeMatchesScope(person, editScope),
          can_delete: Boolean(isCeoRole(req.user?.role) || isManagerRole(req.user?.role)),
          can_delete_last: Boolean(
            (isCeoRole(req.user?.role) || isManagerRole(req.user?.role)) &&
              (personLogs.length > 0 ||
                slots.some(
                  (slot) =>
                    slot.checked_in_at || slot.state === 'verified' || slot.state === 'late'
                ))
          ),
          shift_date: personDate,
          row_status: rowStatus,
          verified_count: verifiedCount,
          missed_count: missedCount,
          manual_count: manualCount,
          slots,
          latest,
          attendance_enabled: userAttendanceEnabled(person),
          profile_complete: profileComplete,
          flexible_hours: flexible,
          work_days: workDaysFromUser(person),
          work_days_label: workDaysSummary(workDaysFromUser(person)),
          face_check_capture: isCeoRole(req.user?.role) ? userFaceCheckCapture(person) : undefined,
          checks_per_shift: remoteChallenges.checkCountFromUser(person),
          duration_minutes: personDay?.duration_minutes ?? null,
          duration_label: formatDurationMinutes
            ? formatDurationMinutes(personDay?.duration_minutes)
            : '',
          checked_out_at: personDay?.checked_out_at || null,
          first_check_in: personDay?.first_check_in || null,
          last_checked_in_at: lastCheckedInAt,
          in_shift: inShift,
          live_status: liveStatus,
          shift_starts_at: bounds?.start || null,
          shift_ends_at: bounds?.end || null,
          checks_done: checksDone,
          checks_needed: checksNeeded,
          next_check_label: nextSlot?.label || null,
          next_check_at: nextSlot?.scheduled_at || null,
          can_check_in_request: Boolean(
            userAttendanceEnabled(person) && requestGate.allowed
          ),
          check_in_request_reason: !userAttendanceEnabled(person)
            ? 'stopped'
            : requestGate.reason,
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
        if (
          teamFilter &&
          teamFilter !== 'all' &&
          String(row.department || '').trim().toLowerCase() !== teamFilter
        ) {
          return false;
        }
        if (statusFilter !== 'all' && row.row_status !== statusFilter) return false;
        if (!search) return true;
        const blob = `${row.name} ${row.username} ${row.employee_id} ${row.branch} ${row.department}`.toLowerCase();
        return blob.includes(search);
      })
      .sort((a, b) => {
        if (Boolean(a.in_shift) !== Boolean(b.in_shift)) return a.in_shift ? -1 : 1;
        const aOpen = Number(a.checks_needed || 0) - Number(a.checks_done || 0);
        const bOpen = Number(b.checks_needed || 0) - Number(b.checks_done || 0);
        if (aOpen !== bOpen) return bOpen - aOpen;
        return String(a.name || '').localeCompare(String(b.name || ''));
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
    const teams = [
      ...new Set(
        people
          .map((p) => String(p.department || '').trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    return res.json({
      date: dateKey,
      timezone: TIMEZONE,
      summary: { verified, missed, failed, manual, employees: employees.length },
      employees,
      branches,
      teams,
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
    if (status !== 'leave' && !/^\d{4}-\d{2}-\d{2}-(?:\d{2}|c\d+)$/.test(hourKey)) {
      return res.status(400).json({ message: 'hour_key must look like YYYY-MM-DD-c1.' });
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stampDay)) {
      return res.status(400).json({ message: 'Manual attendance needs a valid date.' });
    }
    if (!hasFullAttendanceDays(req.user?.role)) {
      if (stampDay > today || stampDay < yesterday) {
        return res.status(400).json({
          message: 'Manual attendance can only be saved for today or yesterday.',
        });
      }
    }

    const target = await loadUser(targetId);
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (target.employment_type !== 'remote') {
      return res.status(400).json({ message: 'Attendance is only tracked for remote employees.' });
    }

    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    if (!isCeoOrManagerRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
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
    await remoteChallenges.ensureChallengesForUser(target, hourKey.slice(0, 10), new Date());

    res.status(201).json({ message: 'Attendance updated.', log });
    queueCeoBranchManagerNotice(req, {
      action: 'Manually marked remote attendance',
      targetName: target.name || target.username,
      targetId: target.id,
      details: [`Status: ${status}`, `Check: ${hourKey}`],
    });
    return;
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
    if (await rejectIfUserAttendanceStopped(res, target)) return;
    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    if (!isCeoOrManagerRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }

    const now = new Date();
    const shiftDate = remoteChallenges.activeShiftDate(now, target, { includeLead: false });
    if (!shiftDate) {
      return res.status(400).json({
        message: 'This employee is not in their working hours right now.',
      });
    }

    await remoteChallenges.ensureChallengesForUser(target, shiftDate, now);
    const rows = await remoteChallenges.loadChallenges(targetId, shiftDate);
    const doneCount = rows.filter((row) => CHECK_DONE_STATES.has(row.status)).length;
    const checkCount = remoteChallenges.checkCountFromUser(target);
    const gate = checkInRequestGate(now, target.remote_check_request_at, doneCount, checkCount);
    if (!gate.allowed && gate.reason === 'complete') {
      return res.status(409).json({
        message: `All ${checkCount} checks for this shift are already recorded. The button opens again on the next shift day.`,
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
        message: `All ${checkCount} checks for this shift are already recorded. The button opens again on the next shift day.`,
      });
    }

    const sortedOpen = [...openable].sort((a, b) => Number(a.seq) - Number(b.seq));
    const chosen =
      sortedOpen.find((row) => row.kind !== 'checkout') || sortedOpen[0];

    const opened = await remoteChallenges.reopenForImmediateCheck(chosen, now);
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

    res.json({
      message: 'Check-in request sent. The employee will get the usual attendance notification.',
    });
    queueCeoBranchManagerNotice(req, {
      action: 'Sent remote check-in request',
      targetName: target.name || target.username,
      targetId: target.id,
    });
    return;
  } catch (err) {
    console.error('adminRequestCheckIn error:', err);
    return res.status(500).json({ message: 'Server error sending check-in request.' });
  }
}

async function markMissedSlots(now = new Date()) {
  return runRemoteAttendanceTick(now);
}

async function putUserAttendanceEnabled(req, res) {
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

    if (!isCeoOrManagerRole(req.user?.role)) {
      const empType = normalizeEmploymentType(target.employment_type);
      let editScope;
      if (empType === 'remote') {
        editScope = await resolveAttendanceScope(req, 'attendance:edit');
      } else {
        const access = await loadAdminPermissionAccess(req.user.id);
        const keys = access.permissions || [];
        if (keys.includes('hr:add_employee') || keys.includes('*')) {
          editScope = { type: 'all' };
        } else if (keys.includes('attendance:edit')) {
          editScope = normalizeScope(access.scopes?.['attendance:edit']);
        } else if (keys.includes('employees:edit')) {
          editScope = normalizeScope(access.scopes?.['employees:edit']);
        } else {
          editScope = { type: 'branch', values: [] };
        }
      }
      if (!employeeMatchesScope(target, editScope)) {
        return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
      }
    }

    const raw = req.body?.enabled;
    const enabled = raw !== false && raw !== 0 && raw !== '0' && raw !== 'false' && raw !== 'off';
    const updated = await setUserAttendanceEnabled(targetId, enabled);
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: enabled ? 'attendance.enabled' : 'attendance.disabled',
      targetTable: 'users',
      targetId: targetId,
      reason: enabled
        ? `Turned attendance on for ${target.name || target.username}`
        : `Turned attendance off for ${target.name || target.username}`,
    });
    return res.json({
      enabled: updated?.attendance_enabled !== false,
      message: enabled
        ? `Attendance is on for ${target.name || target.username}.`
        : `Attendance is off for ${target.name || target.username}. They cannot check in. Manual mark still works.`,
    });
  } catch (err) {
    console.error('putUserAttendanceEnabled error:', err);
    return res.status(500).json({ message: 'Server error saving attendance setting.' });
  }
}

async function putUserFaceCheckCapture(req, res) {
  try {
    await ensureAttendanceTables();
    if (!isCeoRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only the CEO can turn picture capture on or off.' });
    }
    const targetId = Number(req.params.userId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ message: 'Invalid employee.' });
    }
    const target = await loadUser(targetId);
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (normalizeEmploymentType(target.employment_type) !== 'remote') {
      return res.status(400).json({ message: 'Picture capture is only for remote employees.' });
    }
    const raw = req.body?.enabled;
    const enabled = raw !== false && raw !== 0 && raw !== '0' && raw !== 'false' && raw !== 'off';
    await setUserFaceCheckCapture(targetId, enabled);
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: enabled ? 'attendance.face_capture_on' : 'attendance.face_capture_off',
      targetTable: 'users',
      targetId: targetId,
      reason: enabled
        ? `Turned face check photos on for ${target.name || target.username}`
        : `Turned face check photos off for ${target.name || target.username}`,
    });
    return res.json({
      enabled,
      message: enabled
        ? `Picture capture is on for ${target.name || target.username}. Check-in photos will be saved for review.`
        : `Picture capture is off for ${target.name || target.username}.`,
    });
  } catch (err) {
    console.error('putUserFaceCheckCapture error:', err);
    return res.status(500).json({ message: 'Server error saving picture capture setting.' });
  }
}

async function listFaceCheckCaptures(req, res) {
  try {
    await ensureAttendanceTables();
    if (!isCeoRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only the CEO can review face check photos.' });
    }
    const userId = Number(req.query.user_id);
    const dateKey = String(req.query.date || '').slice(0, 10);
    const search = String(req.query.search || '').trim().toLowerCase();
    const params = [];
    const where = [];
    if (Number.isFinite(userId) && userId > 0) {
      params.push(userId);
      where.push(`c.user_id = $${params.length}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      params.push(dateKey);
      where.push(`to_char(c.captured_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD') = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(LOWER(COALESCE(u.name, '')) LIKE $${params.length} OR LOWER(COALESCE(u.employee_id, '')) LIKE $${params.length} OR LOWER(COALESCE(u.username, '')) LIKE $${params.length})`
      );
    }
    const { rows } = await pool.query(
      `
        SELECT c.id, c.user_id, c.hour_key, c.status, c.match_score, c.captured_at,
               u.name, u.employee_id, u.username, u.branch, u.department, u.profile_picture_url
        FROM face_check_captures c
        JOIN users u ON u.id = c.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.captured_at DESC
        LIMIT 120
      `,
      params
    );
    return res.json({
      captures: rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        employee_id: row.employee_id,
        username: row.username,
        branch: row.branch,
        department: row.department,
        hour_key: row.hour_key,
        status: row.status,
        match_score: row.match_score == null ? null : Number(row.match_score),
        captured_at: row.captured_at,
        image_url: `/api/documents/face-checks/${row.id}`,
        profile_picture_url:
          row.profile_picture_url && !/^https?:\/\//i.test(String(row.profile_picture_url))
            ? `/api/documents/${row.user_id}/profile`
            : row.profile_picture_url,
      })),
    });
  } catch (err) {
    console.error('listFaceCheckCaptures error:', err);
    return res.status(500).json({ message: 'Server error loading face check photos.' });
  }
}

async function streamFaceCheckCapture(req, res) {
  try {
    await ensureAttendanceTables();
    const { rows: me } = await pool.query(`SELECT role FROM users WHERE id = $1 LIMIT 1`, [req.user.id]);
    if (!isCeoRole(me[0]?.role)) {
      return res.status(403).json({ message: 'Only the CEO can view face check photos.' });
    }
    const captureId = Number(req.params.captureId);
    if (!Number.isFinite(captureId) || captureId <= 0) {
      return res.status(400).json({ message: 'Invalid photo.' });
    }
    const { rows } = await pool.query(
      `SELECT image_path, image_bytes FROM face_check_captures WHERE id = $1 LIMIT 1`,
      [captureId]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: 'Photo not found.' });
    }
    const sent = await streamCaptureImage(rows[0], res);
    if (!sent) return res.status(404).json({ message: 'Photo file is missing.' });
    return undefined;
  } catch (err) {
    console.error('streamFaceCheckCapture error:', err);
    return res.status(500).json({ message: 'Server error reading face check photo.' });
  }
}

async function putUserFlexibleHours(req, res) {
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
      return res.status(400).json({ message: 'Flexible hours are only for remote employees.' });
    }

    if (!isCeoOrManagerRole(req.user?.role)) {
      const editScope = await resolveAttendanceScope(req, 'attendance:edit');
      if (!employeeMatchesScope(target, editScope)) {
        return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
      }
    }

    const raw = req.body?.enabled;
    const enabled = raw !== false && raw !== 0 && raw !== '0' && raw !== 'false' && raw !== 'off';
    await setUserFlexibleHours(targetId, enabled);
    const updated = await loadUser(targetId);
    const now = new Date();
    const shiftDate =
      remoteChallenges.activeShiftDate(now, updated) ||
      remoteChallenges.currentShiftDateKey(now, updated);
    if (shiftDate && userAttendanceEnabled(updated)) {
      await remoteChallenges.dropOpenChallenges(targetId, shiftDate);
      await remoteChallenges.ensureChallengesForUser(updated, shiftDate);
    }
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: enabled ? 'attendance.flexible_on' : 'attendance.flexible_off',
      targetTable: 'users',
      targetId: targetId,
      reason: enabled
        ? `Turned flexible hours on for ${target.name || target.username}`
        : `Turned flexible hours off for ${target.name || target.username}`,
    });
    return res.json({
      enabled: userFlexibleHours(updated),
      checks_per_shift: remoteChallenges.checkCountFromUser(updated),
      message: enabled
        ? `Flexible hours are on for ${target.name || target.username}. They get 3 checks: first check-in, one random, then check-out.`
        : `Flexible hours are off for ${target.name || target.username}. Fixed shift times apply again.`,
    });
  } catch (err) {
    console.error('putUserFlexibleHours error:', err);
    return res.status(500).json({ message: 'Server error saving flexible hours.' });
  }
}

async function putUserWorkDays(req, res) {
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
      return res.status(400).json({ message: 'Work days are only for remote employees.' });
    }

    if (!isCeoOrManagerRole(req.user?.role)) {
      const editScope = await resolveAttendanceScope(req, 'attendance:edit');
      if (!employeeMatchesScope(target, editScope)) {
        return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
      }
    }

    const saved = await setUserWorkDays(targetId, req.body?.days || req.body?.work_days || {});
    const days = workDaysFromUser({ work_days: saved?.work_days });
    const updated = await loadUser(targetId);
    const now = new Date();
    const shiftDate =
      remoteChallenges.activeShiftDate(now, updated) ||
      remoteChallenges.currentShiftDateKey(now, updated);
    if (shiftDate && userAttendanceEnabled(updated)) {
      if (isAttendanceHoliday(updated, shiftDate)) {
        await remoteChallenges.dropOpenChallenges(targetId, shiftDate);
      } else {
        await remoteChallenges.dropOpenChallenges(targetId, shiftDate);
        await remoteChallenges.ensureChallengesForUser(updated, shiftDate);
      }
    }
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance.work_days',
      targetTable: 'users',
      targetId: targetId,
      reason: `Set work days for ${target.name || target.username}: ${workDaysSummary(days)}`,
    });
    return res.json({
      days,
      work_days_label: workDaysSummary(days),
      message: `Work days saved for ${target.name || target.username}: ${workDaysSummary(days)}.`,
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.error('putUserWorkDays error:', err);
    return res.status(500).json({ message: 'Server error saving work days.' });
  }
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
    if (!isCeoOrManagerRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }
    await persistUserWorkHours(targetId, hours.start, hours.end);
    const checkCount = persistRemoteCheckCount
      ? await persistRemoteCheckCount(
          targetId,
          req.body?.remote_check_count ?? req.body?.checks_per_shift ?? target.remote_check_count
        )
      : remoteChallenges.checkCountFromUser({
          remote_check_count:
            req.body?.remote_check_count ?? req.body?.checks_per_shift ?? target.remote_check_count,
        });
    const updated = await loadUser(targetId);
    const shiftDate =
      remoteChallenges.activeShiftDate(new Date(), updated) ||
      remoteChallenges.currentShiftDateKey(new Date(), updated);
    if (shiftDate && userAttendanceEnabled(updated)) {
      await remoteChallenges.dropOpenChallenges(targetId, shiftDate);
      await remoteChallenges.ensureChallengesForUser(updated, shiftDate);
    }
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance_hours',
      targetTable: 'users',
      targetId: targetId,
      reason: `Set working hours ${hours.start}:00–${hours.end}:00 and ${checkCount} checks per shift`,
    });
    res.json({
      message: 'Working hours updated.',
      work_start_hour: hours.start,
      work_end_hour: hours.end,
      work_hours_label: `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
      checks_per_shift: checkCount,
      remote_check_count: checkCount,
    });
    queueCeoBranchManagerNotice(req, {
      action: 'Updated remote working hours',
      targetName: target.name || target.username,
      targetId: target.id,
      details: [
        `Hours: ${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
        `Checks per shift: ${checkCount}`,
      ],
    });
    return;
  } catch (err) {
    console.error('adminSetHours error:', err);
    return res.status(500).json({ message: 'Server error saving working hours.' });
  }
}

async function adminUpdateCheckTime(req, res) {
  try {
    await ensureAttendanceTables();
    const targetId = Number(req.params.userId);
    const challengeId = Number(req.params.challengeId);
    const hourKey = String(req.body?.hour_key || '').trim();
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ message: 'Invalid employee or check id.' });
    }
    const scheduledAt = new Date(req.body?.scheduled_at);
    if (!Number.isFinite(scheduledAt.getTime())) {
      return res.status(400).json({ message: 'Enter a valid check time.' });
    }

    const target = await loadUser(targetId);
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (normalizeEmploymentType(target.employment_type) !== 'remote') {
      return res.status(400).json({ message: 'Check times are only for remote employees.' });
    }
    const editScope = await resolveAttendanceScope(req, 'attendance:edit');
    if (!isCeoOrManagerRole(req.user?.role) && !employeeMatchesScope(target, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }

    let resolvedId = Number.isFinite(challengeId) && challengeId > 0 ? challengeId : 0;
    if (!resolvedId && hourKey) {
      const { rows } = await pool.query(
        `SELECT id FROM attendance_challenges WHERE user_id = $1 AND hour_key = $2 LIMIT 1`,
        [targetId, hourKey]
      );
      resolvedId = Number(rows[0]?.id) || 0;
    }
    if (!resolvedId) {
      return res.status(404).json({ message: 'That attendance check was not found.' });
    }

    const { rows: challengeMeta } = await pool.query(
      `SELECT shift_date FROM attendance_challenges WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [resolvedId, targetId]
    );
    const rawShift = challengeMeta[0]?.shift_date;
    const shiftDate =
      rawShift instanceof Date
        ? rawShift.toISOString().slice(0, 10)
        : String(rawShift || '').slice(0, 10);
    const todayKey = zonedParts().dateKey;
    const yesterdayKey = addDaysKey(todayKey, -1);
    const tomorrowKey = addDaysKey(todayKey, 1);
    if (
      !hasFullAttendanceDays(req.user?.role) &&
      shiftDate !== yesterdayKey &&
      shiftDate !== todayKey &&
      shiftDate !== tomorrowKey
    ) {
      return res.status(400).json({
        message: 'Check times can only be edited for yesterday, today, or tomorrow.',
      });
    }

    const updated = await remoteChallenges.updateChallengeSchedule(targetId, resolvedId, scheduledAt);
    if (!updated) {
      return res.status(404).json({ message: 'That attendance check was not found.' });
    }

    const checkInRaw = req.body?.checked_in_at;
    if (checkInRaw !== undefined && checkInRaw !== null && String(checkInRaw).trim() !== '') {
      const checkedInAt = new Date(checkInRaw);
      if (!Number.isFinite(checkedInAt.getTime())) {
        return res.status(400).json({ message: 'Enter a valid check-in time.' });
      }
      if (updated.attendance_log_id) {
        await pool.query(
          `UPDATE attendance_logs SET checked_in_at = $1 WHERE id = $2 AND user_id = $3`,
          [checkedInAt, updated.attendance_log_id, targetId]
        );
      } else {
        await pool.query(
          `
            UPDATE attendance_logs
            SET checked_in_at = $1
            WHERE id = (
              SELECT id FROM attendance_logs
              WHERE user_id = $2 AND hour_key = $3
              ORDER BY created_at DESC
              LIMIT 1
            )
          `,
          [checkedInAt, targetId, updated.hour_key]
        );
      }
    }

    await refreshAttendanceDay(target, updated.shift_date, { markedBy: req.user.id });
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance_check_time',
      targetTable: 'attendance_challenges',
      targetId: resolvedId,
      reason: `Set ${updated.hour_key} scheduled time to ${scheduledAt.toISOString()}`,
    });
    res.json({
      message: 'Check time updated.',
      challenge: updated,
    });
    queueCeoBranchManagerNotice(req, {
      action: 'Edited remote check time',
      targetName: target.name || target.username,
      targetId: target.id,
      details: [`Check: ${updated.hour_key}`],
    });
    return;
  } catch (err) {
    console.error('adminUpdateCheckTime error:', err);
    return res.status(500).json({ message: 'Server error saving check time.' });
  }
}

async function attachDayFaceChecks(userId, monthKey, days) {
  const byDate = await listCapturesForUserMonth(userId, monthKey);
  return (days || []).map((day) => ({
    ...day,
    face_checks: byDate.get(day.date) || [],
  }));
}

async function adminEmployeeDays(req, res) {
  try {
    await ensureAttendanceTables();
    const targetId = Number(req.params.userId);
    const target = await loadUser(targetId);
    if (!target) return res.status(404).json({ message: 'Employee not found.' });
    const viewScope = await resolveAttendanceScope(req, 'attendance:view');
    if (!isCeoOrManagerRole(req.user?.role) && !employeeMatchesScope(target, viewScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance view scope.' });
    }
    const parts = zonedParts();
    const month = String(req.query.month || parts.dateKey.slice(0, 7)).slice(0, 7);
    const fullDays = hasFullAttendanceDays(req.user?.role);
    const history = await monthHistory(target, month, new Date(), {
      throughDate: fullDays ? null : undefined,
    });
    const ceoView = isCeoRole(req.user?.role);
    const days = ceoView
      ? await attachDayFaceChecks(target.id, month, history.days || [])
      : history.days || [];
    res.json({
      employee: {
        id: target.id,
        name: target.name,
        employee_id: target.employee_id,
        work_start_hour: workHoursFromUser(target).start,
        work_end_hour: workHoursFromUser(target).end,
        ...(ceoView ? { face_check_capture: userFaceCheckCapture(target) } : {}),
      },
      ...history,
      days,
    });
    if (
      (isCeoRole(req.user?.role) || isManagerRole(req.user?.role)) &&
      normalizeEmploymentType(target.employment_type) === 'remote'
    ) {
      void notifyAfterResponse('attendance-review-email', target.id, () =>
        notifyRemoteAttendanceOpened(target)
      );
    }
    return;
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

async function remoteLogsForShiftDate(userId, dateKey) {
  const { rows } = await pool.query(
    `
      SELECT l.id, l.hour_key, l.status, l.method, l.checked_in_at
      FROM attendance_logs l
      WHERE l.user_id = $1
        AND (
          l.hour_key LIKE $2
          OR l.hour_key IN (
            SELECT c.hour_key FROM attendance_challenges c
            WHERE c.user_id = $1 AND c.shift_date = $3
          )
          OR l.id IN (
            SELECT c.attendance_log_id FROM attendance_challenges c
            WHERE c.user_id = $1
              AND c.shift_date = $3
              AND c.attendance_log_id IS NOT NULL
          )
        )
      ORDER BY l.checked_in_at DESC NULLS LAST, l.id DESC
    `,
    [userId, `${dateKey}-%`, dateKey]
  );
  return rows;
}

async function reopenRemoteChallenges(userId, dateKey, hourKey = null) {
  await pool.query(
    `
      UPDATE attendance_challenges
      SET status = 'pending',
          attendance_log_id = NULL,
          notified_at = NULL
      WHERE user_id = $1
        AND shift_date = $2
        AND ($3::text IS NULL OR hour_key = $3)
    `,
    [userId, dateKey, hourKey]
  );
}

/**
 * DELETE /api/admin/attendance/:userId/days/:dateKey/last
 * Removes the most recent punch on that shift date and reopens that check.
 */
async function adminDeleteRemoteLast(req, res) {
  try {
    if (!hasFullAttendanceDays(req.user?.role)) {
      return res.status(403).json({ message: 'Only the CEO or a manager can delete attendance.' });
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

    const logs = await remoteLogsForShiftDate(userId, dateKey);
    const last = logs[0];
    if (!last) {
      const { rows: openable } = await pool.query(
        `
          SELECT hour_key
          FROM attendance_challenges
          WHERE user_id = $1
            AND shift_date = $2
            AND status IN ('verified', 'late', 'missed')
          ORDER BY seq DESC
          LIMIT 1
        `,
        [userId, dateKey]
      );
      if (openable[0]?.hour_key) {
        await reopenRemoteChallenges(userId, dateKey, openable[0].hour_key);
        await remoteChallenges.reopenCheckDuringShift(user, dateKey, openable[0].hour_key, new Date());
        await refreshAttendanceDay(user, dateKey);
        return res.json({
          message: `Reopened the last check (${openable[0].hour_key}).`,
          hour_key: openable[0].hour_key,
        });
      }
      return res.status(404).json({ message: 'No attendance punch found for that date.' });
    }

    await pool.query(`DELETE FROM attendance_logs WHERE id = $1`, [last.id]);
    await reopenRemoteChallenges(userId, dateKey, last.hour_key);
    await remoteChallenges.reopenCheckDuringShift(user, dateKey, last.hour_key, new Date());
    await pool.query(`UPDATE users SET remote_check_request_at = NULL WHERE id = $1`, [userId]);
    await refreshAttendanceDay(user, dateKey);

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance.delete_last',
      targetTable: 'attendance_logs',
      targetId: last.id,
      reason: `Deleted last remote punch for ${user.name || user.username} (${user.employee_id || user.id}) on ${dateKey} (${last.hour_key})`,
    });

    res.json({
      message: `Deleted the last attendance punch (${last.hour_key}).`,
      hour_key: last.hour_key,
    });
    queueCeoBranchManagerNotice(req, {
      action: 'Deleted last remote attendance punch',
      targetName: user.name || user.username,
      targetId: user.id,
      details: [`Date: ${dateKey}`, `Check: ${last.hour_key}`],
    });
    return;
  } catch (err) {
    console.error('adminDeleteRemoteLast error:', err);
    return res.status(500).json({ message: 'Server error deleting last attendance.' });
  }
}

/**
 * DELETE /api/admin/attendance/:userId/days/:dateKey
 * Removes remote face/manual logs for that shift date and reopens every check.
 */
async function adminDeleteRemoteDay(req, res) {
  try {
    if (!hasFullAttendanceDays(req.user?.role)) {
      return res.status(403).json({ message: 'Only the CEO or a manager can delete attendance.' });
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

    const logs = await remoteLogsForShiftDate(userId, dateKey);
    const logIds = logs.map((row) => row.id);
    let logCount = 0;
    if (logIds.length) {
      const deleted = await pool.query(`DELETE FROM attendance_logs WHERE id = ANY($1::bigint[])`, [
        logIds,
      ]);
      logCount = deleted.rowCount || 0;
    }
    const reset = await pool.query(
      `
        UPDATE attendance_challenges
        SET status = 'pending',
            attendance_log_id = NULL,
            notified_at = NULL
        WHERE user_id = $1
          AND shift_date = $2
      `,
      [userId, dateKey]
    );
    const { rowCount: dayCount } = await pool.query(
      `DELETE FROM attendance_days WHERE user_id = $1 AND date_key = $2`,
      [userId, dateKey]
    );
    if (!logCount && !dayCount && !(reset.rowCount || 0)) {
      return res.status(404).json({ message: 'No attendance found for that date.' });
    }

    await pool.query(`UPDATE users SET remote_check_request_at = NULL WHERE id = $1`, [userId]);
    await remoteChallenges.reopenCheckDuringShift(user, dateKey, null, new Date());
    await refreshAttendanceDay(user, dateKey);

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'attendance.delete_day',
      targetTable: 'attendance_logs',
      targetId: userId,
      reason: `Deleted remote attendance for ${user.name || user.username} (${user.employee_id || user.id}) on ${dateKey} (${logCount} log(s), ${reset.rowCount || 0} check(s) reopened, ${dayCount} day row(s))`,
    });

    res.json({
      message: `Deleted attendance for ${dateKey}. Checks are open again.`,
      logs_deleted: logCount,
      day_deleted: dayCount,
    });
    queueCeoBranchManagerNotice(req, {
      action: 'Deleted remote attendance day',
      targetName: user.name || user.username,
      targetId: user.id,
      details: [`Date: ${dateKey}`],
    });
    return;
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
  adminUpdateCheckTime,
  adminEmployeeDays,
  adminDeleteRemoteLast,
  adminDeleteRemoteDay,
  markMissedSlots,
  putUserAttendanceEnabled,
  putUserFaceCheckCapture,
  listFaceCheckCaptures,
  streamFaceCheckCapture,
  putUserFlexibleHours,
  putUserWorkDays,
};
