const pool = require('../config/db');
const { attachReadableUrls, resolveStorageUrl, BUCKETS } = require('../utils/storageUrls');

/** Columns returned in the employee list (never includes password). */
const LIST_COLUMNS = `
  id, employee_id, username, first_name, father_name, email, contact_number,
  department, designation, status, branch, shift, salary, date_of_joining,
  profile_picture_url
`;

/** Full profile for admin detail view (never includes password). */
const DETAIL_COLUMNS = `
  id, employee_id, username, first_name, father_name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  date_of_joining, date_joined, created_at, updated_at,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name
`;

/** Only these fields may be updated via PUT /api/admin/employees/:id */
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

async function withListUrls(row) {
  if (!row) return null;
  return {
    ...row,
    profile_picture_url: await resolveStorageUrl(row.profile_picture_url, BUCKETS.profile),
  };
}

/**
 * GET /api/admin/employees
 */
async function listEmployees(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM users ORDER BY created_at DESC NULLS LAST, id DESC`
    );

    const employees = await Promise.all(rows.map(withListUrls));
    return res.json(employees);
  } catch (err) {
    console.error('listEmployees error:', err);
    return res.status(500).json({ message: 'Server error fetching employees.' });
  }
}

/**
 * GET /api/admin/employees/:id
 */
async function getEmployeeById(req, res) {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT ${DETAIL_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
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

/**
 * PUT /api/admin/employees/:id
 * Updates only admin-managed fields. All 7 fields are required on every save.
 */
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
      `SELECT id FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!existingRows[0]) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

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
        WHERE id = $8
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
    return res.json(employee);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Employee ID is already in use.' });
    }
    console.error('updateEmployee error:', err);
    return res.status(500).json({ message: 'Server error updating employee.' });
  }
}

module.exports = {
  listEmployees,
  getEmployeeById,
  updateEmployee,
};
