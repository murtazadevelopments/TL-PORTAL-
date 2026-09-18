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

function dataLimitLabel(filters, scope) {
  if (filters.branch && filters.team) {
    return `Branch: ${filters.branch}; Team: ${filters.team}`;
  }
  if (filters.branch) return `Branch: ${filters.branch}`;
  if (filters.team) return `Team: ${filters.team}`;
  const s = normalizeScope(scope);
  if (s.type === 'branch' && s.values.length) return `Branch: ${s.values.join(', ')}`;
  if (s.type === 'team' && s.values.length) return `Team: ${s.values.join(', ')}`;
  return 'All employees';
}

function formatExportKind(format) {
  const key = String(format || '').toLowerCase();
  if (key === 'pdf') return 'PDF';
  return 'Excel';
}

let exportLogTableReady = false;

async function ensureExportLogTable() {
  if (exportLogTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_export_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT,
      actor_name TEXT,
      actor_username TEXT,
      actor_employee_id TEXT,
      format TEXT NOT NULL,
      data_limit TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS employee_export_logs_created_at_idx
      ON employee_export_logs (created_at DESC);
  `);
  exportLogTableReady = true;
}

async function recordExportLog({ actorId, format, dataLimit, rowCount }) {
  await ensureExportLogTable();
  const { rows: people } = await pool.query(
    `SELECT name, username, employee_id FROM users WHERE id = $1 LIMIT 1`,
    [actorId]
  );
  const person = people[0] || {};
  await pool.query(
    `
      INSERT INTO employee_export_logs (
        actor_id, actor_name, actor_username, actor_employee_id,
        format, data_limit, row_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      actorId || null,
      person.name || null,
      person.username || null,
      person.employee_id || null,
      formatExportKind(format),
      dataLimit,
      Number(rowCount) || 0,
    ]
  );
}

async function listExportLogs(req, res) {
  try {
    await ensureExportLogTable();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const conditions = [];
    const params = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      const i = params.length;
      conditions.push(
        `(LOWER(COALESCE(actor_name, '')) LIKE $${i}
          OR LOWER(COALESCE(actor_username, '')) LIKE $${i}
          OR LOWER(COALESCE(actor_employee_id, '')) LIKE $${i}
          OR LOWER(COALESCE(data_limit, '')) LIKE $${i})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM employee_export_logs ${where}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;
    params.push(limit, offset);
    const { rows } = await pool.query(
      `
        SELECT id, actor_id, actor_name, actor_username, actor_employee_id,
               format, data_limit, row_count, created_at
        FROM employee_export_logs
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    return res.json({
      logs: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('listExportLogs error:', err);
    return res.status(500).json({ message: 'Server error fetching export logs.' });
  }
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
      const limitLabel = [
        dataLimitLabel(filters, scope),
        filters.shift ? `Shift: ${filters.shift}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      await recordExportLog({
        actorId: req.user.id,
        format,
        dataLimit: limitLabel,
        rowCount: allowed.length,
      });
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'employee_data_exported',
        targetTable: 'users',
        targetId: req.user.id,
        reason: `${formatExportKind(format)} · ${allowed.length} rows · ${limitLabel}`,
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
  listExportLogs,
};
