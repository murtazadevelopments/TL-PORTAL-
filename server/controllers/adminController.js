const pool = require('../config/db');
const { attachReadableUrls, withProfileApiUrl } = require('../utils/storageUrls');
const { deleteRelativeFile } = require('../services/localStorage');
const {
  notifyEmployeeAdminUpdated,
  notifyAccountApproved,
  summarizeChanges,
} = require('../services/notifications');
const { writeAuditLog } = require('../utils/auditLog');
const {
  loadAdminPermissions,
  loadAdminPermissionAccess,
} = require('../middleware/permissions');
const {
  employeeMatchesScope,
  scopeWhereClause,
  normalizeScope,
} = require('../utils/employeeScope');
const { ensureBlockedColumn } = require('../utils/accountStatus');
const {
  missingEmployeePortalFields,
  formatFieldList,
  ensureProfileAlertColumns,
  profileAlertCooldown,
} = require('../utils/profileCompleteness');
const {
  ensureEmploymentTypeColumn,
  normalizeEmploymentType,
} = require('../utils/employmentType');
const { ensureAttendanceTables } = require('../utils/attendanceSchema');
const { normalizeWorkHours } = require('../utils/workHours');

const LIST_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  department, designation, status, branch, shift, salary, date_of_joining,
  education, last_job_status, employment_type, profile_picture_url, created_at, is_active,
  failed_login_attempts, locked_at, blocked_at, blocked_reason,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name,
  profile_alert_at, profile_alert_sent_at
`;

const DETAIL_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, employment_form_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  education, last_job_status, employment_type, date_of_birth,
  date_of_joining, date_joined, created_at, updated_at, is_active,
  work_start_hour, work_end_hour,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name,
  failed_login_attempts, locked_at, blocked_at, blocked_reason,
  profile_alert_at, profile_alert_sent_at
`;

const ALLOWED_UPDATE_FIELDS = [
  'employee_id',
  'status',
  'department',
  'designation',
  'branch',
  'shift',
  'salary',
  'date_of_joining',
  'employment_type',
  'work_start_hour',
  'work_end_hour',
];

const REQUIRED_ADMIN_FIELDS = [
  'employee_id',
  'status',
  'department',
  'designation',
  'branch',
  'shift',
  'salary',
];

function isEmptyValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isSalaryMissing(value) {
  if (isEmptyValue(value)) return true;
  const n = Number(value);
  return !Number.isFinite(n) || n <= 0;
}

function viewerCanSeeSalary(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'ceo') return true;
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  return perms.includes('employees:salary') || perms.includes('*');
}

function redactSalary(row, canSee) {
  if (!row) return row;
  const salaryOnFile = !isSalaryMissing(row.salary);
  if (canSee) {
    return { ...row, salary_hidden: false, salary_on_file: salaryOnFile };
  }
  const copy = { ...row };
  delete copy.salary;
  copy.salary_hidden = true;
  copy.salary_on_file = salaryOnFile;
  return copy;
}

function storagePathFromUrl(value) {
  if (!value) return null;
  const v = String(value);
  if (v.startsWith('http://') || v.startsWith('https://')) return null;
  return v;
}

async function withListUrls(row) {
  return withProfileApiUrl(row);
}

async function resolvePermissionScopes(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'ceo') return {};
  if (req.user?.permissionScopes && typeof req.user.permissionScopes === 'object') {
    return req.user.permissionScopes;
  }
  if (role === 'admin' && req.user?.id) {
    const access = await loadAdminPermissionAccess(req.user.id);
    req.user.permissions = access.permissions;
    req.user.permissionScopes = access.scopes;
    return access.scopes;
  }
  return {};
}

function scopeForPermission(scopes, key) {
  return normalizeScope(scopes?.[key]);
}

