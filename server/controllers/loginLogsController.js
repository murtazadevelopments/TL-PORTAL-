const pool = require('../config/db');

async function recordLoginLog({
  userId,
  employeeId,
  employeeName,
  username,
  ipAddress,
  location,
  userAgent,
}) {
  const { rows } = await pool.query(
    `
      INSERT INTO login_logs (
        user_id, employee_id, employee_name, username,
        ip_address, location, user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
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
          OR LOWER(COALESCE(username, '')) LIKE $${i})`
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
          logged_in_at
        FROM login_logs
        ${where}
        ORDER BY logged_in_at DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
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
    console.error('listLoginLogs error:', err);
    return res.status(500).json({ message: 'Server error fetching login logs.' });
  }
}

module.exports = {
  recordLoginLog,
  listLoginLogs,
};
