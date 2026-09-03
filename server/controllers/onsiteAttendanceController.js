const pool = require('../config/db');
const { ensureOnsiteAttendanceSchema } = require('../utils/onsiteAttendanceSchema');
const { statusForCheckIn, parseCheckInAt, pgDateKey, addDaysToDateKey, isNightShift, employeeCanSelfCheckIn } = require('../utils/onsiteShiftStatus');
const { requestMatchesConfiguredIp, parseOfficeIps } = require('../utils/requestMeta');
const { haversineDistanceMeters } = require('../utils/geo');
const { writeAuditLog } = require('../utils/auditLog');
const { zonedParts } = require('../utils/attendanceWindows');
const {
  normalizeScope,
  employeeMatchesScope,
  scopeWhereClause,
} = require('../utils/employeeScope');
const { loadAdminPermissionAccess, isCeoRole } = require('../middleware/permissions');
const { getShiftByName } = require('./shiftsController');
const { withProfileApiUrl } = require('../utils/storageUrls');

const ONSITE_SELECT = `
  id, user_id, work_date, checked_in_at, status, method,
  branch_name, shift_name, marked_by, note, status_overridden, previous_status,
  created_at, updated_at
`;

function assertManualWorkDate(dateKey, { allowPast = false } = {}) {
  const today = zonedParts().dateKey;
  const yesterday = addDaysToDateKey(today, -1);
  const key = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key > today) {
    const err = new Error(
      allowPast
        ? 'Manual attendance cannot be saved for a future date.'
        : 'Manual attendance can only be saved for today or yesterday.'
    );
    err.statusCode = 400;
    throw err;
  }
  if (!allowPast && key < yesterday) {
    const err = new Error('Manual attendance can only be saved for today or yesterday.');
    err.statusCode = 400;
    throw err;
  }
  return key;
}

function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    work_date: pgDateKey(row.work_date),
    checked_in_at: row.checked_in_at,
    status: row.status,
    method: row.method,
    branch_name: row.branch_name,
    shift_name: row.shift_name,
    marked_by: row.marked_by,
    note: row.note,
    status_overridden: row.status_overridden,
    previous_status: row.previous_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function liveStatus(row, shift) {
  if (!row || row.status_overridden || !shift) return row;
  try {
    const calc = statusForCheckIn(new Date(row.checked_in_at), shift);
    return { ...row, status: calc.status };
  } catch {
    return row;
  }
}

async function persistLiveStatus(row, shift) {
  try {
    const next = liveStatus(row, shift);
    if (next && row && next.status !== row.status && row.id) {
      await pool.query(
        `
          UPDATE onsite_attendance
          SET status = $2, updated_at = NOW()
          WHERE id = $1 AND COALESCE(status_overridden, false) = false
        `,
        [row.id, next.status]
      );
    }
    return next;
  } catch (err) {
    console.error('persistLiveStatus error:', err);
    return liveStatus(row, shift);
  }
}

async function resolveOnsiteEditScope(req) {
  if (isCeoRole(req.user?.role)) return { type: 'all' };
  const access = await loadAdminPermissionAccess(req.user.id);
  if ((access.permissions || []).includes('hr:add_employee')) return { type: 'all' };
  if ((access.permissions || []).includes('attendance:edit')) {
    return normalizeScope(access.scopes['attendance:edit']);
  }
  if ((access.permissions || []).includes('employees:edit')) {
    return normalizeScope(access.scopes['employees:edit']);
  }
  return { type: 'branch', values: [] };
}

async function resolveOnsiteViewScope(req) {
  if (isCeoRole(req.user?.role)) return { type: 'all' };
  const access = await loadAdminPermissionAccess(req.user.id);
  if ((access.permissions || []).includes('hr:add_employee')) return { type: 'all' };
  const scopes = access.scopes || {};
  return normalizeScope(
    scopes['attendance:view'] ||
      scopes['attendance:edit'] ||
      scopes['employees:view'] ||
      scopes['employees:edit']
  );
}

