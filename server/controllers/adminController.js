const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { attachReadableUrls, withProfileApiUrl } = require('../utils/storageUrls');
const { deleteRelativeFile, saveUserFile } = require('../services/localStorage');
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
const { ensureUsersBranchNotEnumLocked } = require('../utils/usersBranchConstraint');
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
const {
  ensureStaffKindColumn,
  ensureLowerStaffExtraColumns,
  isLowerStaff,
} = require('../utils/staffKind');

const USERNAME_REGEX = /^[a-z0-9._]+$/;
const LAST_JOB_STATUSES = new Set([
  'still_employed',
  'still_employed',
  'resigned',
  'terminated',
  'fresh_graduate',
  'fresh_graduate',
  'other',
]);

const LIST_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  department, designation, status, branch, shift, salary, date_of_joining,
  education, last_job_status, employment_type, staff_kind, profile_picture_url, created_at, is_active,
  failed_login_attempts, locked_at, blocked_at, blocked_reason,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name,
  profile_alert_at, profile_alert_sent_at,
  staff_extra_1_kind, staff_extra_1_label, staff_extra_1_text, staff_extra_1_url,
  staff_extra_2_kind, staff_extra_2_label, staff_extra_2_text, staff_extra_2_url,
  cnic_front_url, cnic_back_url
