const pool = require('../config/db');
const { writeAuditLog } = require('../utils/auditLog');
const {
  normalizeScope,
  scopeWhereClause,
  employeeMatchesScope,
} = require('../utils/employeeScope');
const { buildExcelXml, buildEmployeePdf } = require('../utils/employeeExportFiles');

const EXPORT_COLUMNS_SQL = `
  employee_id, username, name, email, contact_number, address, cnic_number,
  role, department, designation, status, branch, shift, salary,
  education, last_job_status, employment_type, date_of_birth,
  date_of_joining, work_start_hour, work_end_hour,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name
`;

function isCeo(req) {
  return String(req.user?.role || '').toLowerCase() === 'ceo';
}

function exportScope(req) {
  if (isCeo(req)) return { type: 'all' };
  return normalizeScope(req.user?.permissionScopes?.['employees:export']);
}

function cleanFilter(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'all' ? text : '';
}

function assertFilterAllowed(scope, field, value) {
  if (!value) return null;
  const s = normalizeScope(scope);
  if (s.type === 'all') return null;
  if (field === 'branch' && s.type === 'branch' && !s.values.includes(value)) {
    return 'That branch is outside your export assignment.';
  }
  if (field === 'team' && s.type === 'team' && !s.values.includes(value)) {
    return 'That team is outside your export assignment.';
  }
  return null;
}

function buildQuery(scope, filters, startIndex = 1) {
  const scoped = scopeWhereClause(scope, startIndex);
  const params = [...scoped.params];
  let sql = `
    FROM users
    WHERE is_active = true
      AND COALESCE(staff_kind, 'portal') <> 'lower'
      ${scoped.sql}
  `;
  let i = startIndex + scoped.params.length;
  if (filters.branch) {
    sql += ` AND COALESCE(TRIM(branch), '') = $${i}`;
    params.push(filters.branch);
    i += 1;
  }
  if (filters.team) {
    sql += ` AND COALESCE(TRIM(department), '') = $${i}`;
    params.push(filters.team);
    i += 1;
  }
  if (filters.shift) {
    sql += ` AND COALESCE(TRIM(shift), '') = $${i}`;
    params.push(filters.shift);
  }
  return { sql, params };
}

function describeFilters(filters, scope) {
  const parts = [];
  const s = normalizeScope(scope);
  if (s.type === 'branch') parts.push(`Assigned branch: ${s.values.join(', ')}`);
  if (s.type === 'team') parts.push(`Assigned team: ${s.values.join(', ')}`);
  if (s.type === 'all') parts.push('Assigned: all employees');
  if (filters.branch) parts.push(`Branch ${filters.branch}`);
  if (filters.team) parts.push(`Team ${filters.team}`);
  if (filters.shift) parts.push(`Shift ${filters.shift}`);
  return parts.join(' · ');
}

function readFilters(req) {
  const scope = exportScope(req);
  const filters = {
    branch: cleanFilter(req.query.branch),
    team: cleanFilter(req.query.team || req.query.department),
    shift: cleanFilter(req.query.shift),
  };
  const blocked =
    assertFilterAllowed(scope, 'branch', filters.branch) ||
    assertFilterAllowed(scope, 'team', filters.team);
  return { scope, filters, blocked };
}

async function getExportOptions(req, res) {
  try {
    const scope = exportScope(req);
    const { sql, params } = buildQuery(scope, {});
    const distinct = await pool.query(
      `
        SELECT
          NULLIF(TRIM(branch), '') AS branch,
          NULLIF(TRIM(department), '') AS team,
          NULLIF(TRIM(shift), '') AS shift
        ${sql}
      `,
      params
    );
    const branches = new Set();
    const teams = new Set();
    const shifts = new Set();
    for (const row of distinct.rows) {
      if (row.branch) branches.add(row.branch);
      if (row.team) teams.add(row.team);
      if (row.shift) shifts.add(row.shift);
    }
    if (scope.type === 'branch') scope.values.forEach((v) => branches.add(v));
    if (scope.type === 'team') scope.values.forEach((v) => teams.add(v));
    return res.json({
      scope,
      ceo: isCeo(req),
      branches: [...branches].sort((a, b) => a.localeCompare(b)),
      teams: [...teams].sort((a, b) => a.localeCompare(b)),
      shifts: [...shifts].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    console.error('getExportOptions error:', err);
    return res.status(500).json({ message: 'Server error loading export options.' });
  }
}

async function exportEmployees(req, res) {
  try {
    const { scope, filters, blocked } = readFilters(req);
    if (blocked) {
      return res.status(403).json({ message: blocked });
    }
    const format = String(req.query.format || 'xlsx')
      .trim()
      .toLowerCase();
    if (format !== 'xlsx' && format !== 'excel' && format !== 'pdf') {
      return res.status(400).json({ message: 'format must be xlsx or pdf.' });
    }

    const { sql, params } = buildQuery(scope, filters);
    const { rows } = await pool.query(
      `
        SELECT ${EXPORT_COLUMNS_SQL}
        ${sql}
        ORDER BY branch NULLS LAST, department NULLS LAST, name ASC, employee_id ASC
      `,
      params
    );
    const allowed = rows.filter((row) => employeeMatchesScope(row, scope));
    const stamp = new Date().toISOString().slice(0, 10);
    const filtersLabel = describeFilters(filters, scope);
    const meta = {
      title: 'Textured Lab employee export',
      filters: filtersLabel,
      generatedAt: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
    };

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'employee_data_exported',
        targetTable: 'users',
        targetId: req.user.id,
        reason: `${format} · ${allowed.length} rows · ${filtersLabel}`,
      });
    } catch (auditErr) {
      console.warn('employee_data_exported audit failed:', auditErr.message || auditErr);
    }

    if (format === 'pdf') {
      const buffer = await buildEmployeePdf(allowed, meta);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="TL-employees-${stamp}.pdf"`
      );
      return res.send(buffer);
    }

    const xml = buildExcelXml(allowed, meta);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TL-employees-${stamp}.xls"`
    );
    return res.send(xml);
  } catch (err) {
    console.error('exportEmployees error:', err);
    return res.status(500).json({ message: 'Server error exporting employees.' });
  }
}

module.exports = {
  getExportOptions,
  exportEmployees,
};
