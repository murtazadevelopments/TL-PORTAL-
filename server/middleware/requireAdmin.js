const pool = require('../config/db');

/**
 * Requires an authenticated user with role === 'admin' (checked live in DB).
 * Must run after authMiddleware (expects req.user.id).
 */
async function requireAdmin(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const { rows } = await pool.query(
      'SELECT role FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );

    if (!rows[0] || rows[0].role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required.' });
    }

    req.user.role = 'admin';
    return next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ message: 'Server error verifying admin access.' });
  }
}

module.exports = requireAdmin;
