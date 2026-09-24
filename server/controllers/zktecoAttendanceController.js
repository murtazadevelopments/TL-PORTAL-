const pool = require('../config/db');

async function ensureZktecoTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zkteco_attendance_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      punch_time TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, punch_time)
    )
  `);
}

async function listZktecoAttendance(req, res) {
  try {
    await ensureZktecoTable();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const { rows } = await pool.query(
      `
        SELECT
          l.id,
          l.user_id,
          l.punch_time,
          l.created_at,
          u.name AS employee_name,
          u.employee_id
        FROM zkteco_attendance_logs l
        LEFT JOIN users u
          ON TRIM(COALESCE(u.employee_id, '')) = l.user_id
          OR regexp_replace(TRIM(COALESCE(u.employee_id, '')), '^TXL-?', '', 'i') = l.user_id
          OR u.id::text = l.user_id
        ORDER BY l.punch_time DESC
        LIMIT $1
      `,
      [limit]
    );
    return res.json({ logs: rows });
  } catch (err) {
    console.error('listZktecoAttendance error:', err);
    return res.status(500).json({ message: 'Server error loading biometric punches.' });
  }
}

module.exports = { listZktecoAttendance, ensureZktecoTable };
