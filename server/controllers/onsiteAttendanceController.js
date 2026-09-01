const pool = require('../config/db');
const { ensureOnsiteAttendanceSchema } = require('../utils/onsiteAttendanceSchema');
const { statusForCheckIn, parseCheckInAt } = require('../utils/onsiteShiftStatus');
const { requestMatchesConfiguredIp, parseOfficeIps } = require('../utils/requestMeta');
const { writeAuditLog } = require('../utils/auditLog');
const { zonedParts } = require('../utils/attendanceWindows');
const {
  normalizeScope,
  employeeMatchesScope,
  scopeWhereClause,
} = require('../utils/employeeScope');
const { loadAdminPermissionAccess, isCeoRole } = require('../middleware/permissions');
const { getShiftByName } = require('./shiftsController');

const ONSITE_SELECT = `
  id, user_id, work_date, checked_in_at, status, method,
  branch_name, shift_name, marked_by, note, status_overridden, previous_status,
  created_at, updated_at
`;

function publicRow(row) {
  if (!row) return null;
  const workDate =
    row.work_date instanceof Date
      ? row.work_date.toISOString().slice(0, 10)
      : String(row.work_date).slice(0, 10);
  return {
    id: row.id,
    user_id: row.user_id,
    work_date: workDate,
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

async function resolveOnsiteEditScope(req) {
  if (isCeoRole(req.user?.role)) return { type: 'all' };
  const access = await loadAdminPermissionAccess(req.user.id);
  if ((access.permissions || []).includes('hr:add_employee')) return { type: 'all' };
  if (!(access.permissions || []).includes('attendance:edit')) {
    return { type: 'branch', values: [] };
  }
  return normalizeScope(access.scopes['attendance:edit']);
}

async function resolveOnsiteViewScope(req) {
  if (isCeoRole(req.user?.role)) return { type: 'all' };
  const access = await loadAdminPermissionAccess(req.user.id);
  if ((access.permissions || []).includes('hr:add_employee')) return { type: 'all' };
  const scopes = access.scopes || {};
  return normalizeScope(scopes['attendance:view'] || scopes['attendance:edit']);
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
    `SELECT name, ip_address FROM branches WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

async function insertOnsiteRecord({
  user,
  checkedInAt,
  method,
  markedBy,
  note,
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

  const { rows } = await pool.query(
    `
      INSERT INTO onsite_attendance (
        user_id, work_date, checked_in_at, status, method,
        branch_name, shift_name, marked_by, note
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${ONSITE_SELECT}
    `,
    [
      user.id,
      calc.workDate,
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
    if (String(user.employment_type || '').toLowerCase() !== 'onsite') {
      return res.status(403).json({
        message: 'Office check-in is only for onsite employees.',
      });
    }

    const branchRow = await loadBranchIp(user.branch);
    const branchLabel = String(user.branch || '').trim() || 'your assigned branch';
    const officeIps = parseOfficeIps(branchRow?.ip_address);
    if (!officeIps.length) {
      return res.status(400).json({
        message: `No office IP is set for ${branchLabel}. Open Manage Branches and save the public IP on that same branch (not a different office).`,
      });
    }

    if (!requestMatchesConfiguredIp(req, officeIps)) {
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

    const today = rows.find((r) => String(r.work_date).slice(0, 10) === parts.dateKey) || null;
    const totals = { on_time: 0, late: 0, absent: 0 };
    for (const row of rows) {
      if (totals[row.status] != null) totals[row.status] += 1;
    }

    const user = await loadOnsiteEmployee(req.user.id);
    const shift = user?.shift ? await getShiftByName(user.shift) : null;
    const branchRow = await loadBranchIp(user?.branch);
    const networkConfigured = parseOfficeIps(branchRow?.ip_address).length > 0;

    return res.json({
      date: parts.dateKey,
      month,
      today: publicRow(today),
      can_check_in: !today,
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
      days: rows.map(publicRow),
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
          AND employment_type = 'onsite'
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
    const byUser = new Map(records.map((r) => [r.user_id, r]));

    const employees = [];
    const summary = { employees: 0, on_time: 0, late: 0, absent: 0, pending: 0, manual: 0 };
    for (const person of people) {
      if (search) {
        const hay = `${person.name} ${person.employee_id} ${person.username} ${person.branch}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const rec = byUser.get(person.id);
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
        profile_picture_url: person.profile_picture_url,
        row_status: rowStatus,
        can_manual: canEdit && !rec,
        can_override: Boolean(canEdit && rec),
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

    const user = await loadOnsiteEmployee(userId);
    if (!user || user.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (String(user.employment_type || '').toLowerCase() !== 'onsite') {
      return res.status(400).json({ message: 'Manual office check-in is only for onsite employees.' });
    }

    const editScope = await resolveOnsiteEditScope(req);
    if (!employeeMatchesScope(user, editScope)) {
      return res.status(403).json({ message: 'This employee is outside your attendance edit scope.' });
    }

    try {
      const { row, calc } = await insertOnsiteRecord({
        user,
        checkedInAt,
        method: 'manual',
        markedBy: req.user.id,
        note: String(req.body?.note || '').trim() || null,
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
          message: 'This employee already has an attendance record for that shift day.',
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

module.exports = {
  onsiteCheckIn,
  getMyOnsiteAttendance,
  adminListOnsite,
  adminManualOnsite,
  adminOverrideOnsite,
};
