const pool = require('../config/db');

const ALLOWED_ROLES = new Set(['ceo', 'admin', 'employee']);

/**
 * POST /api/roles/assign
 * Body: { user_id | userId, role }
 * CEO only (via requireRole('ceo') on the route).
 */
async function assignRole(req, res) {
  try {
    const body = req.body || {};
    const userId = body.user_id ?? body.userId;
    const role = String(body.role || '')
      .trim()
      .toLowerCase();

    if (!userId) {
      return res.status(400).json({ message: 'user_id is required.' });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({
        message: "role must be one of: 'ceo', 'admin', 'employee'.",
      });
    }

    if (String(userId) === String(req.user.id) && role !== 'ceo') {
      return res.status(400).json({
        message: 'You cannot demote your own CEO account.',
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET role = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, employee_id, username, name, email, role
      `,
      [role, userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ message: 'Role updated.', user: rows[0] });
  } catch (err) {
    console.error('assignRole error:', err);
    return res.status(500).json({ message: 'Server error assigning role.' });
  }
}

module.exports = { assignRole };