async function loadOnsiteEmployee(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, name, username, employee_id, branch, shift, employment_type, is_active, status
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function loadBranchIp(branchName) {
  const name = String(branchName || '').trim();
  if (!name) return null;
  const { rows } = await pool.query(
    `SELECT name, ip_address, latitude, longitude, radius_meters
     FROM branches WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

function parseCheckInCoords(body) {
  const latRaw = body?.latitude;
  const lngRaw = body?.longitude;
  const latPresent = latRaw != null && latRaw !== '';
  const lngPresent = lngRaw != null && lngRaw !== '';
  if (latPresent !== lngPresent) {
    const err = new Error('latitude and longitude must both be provided.');
    err.statusCode = 400;
    throw err;
  }
  if (!latPresent) return null;
  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    const err = new Error('latitude must be a number between -90 and 90.');
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    const err = new Error('longitude must be a number between -180 and 180.');
    err.statusCode = 400;
    throw err;
  }
  return { latitude, longitude };
}

function branchGeofence(row) {
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const radiusMeters = Number(row?.radius_meters);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
  return { latitude, longitude, radiusMeters };
}

async function insertOnsiteRecord({
  user,
  checkedInAt,
  method,
  markedBy,
  note,
  upsert = false,
  workDateOverride = null,
  allowAnyPastDate = false,
}) {
  const shift = await getShiftByName(user.shift);
  if (!shift) {
    const err = new Error(
      user.shift
        ? `Shift “${user.shift}” is not in the shift catalog. Ask HR to create it.`
        : 'You are not assigned to a shift. Ask HR to assign one before checking in.'
    );
    err.statusCode = 400;
    throw err;
  }

  const branch = String(user.branch || '').trim();
  if (!branch) {
    const err = new Error('You are not assigned to a branch. Ask HR to assign one before checking in.');
    err.statusCode = 400;
    throw err;
  }

  const calc = statusForCheckIn(checkedInAt, shift);
  const override = String(workDateOverride || '').slice(0, 10);
  let workDate = /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : calc.workDate;
  if (method === 'manual') workDate = assertManualWorkDate(workDate, { allowPast: allowAnyPastDate });
  calc.workDate = workDate;
  const params = [
    user.id,
    workDate,
    checkedInAt,
    calc.status,
    method,
    branch,
    shift.name,
    markedBy ?? null,
    note || null,
  ];

  if (!upsert) {
    const { rows: existing } = await pool.query(
      `
        SELECT id FROM onsite_attendance
        WHERE user_id = $1 AND work_date = $2::date
        LIMIT 1
      `,
      [user.id, calc.workDate]
    );
    if (existing[0]) {
      const err = new Error('This employee already checked in. You can only change their status.');
      err.statusCode = 409;
      throw err;
    }
  }

  if (upsert) {
    const { rows: existing } = await pool.query(
      `
        SELECT id FROM onsite_attendance
        WHERE user_id = $1 AND work_date = $2::date
        LIMIT 1
      `,
      [user.id, calc.workDate]
    );
    if (existing[0]) {
      const { rows } = await pool.query(
        `
          UPDATE onsite_attendance
          SET checked_in_at = $2,
              status = $3,
              method = $4,
              branch_name = $5,
              shift_name = $6,
              marked_by = $7,
              note = COALESCE($8, note),
              status_overridden = false,
              previous_status = status,
              updated_at = NOW()
          WHERE id = $1
          RETURNING ${ONSITE_SELECT}
        `,
        [
          existing[0].id,
          checkedInAt,
          calc.status,
          method,
          branch,
          shift.name,
          markedBy ?? null,
          note || null,
        ]
      );
      return { row: rows[0], shift, calc };
    }
  }

  const { rows } = await pool.query(
    `
      INSERT INTO onsite_attendance (
        user_id, work_date, checked_in_at, status, method,
        branch_name, shift_name, marked_by, note
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${ONSITE_SELECT}
    `,
    params
  );
  return { row: rows[0], shift, calc };
}

/**
 * POST /api/attendance/onsite-check-in
 */
async function onsiteCheckIn(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const user = await loadOnsiteEmployee(req.user.id);
    if (!user || user.is_active === false) {
      return res.status(403).json({ message: 'Account is not active.' });
    }
    if (String(user.employment_type || 'onsite').trim().toLowerCase() !== 'onsite') {
      return res.status(403).json({
        message: 'Office check-in is only for onsite employees.',
      });
    }

    const shiftForWindow = user.shift ? await getShiftByName(user.shift) : null;
    if (!employeeCanSelfCheckIn(shiftForWindow || user.shift)) {
      return res.status(403).json({
        code: 'night_checkin_window',
        message:
          'Night shift check-in is only open from 9:00 PM to 11:59 PM. Ask an admin to mark attendance after that.',
      });
    }

    const branchRow = await loadBranchIp(user.branch);
    const branchLabel = String(user.branch || '').trim() || 'your assigned branch';
    const officeIps = parseOfficeIps(branchRow?.ip_address);
    const geofence = branchGeofence(branchRow);
    const requestCoords = parseCheckInCoords(req.body);

    if (!officeIps.length && !geofence) {
      return res.status(400).json({
        message: `No office IP or check-in location is set for ${branchLabel}. Open Manage Branches and save the public IP and/or GPS coordinates on that same branch (not a different office).`,
      });
    }

    const ipOk = officeIps.length > 0 && requestMatchesConfiguredIp(req, officeIps);
    let gpsOk = false;
    let gpsDistanceMeters = null;
    if (!ipOk && geofence && requestCoords) {
      gpsDistanceMeters = haversineDistanceMeters(
        requestCoords.latitude,
        requestCoords.longitude,
        geofence.latitude,
        geofence.longitude
      );
      gpsOk = gpsDistanceMeters <= geofence.radiusMeters;
      if (gpsOk) {
        console.log('[onsite-gps-fallback]', {
          branch: branchRow?.name || branchLabel,
          distanceMeters: Math.round(gpsDistanceMeters),
          radiusMeters: geofence.radiusMeters,
          requestLatitude: requestCoords.latitude,
          requestLongitude: requestCoords.longitude,
        });
      }
    }

    if (!ipOk && !gpsOk) {
      return res.status(403).json({
        message: "You must check in from your branch's network.",
      });
    }

    const checkedInAt = new Date();
    try {
      const { row, calc } = await insertOnsiteRecord({
        user,
        checkedInAt,
        method: 'ip',
        markedBy: null,
        note: null,
      });
      return res.status(201).json({
        message: 'Checked in.',
        status: calc.status,
        record: publicRow(row),
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'You already checked in for this shift day.' });
      }
      throw err;
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error('onsiteCheckIn error:', err);
    return res.status(500).json({ message: 'Server error during check-in.' });
  }
}

/**
 * GET /api/attendance/onsite-me
 */
async function getMyOnsiteAttendance(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const parts = zonedParts();
    const month = String(req.query.month || parts.dateKey.slice(0, 7)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: 'month must look like YYYY-MM.' });
    }

    const { rows } = await pool.query(
      `
        SELECT ${ONSITE_SELECT}
        FROM onsite_attendance
        WHERE user_id = $1
          AND to_char(work_date, 'YYYY-MM') = $2
        ORDER BY work_date DESC
      `,
      [req.user.id, month]
    );

    const user = await loadOnsiteEmployee(req.user.id);
    const shift = user?.shift ? await getShiftByName(user.shift) : null;
    const branchRow = await loadBranchIp(user?.branch);
    const networkConfigured =
      parseOfficeIps(branchRow?.ip_address).length > 0 || Boolean(branchGeofence(branchRow));

    const todayRaw =
      rows.find((r) => pgDateKey(r.work_date) === parts.dateKey) ||
      rows.find((r) => {
        const at = r.checked_in_at ? zonedParts(new Date(r.checked_in_at)).dateKey : '';
        return at === parts.dateKey;
      }) ||
      null;
    const today = todayRaw ? await persistLiveStatus(todayRaw, shift) : null;
    const totals = { on_time: 0, late: 0, absent: 0 };
    const days = [];
    for (const row of rows) {
      const live = row.id === todayRaw?.id ? today : await persistLiveStatus(row, shift);
      const pub = publicRow(live);
      days.push(pub);
      if (pub && totals[pub.status] != null) totals[pub.status] += 1;
    }

    const nightShift = isNightShift(shift || user?.shift);
    const windowOpen = employeeCanSelfCheckIn(shift || user?.shift);

    return res.json({
      date: parts.dateKey,
      month,
      today: publicRow(today),
      can_check_in: Boolean(!today && windowOpen),
      night_shift: nightShift,
      self_check_in_open: windowOpen,
      self_check_in_window: nightShift
        ? { start: '21:00', end: '23:59', timezone: 'Asia/Karachi' }
        : null,
      network_configured: networkConfigured,
      branch_name: user?.branch || null,
      shift: shift
        ? {
            name: shift.name,
            start_time: shift.start_time,
            late_after: shift.late_after,
            absent_after: shift.absent_after,
          }
        : user?.shift
          ? { name: user.shift }
          : null,
      days,
      totals,
    });
  } catch (err) {
    console.error('getMyOnsiteAttendance error:', err);
    return res.status(500).json({ message: 'Server error fetching attendance.' });
  }
}

/**
 * GET /api/admin/onsite-attendance
 */
async function adminListOnsite(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const parts = zonedParts();
    const dateKey = String(req.query.date || parts.dateKey).slice(0, 10);
    const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const viewScope = await resolveOnsiteViewScope(req);
    const editScope = await resolveOnsiteEditScope(req);
    const filter = scopeWhereClause(viewScope, 1);

    const { rows: people } = await pool.query(
      `
        SELECT id, employee_id, name, username, branch, department, employment_type,
               profile_picture_url, shift, is_active, status
        FROM users
        WHERE is_active = true
          AND status = 'active'
          AND COALESCE(NULLIF(TRIM(employment_type), ''), 'onsite') = 'onsite'
          ${filter.sql}
        ORDER BY name ASC NULLS LAST, id ASC
      `,
      filter.params
    );

    const ids = people.map((p) => p.id);
    let records = [];
    if (ids.length) {
      const { rows } = await pool.query(
        `
          SELECT ${ONSITE_SELECT}
          FROM onsite_attendance
          WHERE work_date = $1::date
            AND user_id = ANY($2::int[])
        `,
        [dateKey, ids]
      );
      records = rows;
    }
    const byUser = new Map(records.map((r) => [String(r.user_id), r]));

    const employees = [];
    const summary = { employees: 0, on_time: 0, late: 0, absent: 0, pending: 0, manual: 0 };
    const shiftCache = new Map();
    for (const person of people) {
      if (search) {
        const hay = `${person.name} ${person.employee_id} ${person.username} ${person.branch}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      let rec = byUser.get(String(person.id)) || null;
      if (rec && person.shift) {
        if (!shiftCache.has(person.shift)) {
          shiftCache.set(person.shift, await getShiftByName(person.shift));
        }
        rec = await persistLiveStatus(rec, shiftCache.get(person.shift));
      }
      const rowStatus = rec?.status || 'pending';
      if (statusFilter !== 'all' && rowStatus !== statusFilter) continue;
      const canEdit = employeeMatchesScope(person, editScope);
      summary.employees += 1;
      if (rowStatus === 'on_time') summary.on_time += 1;
      else if (rowStatus === 'late') summary.late += 1;
      else if (rowStatus === 'absent') summary.absent += 1;
      else summary.pending += 1;
      if (rec?.method === 'manual') summary.manual += 1;
      employees.push({
        id: person.id,
        name: person.name,
        employee_id: person.employee_id,
        username: person.username,
        branch: person.branch,
        department: person.department,
        shift: person.shift,
        profile_picture_url: withProfileApiUrl(person).profile_picture_url,
        row_status: rowStatus,
        can_manual: Boolean(canEdit && (!rec || isCeoRole(req.user?.role))),
        can_override: Boolean(canEdit && rec),
        can_delete: Boolean(isCeoRole(req.user?.role) && rec),
        record: publicRow(rec),
      });
    }

    return res.json({ date: dateKey, summary, employees });
  } catch (err) {
    console.error('adminListOnsite error:', err);
    return res.status(500).json({ message: 'Server error fetching onsite attendance.' });
  }
}

/**
 * GET /api/admin/onsite-attendance/:userId/month
 */
async function adminGetOnsiteMonth(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid employee.' });
    }
    const user = await loadOnsiteEmployee(userId);
    if (!user) return res.status(404).json({ message: 'Employee not found.' });

    const viewScope = await resolveOnsiteViewScope(req);
    if (!employeeMatchesScope(user, viewScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance view scope.' });
    }

    const parts = zonedParts();
    const month = String(req.query.month || parts.dateKey.slice(0, 7)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: 'month must look like YYYY-MM.' });
    }

    const { rows } = await pool.query(
      `
        SELECT ${ONSITE_SELECT}
        FROM onsite_attendance
        WHERE user_id = $1
          AND to_char(work_date, 'YYYY-MM') = $2
        ORDER BY work_date DESC
      `,
      [userId, month]
    );

    const shift = user.shift ? await getShiftByName(user.shift) : null;
    const totals = { on_time: 0, late: 0, absent: 0 };
    const days = [];
    for (const row of rows) {
      const live = await persistLiveStatus(row, shift);
      const pub = publicRow(live);
      days.push(pub);
      if (pub && totals[pub.status] != null) totals[pub.status] += 1;
    }

    return res.json({
      month,
      employee: {
        id: user.id,
        name: user.name,
        employee_id: user.employee_id,
        branch: user.branch,
        shift: user.shift,
      },
      days,
      totals,
      recorded: days.length,
    });
  } catch (err) {
    console.error('adminGetOnsiteMonth error:', err);
    return res.status(500).json({ message: 'Server error loading month attendance.' });
  }
}

