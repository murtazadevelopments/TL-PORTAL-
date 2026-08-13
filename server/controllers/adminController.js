const pool = require('../config/db');
const { supabase, BUCKETS } = require('../config/supabaseClient');
const { attachReadableUrls, resolveStorageUrl } = require('../utils/storageUrls');
const {
  notifyEmployeeAdminUpdated,
  summarizeChanges,
} = require('../services/notifications');
const { writeAuditLog } = require('../utils/auditLog');

const LIST_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  department, designation, status, branch, shift, salary, date_of_joining,
  education, last_job_status, profile_picture_url, created_at, is_active
`;

const DETAIL_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  education, last_job_status,
  date_of_joining, date_joined, created_at, updated_at, is_active,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name
`;

const ALLOWED_UPDATE_FIELDS = [
  'employee_id',
  'status',
  'department',
  'designation',
  'branch',
  'shift',
  'salary',
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

function storagePathFromUrl(value) {
  if (!value) return null;
  const v = String(value);
  if (v.startsWith('http://') || v.startsWith('https://')) return null;
  return v;
}

async function removeStorageObject(bucket, objectPath) {
  if (!objectPath) return;
  const { error } = await supabase.storage.from(bucket).remove([objectPath]);
  if (error) {
    console.warn(`Storage delete failed (${bucket}/${objectPath}):`, error.message);
  }
}

async function withListUrls(row) {
  if (!row) return null;
  return {
    ...row,
    profile_picture_url: await resolveStorageUrl(row.profile_picture_url, BUCKETS.profile),
  };
}

async function listEmployees(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT ${LIST_COLUMNS}
        FROM users
        WHERE is_active = true
        ORDER BY created_at DESC NULLS LAST, id DESC
      `
    );

    const employees = await Promise.all(rows.map(withListUrls));
    return res.json(employees);
  } catch (err) {
    console.error('listEmployees error:', err);
    return res.status(500).json({ message: 'Server error fetching employees.' });
  }
}

async function getEmployeeById(req, res) {
  try {
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

    const employee = await attachReadableUrls(rows[0]);
    return res.json(employee);
  } catch (err) {
    console.error('getEmployeeById error:', err);
    return res.status(500).json({ message: 'Server error fetching employee.' });
  }
}

async function updateEmployee(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const keys = Object.keys(body);

    if (keys.length === 0) {
      return res.status(400).json({
        message:
          'All fields are required: employee_id, status, department, designation, branch, shift, salary.',
      });
    }

    const rejected = keys.filter((key) => !ALLOWED_UPDATE_FIELDS.includes(key));
    if (rejected.length > 0) {
      return res.status(400).json({
        message: `Field(s) not allowed: ${rejected.join(', ')}. Only employee_id, status, department, designation, branch, shift, and salary can be updated.`,
      });
    }

    const missing = REQUIRED_ADMIN_FIELDS.filter((key) => isEmptyValue(body[key]));
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

    const next = {
      employee_id: String(body.employee_id).trim(),
      status: String(body.status).trim().toLowerCase(),
      department: String(body.department).trim(),
      designation: String(body.designation).trim(),
      branch: String(body.branch).trim(),
      shift: String(body.shift).trim(),
      salary: Number(body.salary),
    };

    if (!['active', 'inactive'].includes(next.status)) {
      return res.status(400).json({ message: 'Status must be "active" or "inactive".' });
    }

    if (Number.isNaN(next.salary)) {
      return res.status(400).json({ message: 'Salary must be a valid number.' });
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
          updated_at = NOW()
        WHERE id = $8 AND is_active = true
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
        id,
      ]
    );

    const employee = await attachReadableUrls(rows[0]);
    const changed = summarizeChanges(before, employee, ALLOWED_UPDATE_FIELDS);
    if (changed.length) {
      await notifyEmployeeAdminUpdated(employee, changed);
    }

    return res.json(employee);
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
 * DELETE /api/admin/employees/:id/purge
 * Hard-delete: permanent removal (CEO only). Body: { reason }
 */
async function purgeEmployee(req, res) {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();

    if (!reason) {
      return res.status(400).json({ message: 'reason is required for permanent purge.' });
    }

    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot purge your own account.' });
    }

    const { rows } = await pool.query(
      `
        SELECT id, role, username, name, cnic_front_url, cnic_back_url, cv_url, profile_picture_url
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
      removeStorageObject(BUCKETS.cnic, storagePathFromUrl(employee.cnic_front_url)),
      removeStorageObject(BUCKETS.cnic, storagePathFromUrl(employee.cnic_back_url)),
      removeStorageObject(BUCKETS.cv, storagePathFromUrl(employee.cv_url)),
      removeStorageObject(BUCKETS.profile, storagePathFromUrl(employee.profile_picture_url)),
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

    const employees = await Promise.all(rows.map(withListUrls));
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

module.exports = {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  purgeEmployee,
  listDeactivated,
};