async function listEmployees(req, res) {
  try {
    await ensureBlockedColumn();
    await ensureProfileAlertColumns();
    await ensureEmploymentTypeColumn();
    const scopes = await resolvePermissionScopes(req);
    const viewScope = scopeForPermission(scopes, 'employees:view');
    const filter = scopeWhereClause(viewScope, 1);

    const { rows } = await pool.query(
      `
        SELECT ${LIST_COLUMNS}
        FROM users
        WHERE is_active = true
        ${filter.sql}
        ORDER BY created_at DESC NULLS LAST, id DESC
      `,
      filter.params
    );

    const canSeeSalary = viewerCanSeeSalary(req);
    const employees = await Promise.all(
      rows.map(async (row) => redactSalary(await withListUrls(row), canSeeSalary))
    );
    return res.json(employees);
  } catch (err) {
    console.error('listEmployees error:', err);
    return res.status(500).json({ message: 'Server error fetching employees.' });
  }
}

async function getEmployeeById(req, res) {
  try {
    await ensureProfileAlertColumns();
    await ensureEmploymentTypeColumn();
    const { id } = req.params;

    const { rows } = await pool.query(
      `
        SELECT ${DETAIL_COLUMNS}
        FROM users
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const scopes = await resolvePermissionScopes(req);
    const viewScope = scopeForPermission(scopes, 'employees:view');
    if (!employeeMatchesScope(rows[0], viewScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned view scope.',
      });
    }

    const employee = redactSalary(
      await attachReadableUrls(rows[0]),
      viewerCanSeeSalary(req)
    );

    // Redact CNIC/CV unless CEO or admin has documents:view
    const role = String(req.user?.role || '').toLowerCase();
    let canViewDocs = role === 'ceo';
    if (!canViewDocs && role === 'admin') {
      const perms =
        Array.isArray(req.user.permissions) && req.user.permissions.length
          ? req.user.permissions
          : await loadAdminPermissions(req.user.id);
      canViewDocs = perms.includes('documents:view') || perms.includes('*');
    }
    if (!canViewDocs) {
      employee.cnic_front_url = null;
      employee.cnic_back_url = null;
      employee.cv_url = null;
      employee.employment_form_url = null;
      employee.documents_redacted = true;
    } else {
      // CNIC streaming is blocked for all roles; expose presence only for admin UI.
      employee.cnic_front_on_file = Boolean(employee.cnic_front_url);
      employee.cnic_back_on_file = Boolean(employee.cnic_back_url);
      employee.cnic_front_url = null;
      employee.cnic_back_url = null;
    }

    return res.json(employee);
  } catch (err) {
    console.error('getEmployeeById error:', err);
    return res.status(500).json({ message: 'Server error fetching employee.' });
  }
}

async function updateEmployee(req, res) {
  try {
    await ensureAttendanceTables();
    const { id } = req.params;
    const body = req.body || {};
    const keys = Object.keys(body);

    if (keys.length === 0) {
      return res.status(400).json({
        message:
          'Required fields: employee_id, status, department, designation, branch, shift, salary. Optional: date_of_joining, employment_type.',
      });
    }

    const rejected = keys.filter((key) => !ALLOWED_UPDATE_FIELDS.includes(key));
    if (rejected.length > 0) {
      return res.status(400).json({
        message: `Field(s) not allowed: ${rejected.join(', ')}. Only employee_id, status, department, designation, branch, shift, salary, date_of_joining, employment_type, and working hours can be updated.`,
      });
    }

    const canSeeSalary = viewerCanSeeSalary(req);
    if (Object.prototype.hasOwnProperty.call(body, 'salary') && !canSeeSalary) {
      return res.status(403).json({
        message: 'You do not have permission to view or update employee salary.',
      });
    }

    const requiredFields = canSeeSalary
      ? REQUIRED_ADMIN_FIELDS
      : REQUIRED_ADMIN_FIELDS.filter((key) => key !== 'salary');
    const missing = requiredFields.filter((key) =>
      key === 'salary' ? isSalaryMissing(body[key]) : isEmptyValue(body[key])
    );
    if (missing.length > 0) {
      return res.status(400).json({
        message: `All fields are required before saving. Missing: ${missing.join(', ')}.`,
        missing,
      });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT ${DETAIL_COLUMNS} FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
      [id]
    );

    if (!existingRows[0]) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const before = existingRows[0];

    const scopes = await resolvePermissionScopes(req);
    const editScope = scopeForPermission(scopes, 'employees:edit');
    if (!employeeMatchesScope(before, editScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned edit scope.',
      });
    }

    const next = {
      employee_id: String(body.employee_id).trim(),
      status: String(body.status).trim().toLowerCase(),
      department: String(body.department).trim(),
      designation: String(body.designation).trim(),
      branch: String(body.branch).trim(),
      shift: String(body.shift).trim(),
      salary: canSeeSalary ? Number(body.salary) : before.salary,
      date_of_joining:
        body.date_of_joining === undefined
          ? before.date_of_joining
          : body.date_of_joining === null || String(body.date_of_joining).trim() === ''
            ? null
            : String(body.date_of_joining).trim().slice(0, 10),
      employment_type:
        body.employment_type === undefined || String(body.employment_type).trim() === ''
          ? before.employment_type || 'onsite'
          : normalizeEmploymentType(body.employment_type),
    };
    const hours = normalizeWorkHours(
      body.work_start_hour ?? before.work_start_hour,
      body.work_end_hour ?? before.work_end_hour
    );
    next.work_start_hour = hours.start;
    next.work_end_hour = hours.end;

    if (!['active', 'inactive'].includes(next.status)) {
      return res.status(400).json({ message: 'Status must be "active" or "inactive".' });
    }

    if (canSeeSalary && (Number.isNaN(next.salary) || next.salary <= 0)) {
      return res.status(400).json({ message: 'Salary is required and must be greater than 0.' });
    }

    if (!next.employee_id) {
      return res.status(400).json({ message: 'Employee ID is required.' });
    }

    if (!next.employment_type) {
      return res.status(400).json({ message: 'employment_type must be "onsite" or "remote".' });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET
          employee_id = $1,
          status = $2,
          department = $3,
          designation = $4,
          branch = $5,
          shift = $6,
          salary = $7,
          date_of_joining = $8,
          employment_type = $9,
          work_start_hour = $10,
          work_end_hour = $11,
          updated_at = NOW()
        WHERE id = $12 AND is_active = true
        RETURNING ${DETAIL_COLUMNS}
      `,
      [
        next.employee_id,
        next.status,
        next.department,
        next.designation,
        next.branch,
        next.shift,
        next.salary,
        next.date_of_joining,
        next.employment_type,
        next.work_start_hour,
        next.work_end_hour,
        id,
      ]
    );

    const employee = await attachReadableUrls(rows[0]);
    const changed = summarizeChanges(before, employee, ALLOWED_UPDATE_FIELDS);
    if (changed.length) {
      await notifyEmployeeAdminUpdated(employee, changed);
    }

    const beforeStatus = String(before.status || '')
      .trim()
      .toLowerCase();
    const afterStatus = String(employee.status || '')
      .trim()
      .toLowerCase();
    if (beforeStatus !== 'active' && afterStatus === 'active') {
      try {
        await notifyAccountApproved(employee);
        await writeAuditLog({
          actorId: req.user.id,
          actorUsername: req.user.username,
          action: 'account_approved',
          targetTable: 'users',
          targetId: employee.id,
          reason: `Status changed from ${beforeStatus || 'unset'} to active`,
        });
      } catch (notifyErr) {
        console.warn(
          '[account_approved] notify/audit failed:',
          notifyErr.message || notifyErr
        );
      }
    }

    return res.json(redactSalary(employee, canSeeSalary));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Employee ID is already in use.' });
    }
    console.error('updateEmployee error:', err);
    return res.status(500).json({ message: 'Server error updating employee.' });
  }
}