/**
 * POST /api/admin/onsite-attendance
 */
async function adminManualOnsite(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const userId = Number(req.body?.user_id || req.body?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Select an employee.' });
    }
    const checkedInAt = parseCheckInAt(req.body?.checked_in_at || req.body?.checkedInAt);
    if (!checkedInAt) {
      return res.status(400).json({ message: 'Enter a valid check-in time.' });
    }
    const workDateOverride = String(req.body?.work_date || req.body?.workDate || '').slice(0, 10);
    if (workDateOverride && !isCeoRole(req.user?.role)) assertManualWorkDate(workDateOverride);

    const user = await loadOnsiteEmployee(userId);
    if (!user || user.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (String(user.employment_type || 'onsite').trim().toLowerCase() !== 'onsite') {
      return res.status(400).json({ message: 'Manual office check-in is only for onsite employees.' });
    }

    const editScope = await resolveOnsiteEditScope(req);
    if (!employeeMatchesScope(user, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }

    const ceo = isCeoRole(req.user?.role);
    try {
      const { row, calc } = await insertOnsiteRecord({
        user,
        checkedInAt,
        method: 'manual',
        markedBy: req.user.id,
        note: String(req.body?.note || '').trim() || null,
        upsert: ceo,
        workDateOverride,
        allowAnyPastDate: ceo,
      });

      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'onsite_attendance.manual_check_in',
        targetTable: 'onsite_attendance',
        targetId: row.id,
        reason: `Manual onsite check-in for ${user.name || user.username} (${user.employee_id || user.id}) at ${checkedInAt.toISOString()} → ${calc.status} (${row.branch_name})`,
      });

      return res.status(201).json({
        message: 'Attendance recorded.',
        status: calc.status,
        record: publicRow(row),
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          message: 'This employee already checked in. You can only change their status.',
        });
      }
      throw err;
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error('adminManualOnsite error:', err);
    return res.status(500).json({ message: 'Server error saving attendance.' });
  }
}

