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
const normalizeWorkHours = pick(workHours, 'normalizeworkhours');
const hoursBetween = pick(workHours, 'hoursbetween');
const formatHourLabel = pick(workHours, 'formathourlabel');
const workHoursFromUser = pick(attendanceDays, 'workhoursfromuser');
const slotsForUser = pick(attendanceDays, 'slotsforuser');
const isWithinWorkHours = pick(attendanceDays, 'iswithinworkhours');
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
             work_start_hour, work_end_hour
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
      grace_minutes: GRACE_MINUTES,
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
    if (user.employment_type !== 'remote') {
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
    const parts = zonedParts();
    const dateKey = String(req.query.date || parts.dateKey).slice(0, 10);
    const hours = workHoursFromUser(user);
    const { rows } = await pool.query(
      `
        SELECT id, hour_key AS hour_key, status, method, match_score, checked_in_at, note, created_at
        FROM attendance_logs
        WHERE user_id = $1
          AND hour_key LIKE $2
        ORDER BY hour_key ASC, created_at ASC
      `,
      [req.user.id, `${dateKey}-%`]
    );

    const slotMap = new Map(slotsForUser(dateKey, user).map((s) => [slotHourKey(s), s]));
    for (const row of rows) {
      const key = row.hour_key;
      if (!slotMap.has(key)) {
        const hour = Number(String(key).slice(-2));
        if (Number.isFinite(hour)) {
          slotMap.set(key, {
            hour,
            hour_key: key,
            label: `${String(hour).padStart(2, '0')}:00`,
          });
        }
      }
    }
    const slots = [...slotMap.values()].sort((a, b) => a.hour - b.hour);

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

    const current = currentHourKey();
    const currentLog = byHour[current];
    const slotLocked =
      currentLog &&
      (currentLog.status === 'verified' ||
        currentLog.status === 'late' ||
        currentLog.status === 'missed' ||
        currentLog.status === 'leave' ||
        currentLog.method === 'manual');
    const timeline = slots.map((slot) => {
      const key = slotHourKey(slot);
      const log = byHour[key];
      let state = 'pending';
      if (log?.status === 'verified') state = 'verified';
      else if (log?.status === 'late') state = 'late';
      else if (log?.status === 'missed') state = 'missed';
      else if (log?.status === 'failed') state = 'failed';
      else if (key < current) state = 'missed';
      return {
        ...slot,
        hour_key: key,
        state,
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
    });

    const canCheckIn =
      canCheckInHourKey(current) && !slotLocked && isWithinWorkHours(user, parts.hour);
    const month = await monthHistory(user, dateKey.slice(0, 7));
    return res.json({
      date: dateKey,
      timezone: TIMEZONE,
      current_hour_key: current,
      can_check_in: canCheckIn,
      work_start_hour: hours.start,
      work_end_hour: hours.end,
      work_hours_label: `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
      shift_hours: slotsForUser(dateKey, user).map((s) => s.label),
      timeline,
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
    if (user.employment_type !== 'remote') {
      return res.status(403).json({ message: 'Hourly face check-in is only for remote employees.' });
    }
    if (rateLimited(req.user.id)) {
      return res.status(429).json({ message: 'Too many check-in attempts. Try again later.' });
    }

    const hourKey = currentHourKey();
    const parts = zonedParts();
    if (!isWithinWorkHours(user, parts.hour) || !canCheckInHourKey(hourKey)) {
      const hours = workHoursFromUser(user);
      return res.status(400).json({
        message: `Check-in is only allowed during your working hours (${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}).`,
        hour_key: hourKey,
        work_start_hour: hours.start,
        work_end_hour: hours.end,
      });
    }

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
        message: 'This hour is already recorded.',
        hour_key: hourKey,
        status: already[0].status,
      });
    }

    const distance = euclideanDistance(stored, probe);
    const matched = isFaceMatch(distance);
    const suspicious = rememberScore(req.user.id, distance);
    const late = matched && isLateCheckIn(user, parts.hour, parts.minute);
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
  if (permissionKey === 'attendance:edit') {
    if (!keys.includes('attendance:edit')) return { type: 'branch', values: [] };
    return normalizeScope(scopes['attendance:edit']);
  }
  const picked = scopes['attendance:view'] || scopes['attendance:edit'];
  return normalizeScope(picked);
}

async function adminOverview(req, res) {
  try {
    await ensureAttendanceTables();
    const parts = zonedParts();
    const dateKey = String(req.query.date || parts.dateKey).slice(0, 10);
    const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const viewScope = await resolveAttendanceScope(req, 'attendance:view');
    const editScope = isCeoRole(req.user?.role)
      ? { type: 'all' }
      : await resolveAttendanceScope(req, 'attendance:edit');
    const filter = scopeWhereClause(viewScope, 1);

    const { rows: people } = await pool.query(
      `
        SELECT id, employee_id, name, username, branch, department, employment_type,
               profile_picture_url, shift, is_active, status, work_start_hour, work_end_hour
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
    let logs = [];
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
    }

    const logsByUser = new Map();
    for (const log of logs) {
      if (!logsByUser.has(log.user_id)) logsByUser.set(log.user_id, []);
      logsByUser.get(log.user_id).push(log);
    }

    const current = currentHourKey();
    const { rows: dayRows } = ids.length
      ? await pool.query(
          `SELECT user_id, status FROM attendance_days WHERE date_key = $1 AND user_id = ANY($2::int[])`,
          [dateKey, ids]
        )
      : { rows: [] };
    const dayByUser = new Map(dayRows.map((d) => [d.user_id, d.status]));
    let verified = 0;
    let missed = 0;
    let manual = 0;
    let failed = 0;

    const employees = people
      .map((person) => {
        const personLogs = logsByUser.get(person.id) || [];
        const latest = personLogs[0] || null;
        const slots = slotsForUser(dateKey, person);
        const slotStates = slots.map((slot) => {
          const key = slotHourKey(slot);
          const log = personLogs.find((l) => l.hour_key === key);
          let state = 'pending';
          if (log?.status === 'verified') state = 'verified';
          else if (log?.status === 'late') state = 'late';
          else if (log?.status === 'missed') state = 'missed';
          else if (log?.status === 'failed') state = 'failed';
          else if (log?.status === 'leave') state = 'leave';
          else if (key < current) state = 'missed';
          return { ...slot, hour_key: key, state, method: log?.method || null };
        });
        const verifiedCount = slotStates.filter(
          (s) => s.state === 'verified' || s.state === 'late'
        ).length;
        const missedCount = slotStates.filter((s) => s.state === 'missed').length;
        const failedCount = slotStates.filter((s) => s.state === 'failed').length;
        const manualCount = personLogs.filter((l) => l.method === 'manual').length;
        verified += verifiedCount;
        missed += missedCount;
        failed += failedCount;
        manual += manualCount;

        let rowStatus = dayByUser.get(person.id) || 'pending';
        if (rowStatus === 'pending') {
          if (missedCount > 0 && verifiedCount === 0) rowStatus = 'missed';
          else if (failedCount > 0 && verifiedCount === 0) rowStatus = 'failed';
          else if (verifiedCount > 0) rowStatus = 'verified';
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
          profile_picture_url: person.profile_picture_url,
          work_start_hour: hours.start,
          work_end_hour: hours.end,
          work_hours_label: `${formatHourLabel(hours.start)}–${formatHourLabel(hours.end)}`,
          day_status: rowStatus,
          can_manual: employeeMatchesScope(person, editScope),
          row_status: rowStatus,
          verified_count: verifiedCount,
          missed_count: missedCount,
          slots: slotStates,
          latest,
        };
      })
      .filter((row) => {
        if (statusFilter !== 'all' && row.row_status !== statusFilter) return false;
        if (!search) return true;
        const blob = `${row.name} ${row.username} ${row.employee_id} ${row.branch} ${row.department}`.toLowerCase();
        return blob.includes(search);
      });

    return res.json({
      date: dateKey,
      timezone: TIMEZONE,
      summary: { verified, missed, failed, manual, employees: employees.length },
      employees,
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
    if (status !== 'leave' && !/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(hourKey)) {
      return res.status(400).json({ message: 'hour_key must look like YYYY-MM-DD-HH.' });
    }
    if (status === 'leave' && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ message: 'date_key must look like YYYY-MM-DD.' });
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

    return res.status(201).json({ message: 'Attendance updated.', log });
  } catch (err) {
    console.error('adminManualMark error:', err);
    return res.status(500).json({ message: 'Server error saving manual attendance.' });
  }
}

async function markMissedSlots(now = new Date()) {
  await ensureAttendanceTables();
  const parts = zonedParts(now);
  const grace = Number.isFinite(GRACE_MINUTES) ? GRACE_MINUTES : 10;

  const { rows: remotes } = await pool.query(
    `
      SELECT id, work_start_hour, work_end_hour
      FROM users
      WHERE is_active = true
        AND status = 'active'
        AND employment_type = 'remote'
    `
  );

  let inserted = 0;
  for (const user of remotes) {
    const hours = hoursBetween(user.work_start_hour, user.work_end_hour);
    const due = [];
    for (const hour of hours) {
      const nextHour = hour + 1;
      const pastGrace =
        parts.hour > nextHour || (parts.hour === nextHour && parts.minute >= grace);
      if (pastGrace) due.push(`${parts.dateKey}-${String(hour).padStart(2, '0')}`);
    }
    for (const hourKey of due) {
      const result = await pool.query(
        `
          INSERT INTO attendance_logs (
            user_id, checked_in_at, hour_key, match_score, method, status, note
          )
          SELECT $1, NOW(), $2, NULL, 'face', 'missed', 'Auto-marked after grace period'
          WHERE NOT EXISTS (
            SELECT 1 FROM attendance_logs
            WHERE user_id = $1 AND hour_key = $2
              AND (status IN ('verified', 'missed', 'late', 'leave') OR method = 'manual')
          )
        `,
        [user.id, hourKey]
      );
      inserted += result.rowCount || 0;
    }
    await refreshAttendanceDay(user, parts.dateKey);
  }
  return { inserted, remotes: remotes.length };
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

module.exports = {
  getEnrollment,
  saveEnrollment,
  getMyAttendance,
  getMyHistory,
  checkIn,
  adminOverview,
  adminManualMark,
  adminSetHours,
  adminEmployeeDays,
  markMissedSlots,
};