/**
 * DELETE /api/admin/employees/:id
 * Soft-delete: set is_active = false (admin + CEO).
 */
async function deactivateEmployee(req, res) {
  try {
    const { id } = req.params;

    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, branch, department, is_active
        FROM users
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `,
      [id]
    );
    if (!existingRows[0]) {
      return res.status(404).json({ message: 'Employee not found or already deactivated.' });
    }

    const scopes = await resolvePermissionScopes(req);
    // Prefer edit scope if present, otherwise view scope
    const editScope = scopes['employees:edit']
      ? scopeForPermission(scopes, 'employees:edit')
      : scopeForPermission(scopes, 'employees:view');
    if (!employeeMatchesScope(existingRows[0], editScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned scope.',
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND is_active = true
        RETURNING id, employee_id, username, name, email, role, is_active
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Employee not found or already deactivated.' });
    }

    return res.json({
      message: 'Employee deactivated.',
      user: rows[0],
    });
  } catch (err) {
    console.error('deactivateEmployee error:', err);
    return res.status(500).json({ message: 'Server error deactivating employee.' });
  }
}

/**
 * PUT /api/admin/employees/:id/restore
 * Soft-restore: set is_active = true (admin + CEO with employees:deactivate).
 */
async function restoreEmployee(req, res) {
  try {
    const { id } = req.params;

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, branch, department, is_active
        FROM users
        WHERE id = $1 AND is_active = false
        LIMIT 1
      `,
      [id]
    );
    if (!existingRows[0]) {
      return res.status(404).json({ message: 'Deactivated employee not found.' });
    }

    const scopes = await resolvePermissionScopes(req);
    const editScope = scopes['employees:edit']
      ? scopeForPermission(scopes, 'employees:edit')
      : scopeForPermission(scopes, 'employees:view');
    if (!employeeMatchesScope(existingRows[0], editScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned scope.',
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET is_active = true, updated_at = NOW()
        WHERE id = $1 AND is_active = false
        RETURNING id, employee_id, username, name, email, role, is_active
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Deactivated employee not found.' });
    }

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'restore',
        targetTable: 'users',
        targetId: id,
        reason: `Restored ${rows[0].username || rows[0].name || id}`,
      });
    } catch (auditErr) {
      console.warn('restore audit failed:', auditErr.message || auditErr);
    }

    return res.json({
      message: 'Employee restored.',
      user: rows[0],
    });
  } catch (err) {
    console.error('restoreEmployee error:', err);
    return res.status(500).json({ message: 'Server error restoring employee.' });
  }
}