const ALLOWED_STATUS = new Set(['on_time', 'late', 'absent']);

/**
 * PATCH /api/admin/onsite-attendance/:id
 */
async function adminOverrideOnsite(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid attendance id.' });
    }
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!ALLOWED_STATUS.has(nextStatus)) {
      return res.status(400).json({ message: 'Status must be on_time, late, or absent.' });
    }

    const { rows } = await pool.query(
      `SELECT ${ONSITE_SELECT} FROM onsite_attendance WHERE id = $1 LIMIT 1`,
      [id]
    );
    const rec = rows[0];
    if (!rec) return res.status(404).json({ message: 'Attendance record not found.' });

    const user = await loadOnsiteEmployee(rec.user_id);
    if (!user) return res.status(404).json({ message: 'Employee not found.' });

    const editScope = await resolveOnsiteEditScope(req);
    if (!employeeMatchesScope(user, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }

    if (rec.status === nextStatus) {
      return res.json({ message: 'Status unchanged.', record: publicRow(rec) });
    }

    const { rows: updated } = await pool.query(
      `
        UPDATE onsite_attendance
        SET status = $2,
            previous_status = $3,
            status_overridden = true,
            updated_at = NOW()
        WHERE id = $1
        RETURNING ${ONSITE_SELECT}
      `,
      [id, nextStatus, rec.status]
    );

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'onsite_attendance.status_override',
      targetTable: 'onsite_attendance',
      targetId: id,
      reason: `Changed onsite attendance for ${user.name || user.username} (${user.employee_id || user.id}) ${rec.status} → ${nextStatus}`,
    });

    return res.json({
      message: 'Status updated.',
      record: publicRow(updated[0]),
    });
  } catch (err) {
    console.error('adminOverrideOnsite error:', err);
    return res.status(500).json({ message: 'Server error updating status.' });
  }
}