`;

const DETAIL_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, employment_form_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  education, last_job_status, employment_type, staff_kind, date_of_birth,
  date_of_joining, date_joined, created_at, updated_at, is_active,
  work_start_hour, work_end_hour,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name,
  failed_login_attempts, locked_at, blocked_at, blocked_reason,
  profile_alert_at, profile_alert_sent_at,
  staff_extra_1_kind, staff_extra_1_label, staff_extra_1_text, staff_extra_1_url,
  staff_extra_2_kind, staff_extra_2_label, staff_extra_2_text, staff_extra_2_url
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

function viewerCanSeeSalary(req, row = null) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'ceo') return true;
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  if (perms.includes('employees:salary') || perms.includes('*')) return true;
  return isLowerStaff(row) && perms.includes('hr:add_employee');
}

function canManageLowerStaff(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'ceo') return true;
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  return perms.includes('hr:add_employee') || perms.includes('*');
}

function slugLowerStaffUsername(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 18);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `ls.${base || 'staff'}.${suffix}`;
}

function getMulterFile(req, field) {
  return req.files?.[field]?.[0] || null;
}

function parseExtraKind(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return key === 'text' || key === 'file' ? key : null;
}

function extraSlotFromBody(body, slot) {
  const kind = parseExtraKind(body[`extra_${slot}_kind`]);
  const label = String(body[`extra_${slot}_label`] || '').trim() || null;
  const text = String(body[`extra_${slot}_text`] || '').trim() || null;
  return { kind, label, text };
}

async function saveLowerStaffUploads(user, req) {
  const patch = {};
  const cnicFront = getMulterFile(req, 'cnic_front');
  const cnicBack = getMulterFile(req, 'cnic_back');
  const extra1 = getMulterFile(req, 'extra_1_file');
  const extra2 = getMulterFile(req, 'extra_2_file');
  if (cnicFront) patch.cnic_front_url = await saveUserFile(user, 'cnic_front', cnicFront);
  if (cnicBack) patch.cnic_back_url = await saveUserFile(user, 'cnic_back', cnicBack);
  if (extra1) patch.staff_extra_1_url = await saveUserFile(user, 'staff_extra_1', extra1);
  if (extra2) patch.staff_extra_2_url = await saveUserFile(user, 'staff_extra_2', extra2);
  return patch;
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
    await ensureStaffKindColumn();
    await ensureLowerStaffExtraColumns();
    const scopes = await resolvePermissionScopes(req);
    const viewScope = scopeForPermission(scopes, 'employees:view');
    const filter = scopeWhereClause(viewScope, 1);
    const nextIndex = filter.params.length + 1;
    const canSeeLower = canManageLowerStaff(req);

    const { rows } = await pool.query(
      `
        SELECT ${LIST_COLUMNS}
        FROM users
        WHERE is_active = true
        ${filter.sql}
        AND (COALESCE(staff_kind, 'portal') <> 'lower' OR $${nextIndex}::boolean)
        ORDER BY created_at DESC NULLS LAST, id DESC
      `,
      [...filter.params, canSeeLower]
    );

    const employees = await Promise.all(
      rows.map(async (row) => {
        let withUrls =
          isLowerStaff(row) && canSeeLower
            ? await attachReadableUrls(row)
            : await withListUrls(row);
        if (!isLowerStaff(row)) {
          withUrls = {
            ...withUrls,
            cnic_front_url: null,
            cnic_back_url: null,
            staff_extra_1_url: null,
            staff_extra_2_url: null,
          };
        }
        return redactSalary(withUrls, viewerCanSeeSalary(req, row));
      })
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
    await ensureLowerStaffExtraColumns();
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

    if (isLowerStaff(rows[0]) && !canManageLowerStaff(req)) {
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
      viewerCanSeeSalary(req, rows[0])
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
    if (!canViewDocs && !(isLowerStaff(rows[0]) && canManageLowerStaff(req))) {
      employee.cnic_front_url = null;
      employee.cnic_back_url = null;
      employee.cv_url = null;
      employee.employment_form_url = null;
      employee.documents_redacted = true;
    } else if (!isLowerStaff(rows[0])) {
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

async function createLowerStaff(req, res, body) {
  await ensureLowerStaffExtraColumns();
  await ensureUsersBranchNotEnumLocked();
  if (!canManageLowerStaff(req)) {
    return res.status(403).json({
      message: 'Only HR with Add employees permission can add subordinate staff.',
    });
  }

  const name = String(body.name || '').trim();
  const salary = Number(body.salary);
  const branch = String(body.branch || '').trim();
  if (!name) {
    return res.status(400).json({ message: 'Name is required.' });
  }
  if (!Number.isFinite(salary) || salary <= 0) {
    return res.status(400).json({ message: 'Salary is required and must be greater than 0.' });
  }
  if (!branch) {
    return res.status(400).json({ message: 'Branch is required.' });
  }

  const extra1 = extraSlotFromBody(body, 1);
  const extra2 = extraSlotFromBody(body, 2);
  const username = slugLowerStaffUsername(name);
  const email = `${username}@lowerstaff.local`;
  const hashedPassword = await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10);
  const employeeId = `LS-${Date.now().toString(36).toUpperCase()}`;

  const { rows } = await pool.query(
    `
      INSERT INTO users (
        employee_id, username, name, email, password, contact_number,
        role, status, salary, branch, staff_kind, employment_type,
        staff_extra_1_kind, staff_extra_1_label, staff_extra_1_text,
        staff_extra_2_kind, staff_extra_2_label, staff_extra_2_text,
        is_active, date_joined
      )
      VALUES (
        $1, $2, $3, $4, $5, '',
        'employee', 'active', $6, $7, 'lower', 'onsite',
        $8, $9, $10,
        $11, $12, $13,
        true, NOW()
      )
      RETURNING ${DETAIL_COLUMNS}
    `,
    [
      employeeId,
      username,
      name,
      email,
      hashedPassword,
      salary,
      branch,
      extra1.kind,
      extra1.label,
      extra1.kind === 'text' ? extra1.text : null,
      extra2.kind,
      extra2.label,
      extra2.kind === 'text' ? extra2.text : null,
    ]
  );

  let row = rows[0];
  const filePatch = await saveLowerStaffUploads(row, req);
  if (Object.keys(filePatch).length) {
    const { rows: updated } = await pool.query(
      `
        UPDATE users
        SET
          cnic_front_url = COALESCE($2, cnic_front_url),
          cnic_back_url = COALESCE($3, cnic_back_url),
          staff_extra_1_url = COALESCE($4, staff_extra_1_url),
          staff_extra_2_url = COALESCE($5, staff_extra_2_url),
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${DETAIL_COLUMNS}
      `,
      [
        row.id,
        filePatch.cnic_front_url || null,
        filePatch.cnic_back_url || null,
        filePatch.staff_extra_1_url || null,
        filePatch.staff_extra_2_url || null,
      ]
    );
    row = updated[0];
  }

  const employee = redactSalary(await attachReadableUrls(row), true);
  try {
    await writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: 'lower_staff_created',
      targetTable: 'users',
      targetId: employee.id,
      reason: `HR added subordinate staff ${employee.name}`,
    });
  } catch (auditErr) {
    console.warn('lower_staff_created audit failed:', auditErr.message || auditErr);
  }

  return res.status(201).json(employee);
}

async function updateLowerStaff(req, res) {
  try {
    await ensureStaffKindColumn();
    await ensureLowerStaffExtraColumns();
    await ensureUsersBranchNotEnumLocked();
    if (!canManageLowerStaff(req)) {
      return res.status(403).json({
        message: 'Only HR with Add employees permission can edit subordinate staff.',
      });
    }

    const { id } = req.params;
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const salary = Number(body.salary);
    const branch = String(body.branch || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Name is required.' });
    }
    if (!Number.isFinite(salary) || salary <= 0) {
      return res.status(400).json({ message: 'Salary is required and must be greater than 0.' });
    }
    if (!branch) {
      return res.status(400).json({ message: 'Branch is required.' });
    }

    const extra1 = extraSlotFromBody(body, 1);
    const extra2 = extraSlotFromBody(body, 2);

    const { rows: existingRows } = await pool.query(
      `
        SELECT ${DETAIL_COLUMNS}
        FROM users
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `,
      [id]
    );
    const existing = existingRows[0];
    if (!existing || !isLowerStaff(existing)) {
      return res.status(404).json({ message: 'Subordinate staff record not found.' });
    }

    const filePatch = await saveLowerStaffUploads(existing, req);
    const extra1Url =
      extra1.kind === 'file'
        ? filePatch.staff_extra_1_url || existing.staff_extra_1_url
        : null;
    const extra2Url =
      extra2.kind === 'file'
        ? filePatch.staff_extra_2_url || existing.staff_extra_2_url
        : null;

    const { rows } = await pool.query(
      `
        UPDATE users
        SET
          name = $1,
          salary = $2,
          branch = $3,
          cnic_front_url = COALESCE($4, cnic_front_url),
          cnic_back_url = COALESCE($5, cnic_back_url),
          staff_extra_1_kind = $6,
          staff_extra_1_label = $7,
          staff_extra_1_text = $8,
          staff_extra_1_url = $9,
          staff_extra_2_kind = $10,
          staff_extra_2_label = $11,
          staff_extra_2_text = $12,
          staff_extra_2_url = $13,
          updated_at = NOW()
        WHERE id = $14 AND is_active = true AND COALESCE(staff_kind, 'portal') = 'lower'
        RETURNING ${DETAIL_COLUMNS}
      `,
      [
        name,
        salary,
        branch,
        filePatch.cnic_front_url || null,
        filePatch.cnic_back_url || null,
        extra1.kind,
        extra1.label,
        extra1.kind === 'text' ? extra1.text : null,
        extra1Url,
        extra2.kind,
        extra2.label,
        extra2.kind === 'text' ? extra2.text : null,
        extra2Url,
        id,
      ]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: 'Subordinate staff record not found.' });
    }

    const employee = redactSalary(await attachReadableUrls(rows[0]), true);
    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'lower_staff_updated',
        targetTable: 'users',
        targetId: employee.id,
        reason: `HR updated subordinate staff ${employee.name}`,
      });
    } catch (auditErr) {
      console.warn('lower_staff_updated audit failed:', auditErr.message || auditErr);
    }

    return res.json(employee);
  } catch (err) {
    console.error('updateLowerStaff error:', err);
    return res.status(500).json({ message: 'Server error updating subordinate staff.' });
  }
}

async function deleteLowerStaff(req, res) {
  try {
    await ensureStaffKindColumn();
    if (!canManageLowerStaff(req)) {
      return res.status(403).json({
        message: 'Only HR with Add employees permission can delete subordinate staff.',
      });
    }

    const { id } = req.params;
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }

    const { rows } = await pool.query(
      `
        SELECT id, name, staff_kind
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    const existing = rows[0];
    if (!existing || !isLowerStaff(existing)) {
      return res.status(404).json({ message: 'Subordinate staff record not found.' });
    }

    await pool.query(`DELETE FROM users WHERE id = $1 AND COALESCE(staff_kind, 'portal') = 'lower'`, [
      id,
    ]);

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'lower_staff_deleted',
        targetTable: 'users',
        targetId: existing.id,
        reason: `HR deleted subordinate staff ${existing.name}`,
      });
    } catch (auditErr) {
      console.warn('lower_staff_deleted audit failed:', auditErr.message || auditErr);
    }

    return res.json({ message: 'Subordinate staff record deleted.' });
  } catch (err) {
    console.error('deleteLowerStaff error:', err);
    return res.status(500).json({ message: 'Server error deleting subordinate staff.' });
  }
}