/**
 * DELETE /api/admin/employees/:id/purge
 * Hard-delete: permanent removal (CEO only). Body: { reason }
 */
async function purgeEmployee(req, res) {
  try {
    const { id } = req.params;
    const reason =
      String(req.body?.reason || '').trim() || 'Permanent delete from deactivated list';

    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot purge your own account.' });
    }

    const { rows } = await pool.query(
      `
        SELECT id, role, username, name, cnic_front_url, cnic_back_url, cv_url, employment_form_url, profile_picture_url
        FROM users WHERE id = $1 LIMIT 1
      `,
      [id]
    );

    const employee = rows[0];
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username || null,
      action: 'purge',
      targetTable: 'users',
      targetId: id,
      reason,
    });

    await Promise.all([
      deleteRelativeFile(storagePathFromUrl(employee.cnic_front_url)),
      deleteRelativeFile(storagePathFromUrl(employee.cnic_back_url)),
      deleteRelativeFile(storagePathFromUrl(employee.cv_url)),
      deleteRelativeFile(storagePathFromUrl(employee.employment_form_url)),
      deleteRelativeFile(storagePathFromUrl(employee.profile_picture_url)),
    ]);

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

    return res.json({ message: 'Employee permanently purged.' });
  } catch (err) {
    console.error('purgeEmployee error:', err);
    return res.status(500).json({ message: 'Server error purging employee.' });
  }
}

/**
 * GET /api/admin/deactivated
 * Soft-deleted users for admin review.
 */