/**
 * DELETE /api/admin/onsite-attendance/:id
 * CEO only — removes one employee's check-in for that record's work date.
 */
async function adminDeleteOnsite(req, res) {
  try {
    if (!isCeoRole(req.user?.role)) {
      return res.status(403).json({ message: 'Only the CEO can delete attendance.' });
    }
    await ensureOnsiteAttendanceSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid attendance id.' });
    }

    const { rows } = await pool.query(
      `SELECT ${ONSITE_SELECT} FROM onsite_attendance WHERE id = $1 LIMIT 1`,
      [id]
    );
    const rec = rows[0];
    if (!rec) return res.status(404).json({ message: 'Attendance record not found.' });

    const user = await loadOnsiteEmployee(rec.user_id);
    await pool.query(`DELETE FROM onsite_attendance WHERE id = $1`, [id]);

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'onsite_attendance.delete',
      targetTable: 'onsite_attendance',
      targetId: id,
      reason: `Deleted onsite attendance for ${user?.name || user?.username || rec.user_id} (${user?.employee_id || rec.user_id}) on ${pgDateKey(rec.work_date)} (was ${rec.status}, ${rec.method})`,
    });

    return res.json({
      message: `Deleted attendance for ${pgDateKey(rec.work_date)}.`,
      record: publicRow(rec),
    });
  } catch (err) {
    console.error('adminDeleteOnsite error:', err);
    return res.status(500).json({ message: 'Server error deleting attendance.' });
  }
}

module.exports = {
  onsiteCheckIn,
  getMyOnsiteAttendance,
  adminListOnsite,
  adminGetOnsiteMonth,
  adminManualOnsite,
  adminOverrideOnsite,
  adminDeleteOnsite,
};