async function createEmployee(req, res) {
  try {
    await ensureEmploymentTypeColumn();
    await ensureAttendanceTables();
    await ensureStaffKindColumn();
    await ensureLowerStaffExtraColumns();
    await ensureUsersBranchNotEnumLocked();
    const body = req.body || {};

    if (String(body.staff_kind || '').trim().toLowerCase() === 'lower') {
      return createLowerStaff(req, res, body);
    }

    const canSeeSalary = viewerCanSeeSalary(req);

    const username = String(body.username || '')
      .trim()
      .toLowerCase();
    const name = String(body.name || '').trim();
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    const contactNumber = String(body.contact_number || '').trim();
    const employeeId = String(body.employee_id || '').trim();
    const status = String(body.status || 'inactive')
      .trim()
      .toLowerCase();
    const department = String(body.department || '').trim();
    const designation = String(body.designation || '').trim();
    const branch = String(body.branch || '').trim();
    const shift = String(body.shift || '').trim();
    const employmentType = normalizeEmploymentType(body.employment_type) || 'onsite';

    if (!username || !name || !email || !password || !contactNumber) {
      return res.status(400).json({
        message: 'Username, name, email, password, and contact number are required.',
      });
    }
    if (username.length < 3 || username.length > 30 || !USERNAME_REGEX.test(username)) {
      return res.status(400).json({
        message:
          'Username must be 3–30 characters and use lowercase letters, numbers, dots, and underscores only.',
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }
    if (!employeeId || !department || !designation || !branch || !shift) {
      return res.status(400).json({
        message: 'Employee ID, department, designation, branch, and shift are required.',
      });
    }
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "active" or "inactive".' });
    }

    let salary = null;
    if (canSeeSalary && body.salary !== undefined && body.salary !== null && String(body.salary).trim() !== '') {
      salary = Number(body.salary);
      if (!Number.isFinite(salary) || salary <= 0) {
        return res.status(400).json({ message: 'Salary must be greater than 0.' });
      }
    }

    const lastJobStatus = body.last_job_status
      ? String(body.last_job_status).trim()
      : null;
    if (lastJobStatus && !LAST_JOB_STATUSES.has(lastJobStatus)) {
      return res.status(400).json({
        message:
          'last_job_status must be one of: still_employed, resigned, terminated, fresh_graduate, other.',
      });
    }

    const hours = normalizeWorkHours(body.work_start_hour, body.work_end_hour);
    const hashedPassword = await bcrypt.hash(password, 10);
    const dateOfJoining =
      body.date_of_joining === undefined ||
      body.date_of_joining === null ||
      String(body.date_of_joining).trim() === ''
        ? null
        : String(body.date_of_joining).trim().slice(0, 10);

    const { rows } = await pool.query(
      `
        INSERT INTO users (
          employee_id, username, name, email, password,
          contact_number, address, cnic_number,
          role, department, designation, status, branch, shift, salary,
          education, last_job_status, employment_type,
          date_of_joining, work_start_hour, work_end_hour,
          bank_name, account_title, iban, account_number,
          emergency_contact_name, emergency_contact_number,
          reference_person,
          is_active, date_joined, staff_kind
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          'employee', $9, $10, $11, $12, $13, $14,
          $15, $16, $17,
          $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26,
          $27,
          true, NOW(), 'portal'
        )
        RETURNING ${DETAIL_COLUMNS}
      `,
      [
        employeeId,
        username,
        name,
        email,
        hashedPassword,
        contactNumber,
        String(body.address || '').trim() || null,
        String(body.cnic_number || '').trim() || null,
        department,
        designation,
        status,
        branch,
        shift,
        salary,
        String(body.education || '').trim() || null,
        lastJobStatus,
        employmentType,
        dateOfJoining,
        hours.start,
        hours.end,
        String(body.bank_name || '').trim() || null,
        String(body.account_title || '').trim() || null,
        String(body.iban || '').trim() || null,
        String(body.account_number || '').trim() || null,
        String(body.emergency_contact_name || '').trim() || null,
        String(body.emergency_contact_number || '').trim() || null,
        String(body.reference_person_name || body.reference_person || '').trim() || null,
      ]
    );

    const employee = redactSalary(await attachReadableUrls(rows[0]), canSeeSalary);
    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'employee_created',
        targetTable: 'users',
        targetId: employee.id,
        reason: `HR created employee ${employee.username} (${employee.employee_id})`,
      });
    } catch (auditErr) {
      console.warn('employee_created audit failed:', auditErr.message || auditErr);
    }

    return res.status(201).json(employee);
  } catch (err) {
    if (err.code === '23505') {
      const detail = String(err.detail || err.message || '').toLowerCase();
      if (detail.includes('username')) {
        return res.status(409).json({ message: 'This username is already taken.' });
      }
      if (detail.includes('email')) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }
      if (detail.includes('cnic')) {
        return res.status(409).json({ message: 'An account with this CNIC number already exists.' });
      }
      if (detail.includes('employee_id')) {
        return res.status(409).json({ message: 'This employee ID is already in use.' });
      }
      return res.status(409).json({ message: 'A user with these details already exists.' });
    }
    console.error('createEmployee error:', err);
    return res.status(500).json({ message: 'Server error creating employee.' });
  }
}

async function updateEmployee(req, res) {
  try {
    await ensureAttendanceTables();
    await ensureUsersBranchNotEnumLocked();
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
    if (err.code === '23514') {
      const constraint = String(err.constraint || err.message || '');
      console.error('updateEmployee check constraint:', constraint, err.detail || err.message);
      if (/branch/i.test(constraint)) {
        return res.status(400).json({
          message:
            'This office is blocked by an old database rule. Save again — newer branches are now allowed.',
        });
      }
      return res.status(400).json({
        message:
          'This save is blocked by a database rule. Check branch, shift, and work location, then try again.',
      });
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

    const employees = await Promise.all(
      rows.map(async (row) =>
        redactSalary(await withListUrls(row), viewerCanSeeSalary(req, row))
      )
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
  createEmployee,
  updateEmployee,
  updateLowerStaff,
  deleteLowerStaff,
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
