const pool = require('../config/db');
const { BRANCH_OPTIONS } = require('../constants/branches');
const { ensureOnsiteAttendanceSchema } = require('../utils/onsiteAttendanceSchema');
const { isCeoRole } = require('../middleware/permissions');
const { parseOfficeIps, formatOfficeIps, looksLikeOfficeNetworkEntry, normalizeOfficeNetworkEntry } = require('../utils/requestMeta');

const BRANCH_SELECT = `id, name, ip_address, latitude, longitude, radius_meters, created_by, created_at`;
const MAX_OFFICE_IPS = 20;
const DEFAULT_RADIUS_METERS = 150;

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function serializeBranch(row, canEditIp) {
  const ips = parseOfficeIps(row.ip_address);
  const lat = toFiniteNumber(row.latitude);
  const lng = toFiniteNumber(row.longitude);
  return {
    id: row.id,
    name: row.name,
    ip_address: canEditIp ? formatOfficeIps(ips) || '' : null,
    ip_addresses: canEditIp ? ips : [],
    ip_configured: canEditIp ? ips.length > 0 : false,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    radius_meters:
      row.radius_meters == null || row.radius_meters === ''
        ? DEFAULT_RADIUS_METERS
        : Number(row.radius_meters),
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

function parseBranchGeo(body, { allowSkip = false } = {}) {
  const src = body || {};
  const hasLat = Object.prototype.hasOwnProperty.call(src, 'latitude');
  const hasLng = Object.prototype.hasOwnProperty.call(src, 'longitude');
  const hasRad = Object.prototype.hasOwnProperty.call(src, 'radius_meters');
  if (allowSkip && !hasLat && !hasLng && !hasRad) {
    return { skip: true };
  }

  const latRaw = src.latitude;
  const lngRaw = src.longitude;
  const radRaw = src.radius_meters;
  const latEmpty = latRaw == null || latRaw === '';
  const lngEmpty = lngRaw == null || lngRaw === '';

  if (latEmpty !== lngEmpty) {
    return { error: 'Latitude and longitude must both be set, or both left empty.' };
  }

  let latitude = null;
  let longitude = null;
  if (!latEmpty) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { error: 'Latitude must be a number between -90 and 90.' };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { error: 'Longitude must be a number between -180 and 180.' };
    }
    latitude = lat;
    longitude = lng;
  }

  let radius_meters = DEFAULT_RADIUS_METERS;
  if (radRaw != null && radRaw !== '') {
    const rad = Number(radRaw);
    if (!Number.isFinite(rad) || rad < 1 || Math.round(rad) !== rad) {
      return { error: 'Radius must be a whole number of meters (1 or more).' };
    }
    radius_meters = Math.round(rad);
  }

  return { latitude, longitude, radius_meters };
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

function canEditBranchIp(req) {
  return isCeoRole(req.user?.role);
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
      out.push(serializeBranch(row, canEditBranchIp(req)));
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
    const ceo = canEditBranchIp(req);
    const parsed = normalizeOfficeIpsOrError(ceo ? officeIpsFromBody(req.body) ?? '' : '');
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }
    const geo = parseBranchGeo(req.body);
    if (geo.error) {
      return res.status(400).json({ message: geo.error });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO branches (name, created_by, ip_address, latitude, longitude, radius_meters)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING ${BRANCH_SELECT}
      `,
      [name, req.user?.id ?? null, parsed.stored, geo.latitude, geo.longitude, geo.radius_meters]
    );

    return res.status(201).json(serializeBranch(rows[0], ceo));
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

    if (!canEditBranchIp(req)) {
      return res.status(403).json({
        message: 'Only the CEO can view or update office IPs.',
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
    const geo = parseBranchGeo(req.body, { allowSkip: true });
    if (geo.error) {
      return res.status(400).json({ message: geo.error });
    }

    const { rows } = await pool.query(
      geo.skip
        ? `
        UPDATE branches
        SET ip_address = $2
        WHERE id = $1
        RETURNING ${BRANCH_SELECT}
      `
        : `
        UPDATE branches
        SET ip_address = $2,
            latitude = $3,
            longitude = $4,
            radius_meters = $5
        WHERE id = $1
        RETURNING ${BRANCH_SELECT}
      `,
      geo.skip
        ? [id, parsed.stored]
        : [id, parsed.stored, geo.latitude, geo.longitude, geo.radius_meters]
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
