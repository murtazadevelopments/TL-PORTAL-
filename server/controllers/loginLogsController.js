const pool = require('../config/db');
const { describeDevice } = require('../utils/deviceLabel');
const { lookupGeoFromIp, isPrivateOrLocalIp } = require('../utils/requestMeta');

let extraColumnsReady = false;
async function ensureLoginLogColumns() {
  if (extraColumnsReady) return;
  await pool.query(`
    ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS device TEXT;
    ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS area TEXT;
    ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
  `);
  extraColumnsReady = true;
}

async function recordLoginLog({
  userId,
  employeeId,
  employeeName,
  username,
  ipAddress,
  location,
  userAgent,
  device,
  city,
  area,
  country,
  latitude,
  longitude,
}) {
  await ensureLoginLogColumns();
  const { rows } = await pool.query(
    `
      INSERT INTO login_logs (
        user_id, employee_id, employee_name, username,
        ip_address, location, user_agent, device,
        city, area, country, latitude, longitude
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, logged_in_at
    `,
    [
      userId ?? null,
      employeeId ?? null,
      employeeName ?? null,
      username ?? null,
      ipAddress ?? null,
      location ?? null,
      userAgent ?? null,
      device ?? null,
      city ?? null,
      area ?? null,
      country ?? null,
      latitude ?? null,
      longitude ?? null,
    ]
  );
  return rows[0];
}

/**
 * GET list with filters + pagination.
 * Query: page, limit, q, range (24h|7d|30d|custom), from, to
 */
async function listLoginLogs(req, res) {
  try {
    await ensureLoginLogColumns();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const range = String(req.query.range || '7d').trim().toLowerCase();

    const conditions = [];
    const params = [];

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      const i = params.length;
      conditions.push(
        `(LOWER(COALESCE(employee_name, '')) LIKE $${i}
          OR LOWER(COALESCE(employee_id, '')) LIKE $${i}
          OR LOWER(COALESCE(username, '')) LIKE $${i}
          OR LOWER(COALESCE(city, '')) LIKE $${i}
          OR LOWER(COALESCE(area, '')) LIKE $${i}
          OR LOWER(COALESCE(country, '')) LIKE $${i})`
      );
    }

    const now = new Date();
    if (range === 'all' || range === '') {
      // no date filter
    } else if (range === '24h') {
      params.push(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
      conditions.push(`logged_in_at >= $${params.length}`);
    } else if (range === '7d') {
      params.push(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
      conditions.push(`logged_in_at >= $${params.length}`);
    } else if (range === '30d') {
      params.push(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString());
      conditions.push(`logged_in_at >= $${params.length}`);
    } else if (range === 'custom') {
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;
      if (from && !Number.isNaN(from.getTime())) {
        params.push(from.toISOString());
        conditions.push(`logged_in_at >= $${params.length}`);
      }
      if (to && !Number.isNaN(to.getTime())) {
        // inclusive end-of-day if date-only
        const end = new Date(to);
        if (String(req.query.to).length <= 10) {
          end.setHours(23, 59, 59, 999);
        }
        params.push(end.toISOString());
        conditions.push(`logged_in_at <= $${params.length}`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM login_logs ${where}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `
        SELECT
          id,
          user_id,
          employee_id,
          employee_name,
          username,
          ip_address,
          location,
          user_agent,
          device,
          city,
          area,
          country,
          latitude,
          longitude,
          logged_in_at
        FROM login_logs
        ${where}
        ORDER BY logged_in_at DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );

    await fillMissingGeo(rows);

    return res.json({
      logs: rows.map((row) => ({
        ...row,
        device: row.device || describeDevice(row.user_agent),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('listLoginLogs error:', err);
    return res.status(500).json({ message: 'Server error fetching login logs.' });
  }
}

async function fillMissingGeo(rows) {
  const pending = [];
  const seen = new Set();
  for (const row of rows) {
    const ip = row.ip_address;
    if (!ip || isPrivateOrLocalIp(ip) || seen.has(ip)) continue;
    if (row.city || row.country || row.latitude != null) continue;
    seen.add(ip);
    pending.push(ip);
  }

  for (const ip of pending) {
    const geo = await lookupGeoFromIp(ip);
    if (!geo.city && !geo.country && geo.latitude == null) continue;
    await pool.query(
      `
        UPDATE login_logs
        SET
          location = COALESCE($1, location),
          city = COALESCE(city, $2),
          area = COALESCE(area, $3),
          country = COALESCE(country, $4),
          latitude = COALESCE(latitude, $5),
          longitude = COALESCE(longitude, $6)
        WHERE ip_address = $7
          AND city IS NULL
      `,
      [geo.label, geo.city, geo.area, geo.country, geo.latitude, geo.longitude, ip]
    );
    for (const row of rows) {
      if (row.ip_address !== ip) continue;
      if (row.city) continue;
      row.city = geo.city;
      row.area = geo.area;
      row.country = geo.country;
      row.latitude = geo.latitude;
      row.longitude = geo.longitude;
      row.location = geo.label || row.location;
    }
  }
}

module.exports = {
  recordLoginLog,
  listLoginLogs,
};