async function listDeactivated(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT ${LIST_COLUMNS}
        FROM users
        WHERE is_active = false
        ORDER BY updated_at DESC NULLS LAST, id DESC
      `
    );

    const canSeeSalary = viewerCanSeeSalary(req);
    const employees = await Promise.all(
      rows.map(async (row) => redactSalary(await withListUrls(row), canSeeSalary))
    );
    return res.json({
      users: employees,
      // Reserved for future soft-deletable resources (documents, tasks, etc.)
      documents: [],
      tasks: [],
      team_assignments: [],
    });
  } catch (err) {
    console.error('listDeactivated error:', err);
    return res.status(500).json({ message: 'Server error fetching deactivated records.' });
  }
}

/**
 * GET /api/admin/locked-accounts
 * Failed-login lockouts and admin-blocked accounts.
 */
async function listLockedAccounts(req, res) {
  try {
    await ensureBlockedColumn();
    const { rows } = await pool.query(
      `
        SELECT
          id, employee_id, username, name, email, role, status,
          failed_login_attempts, locked_at, blocked_at, blocked_reason,
          is_active, created_at
        FROM users
        WHERE locked_at IS NOT NULL OR blocked_at IS NOT NULL
        ORDER BY
          COALESCE(blocked_at, locked_at) DESC NULLS LAST,
          id DESC
      `
    );
    return res.json(rows);
  } catch (err) {
    console.error('listLockedAccounts error:', err);
    return res.status(500).json({ message: 'Server error fetching locked accounts.' });
  }
}

/**
 * PUT /api/admin/accounts/:userId/unlock
 * Clears lockout counters (requires accounts:unlock).
 */
async function unlockAccount(req, res) {
  try {
    const { userId } = req.params;
    const { rows } = await pool.query(
      `
        UPDATE users
        SET failed_login_attempts = 0, locked_at = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, employee_id, username, name, email, role, status,
                  failed_login_attempts, locked_at, blocked_at, is_active
      `,
      [userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'account_unlocked',
        targetTable: 'users',
        targetId: rows[0].id,
        reason: `Unlocked account ${rows[0].username}`,
      });
    } catch (auditErr) {
      console.warn('account_unlocked audit failed:', auditErr.message || auditErr);
    }

    return res.json({
      message: 'Account unlocked.',
      user: rows[0],
    });
  } catch (err) {
    console.error('unlockAccount error:', err);
    return res.status(500).json({ message: 'Server error unlocking account.' });
  }
}

function normalizeRoleName(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

/**
 * PUT /api/admin/accounts/:userId/block
 * Immediately ends the user's session; they cannot sign in again until unblocked.
 */
async function blockAccount(req, res) {
  try {
    await ensureBlockedColumn();
    const { userId } = req.params;
    const reason = String(req.body?.reason || '').trim() || null;

    if (String(userId) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot block your own account.' });
    }

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, username, name, role, branch, department, is_active, blocked_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    const target = existingRows[0];
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (normalizeRoleName(target.role) === 'ceo') {
      return res.status(403).json({ message: 'CEO accounts cannot be blocked.' });
    }

    const scopes = await resolvePermissionScopes(req);
    const editScope = scopes['employees:edit']
      ? scopeForPermission(scopes, 'employees:edit')
      : scopeForPermission(scopes, 'employees:view');
    if (!employeeMatchesScope(target, editScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned scope.',
      });
    }

    if (target.blocked_at) {
      return res.json({
        message: 'Account is already blocked.',
        user: target,
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET blocked_at = NOW(), blocked_reason = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, employee_id, username, name, email, role, status,
                  failed_login_attempts, locked_at, blocked_at, blocked_reason, is_active
      `,
      [userId, reason]
    );

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'account_blocked',
        targetTable: 'users',
        targetId: rows[0].id,
        reason: reason || `Blocked account ${rows[0].username}`,
      });
    } catch (auditErr) {
      console.warn('account_blocked audit failed:', auditErr.message || auditErr);
    }

    return res.json({
      message: 'Account blocked. They are signed out and cannot sign in.',
      user: rows[0],
    });
  } catch (err) {
    console.error('blockAccount error:', err);
    return res.status(500).json({ message: 'Server error blocking account.' });
  }
}

/**
 * PUT /api/admin/accounts/:userId/unblock
 * Clears an admin block (does not clear failed-login lockout).
 */
