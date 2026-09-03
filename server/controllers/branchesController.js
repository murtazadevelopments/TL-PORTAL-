const pool = require('../config/db');
const { BRANCH_OPTIONS } = require('../constants/branches');
const { ensureOnsiteAttendanceSchema } = require('../utils/onsiteAttendanceSchema');
const { loadAdminPermissionAccess, isCeoRole } = require('../middleware/permissions');
const { employeeMatchesScope, isAllScope } = require('../utils/employeeScope');
const { parseOfficeIps, formatOfficeIps, looksLikeOfficeNetworkEntry, normalizeOfficeNetworkEntry } = require('../utils/requestMeta');

const BRANCH_SELECT = `id, name, ip_address, created_by, created_at`;
const MAX_OFFICE_IPS = 20;

function serializeBranch(row, canEditIp) {
  const ips = parseOfficeIps(row.ip_address);
  return {
    id: row.id,
    name: row.name,
    ip_address: canEditIp ? formatOfficeIps(ips) || '' : null,
    ip_addresses: canEditIp ? ips : [],
    ip_configured: ips.length > 0,
    created_by: row.created_by,
    created_at: row.created_at,
    can_edit_ip: Boolean(canEditIp),
  };
}

function officeIpsFromBody(body) {
  if (Array.isArray(body?.ip_addresses)) return body.ip_addresses;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'ip_address')) {
    return body.ip_address;
  }
  return undefined;
}

function normalizeOfficeIpsOrError(raw) {
  if (raw == null || raw === '') return { stored: null, ips: [] };
  const tokens = Array.isArray(raw)
    ? raw.map((v) => String(v || '').trim()).filter(Boolean)
    : String(raw).split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
  const ips = [];
  const seen = new Set();
  for (const token of tokens) {
    const ip = normalizeOfficeNetworkEntry(token);
    if (!ip || !looksLikeOfficeNetworkEntry(token)) {
      return { error: `“${token}” is not a valid IPv4/IPv6 address or CIDR prefix (for example 203.0.113.10 or 2407:aa80:14:3c96::/64).` };
    }
    const key = ip.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ips.push(ip);
  }
  if (ips.length > MAX_OFFICE_IPS) {
    return { error: `A branch can have at most ${MAX_OFFICE_IPS} office IPs.` };
  }
  return { stored: formatOfficeIps(ips), ips };
}

async function canEditBranchIp(req, branchName) {
  if (isCeoRole(req.user?.role)) return true;
  if (Array.isArray(req.user?.permissions) && req.user.permissions.includes('*')) return true;
  const access = await loadAdminPermissionAccess(req.user.id);
  const keys = access.permissions || [];
  if (keys.includes('branches:create') || keys.includes('hr:add_employee')) return true;
  if (!keys.includes('attendance:edit')) return false;
  const scope = access.scopes['attendance:edit'];
  if (isAllScope(scope)) return true;
  return employeeMatchesScope({ branch: branchName }, scope);
}

/**
 * GET /api/admin/branches
 */
async function listBranches(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const { rows } = await pool.query(
      `
        SELECT ${BRANCH_SELECT}
        FROM branches
        ORDER BY name ASC
      `
    );
    const out = [];
    for (const row of rows) {
      out.push(serializeBranch(row, await canEditBranchIp(req, row.name)));
    }
    return res.json(out);
  } catch (err) {
    console.error('listBranches error:', err);
    return res.status(500).json({ message: 'Server error fetching branches.' });
  }
}

/**
 * POST /api/admin/branches  { name, ip_address? }
 */
async function createBranch(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Branch name is required.' });
    }
    if (name.length > 120) {
      return res.status(400).json({ message: 'Branch name must be 120 characters or fewer.' });
    }
    const parsed = normalizeOfficeIpsOrError(officeIpsFromBody(req.body) ?? '');
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO branches (name, created_by, ip_address)
        VALUES ($1, $2, $3)
        RETURNING ${BRANCH_SELECT}
      `,
      [name, req.user?.id ?? null, parsed.stored]
    );

    return res.status(201).json(serializeBranch(rows[0], true));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A branch with that name already exists.' });
    }
    console.error('createBranch error:', err);
    return res.status(500).json({ message: 'Server error creating branch.' });
  }
}

/**
 * PATCH /api/admin/branches/:id  { ip_address }
 */
async function updateBranch(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid branch id.' });
    }

    const { rows: existing } = await pool.query(
      `SELECT ${BRANCH_SELECT} FROM branches WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!existing[0]) {
      return res.status(404).json({ message: 'Branch not found.' });
    }

    if (!(await canEditBranchIp(req, existing[0].name))) {
      return res.status(403).json({
        message: 'You can only update the office IP for a branch in your attendance edit scope.',
      });
    }

    const raw = officeIpsFromBody(req.body);
    if (raw === undefined) {
      return res.status(400).json({ message: 'ip_addresses is required.' });
    }

    const parsed = normalizeOfficeIpsOrError(raw);
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const { rows } = await pool.query(
      `
        UPDATE branches
        SET ip_address = $2
        WHERE id = $1
        RETURNING ${BRANCH_SELECT}
      `,
      [id, parsed.stored]
    );

    return res.json(serializeBranch(rows[0], true));
  } catch (err) {
    console.error('updateBranch error:', err);
    return res.status(500).json({ message: 'Server error updating branch.' });
  }
}

/**
 * DELETE /api/admin/branches/:id
 * Employee/admin branch strings are left as-is.
 */
async function deleteBranch(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid branch id.' });
    }

    const { rows } = await pool.query(
      `
        DELETE FROM branches
        WHERE id = $1
        RETURNING id, name
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Branch not found.' });
    }

    return res.json({
      message: `Branch “${rows[0].name}” deleted.`,
      branch: rows[0],
    });
  } catch (err) {
    console.error('deleteBranch error:', err);
    return res.status(500).json({ message: 'Server error deleting branch.' });
  }
}

/** Match a submitted branch name against the catalog (case-insensitive). */
async function findBranchName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const { rows } = await pool.query(
      `
        SELECT name
        FROM branches
        WHERE lower(name) = lower($1)
        LIMIT 1
      `,
      [trimmed]
    );
    if (rows[0]?.name) return rows[0].name;
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return BRANCH_OPTIONS.includes(trimmed) ? trimmed : undefined;
}

module.exports = {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  findBranchName,
};