async function unblockAccount(req, res) {
  try {
    await ensureBlockedColumn();
    const { userId } = req.params;

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, username, role, branch, department, is_active, blocked_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    const target = existingRows[0];
    if (!target || target.is_active === false) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const scopes = await resolvePermissionScopes(req);
    const editScope = scopes['employees:edit']
      ? scopeForPermission(scopes, 'employees:edit')
      : scopeForPermission(scopes, 'employees:view');
    if (!employeeMatchesScope(target, editScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned scope.',
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET blocked_at = NULL, blocked_reason = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, employee_id, username, name, email, role, status,
                  failed_login_attempts, locked_at, blocked_at, blocked_reason, is_active
      `,
      [userId]
    );

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'account_unblocked',
        targetTable: 'users',
        targetId: rows[0].id,
        reason: `Unblocked account ${rows[0].username}`,
      });
    } catch (auditErr) {
      console.warn('account_unblocked audit failed:', auditErr.message || auditErr);
    }

    return res.json({
      message: 'Account unblocked. They can sign in again.',
      user: rows[0],
    });
  } catch (err) {
    console.error('unblockAccount error:', err);
    return res.status(500).json({ message: 'Server error unblocking account.' });
  }
}


/**
 * POST /api/admin/employees/:id/profile-alert
 * Notify the employee to complete portal fields they fill themselves.
 */
async function sendProfileAlert(req, res) {
  try {
    await ensureProfileAlertColumns();
    await ensureEmploymentTypeColumn();
    const { id } = req.params;

    const { rows: existingRows } = await pool.query(
      `
        SELECT ${DETAIL_COLUMNS}
        FROM users
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `,
      [id]
    );
    const target = existingRows[0];
    if (!target) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const scopes = await resolvePermissionScopes(req);
    const viewScope = scopeForPermission(scopes, 'employees:view');
    if (!employeeMatchesScope(target, viewScope)) {
      return res.status(403).json({
        message: 'This employee is outside your assigned scope.',
      });
    }

    const missing = missingEmployeePortalFields(target);
    if (!missing.length) {
      return res.status(400).json({
        message: 'This employee has already filled their portal fields.',
      });
    }

    const cooldown = profileAlertCooldown(target);
    if (cooldown.active) {
      return res.status(429).json({
        message: `Alert already sent. You can send another after ${cooldown.remainingLabel}.`,
        retryAfterMs: cooldown.remainingMs,
        retryAt: cooldown.retryAt,
        code: 'PROFILE_ALERT_COOLDOWN',
      });
    }

    const labels = missing.map((f) => f.label);
    const fieldList = formatFieldList(missing);
    const firstName = String(target.name || target.username || 'there').split(' ')[0];
    const subject = 'Please complete your portal profile';
    const messageBody =
      `Hi ${firstName},\n\n` +
      'HR asked you to complete the following fields in your portal profile. ' +
      'These are fields you fill yourself (not assigned by admin):\n\n' +
      labels.map((l) => `• ${l}`).join('\n') +
      '\n\nOpen My Account → Profile and save the missing details.\n\n' +
      '— Textured Lab Portal';

    const sender = {
      id: req.user.id,
      name: req.user.name,
      username: req.user.username,
    };

    const result = await deliverOneMessage({
      sender,
      recipient: target,
      subject,
      messageBody,
      deliveryMethod: 'both',
    });

    await pool.query(
      `
        UPDATE users
        SET profile_alert_at = NOW(),
            profile_alert_sent_at = NOW(),
            profile_alert_fields = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, JSON.stringify(labels)]
    );

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'profile_alert_sent',
        targetTable: 'users',
        targetId: target.id,
        reason: `Asked ${target.username || target.name} to complete: ${fieldList}`,
      });
    } catch (auditErr) {
      console.warn('profile_alert_sent audit failed:', auditErr.message || auditErr);
    }

    return res.json({
      message: 'Alert sent. They will get a portal message, email, and a banner on next login. Next alert is available after 24 hours.',
      missingFields: labels,
      emailSent: Boolean(result?.emailSent),
      emailError: result?.emailError || null,
      profileAlertSentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('sendProfileAlert error:', err);
    return res.status(500).json({ message: 'Server error sending profile alert.' });
  }
}

module.exports = {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  restoreEmployee,
  purgeEmployee,
  listDeactivated,
  listLockedAccounts,
  unlockAccount,
  blockAccount,
  unblockAccount,
  sendProfileAlert,
};
