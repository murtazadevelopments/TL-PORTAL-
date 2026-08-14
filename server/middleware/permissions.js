const pool = require('../config/db');

/**
 * Central RBAC middleware.
 *
 * Usage: router.get('/path', authMiddleware, requireRole('admin'), handler)
 *
 * - Loads live role from DB (source of truth after role changes)
 * - CEO always passes (bypass every check, including future routes)
 * - Otherwise role must be in allowedRoles
 */
function requireRole(...allowedRoles) {
  return async function requireRoleMiddleware(req, res, next) {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Forbidden: insufficient permissions' });
      }

      const { rows } = await pool.query(
        'SELECT role, is_active FROM users WHERE id = $1 LIMIT 1',
        [req.user.id]
      );

      const row = rows[0];
      if (!row || row.is_active === false) {
        return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      }

      const role = row.role;
      if (!role) {
        return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      }

      // Keep JWT payload in sync with DB for downstream handlers
      req.user.role = role;

      if (role === 'ceo') {
        return next();
      }

      if (allowedRoles.includes(role)) {
        return next();
      }

      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    } catch (err) {
      console.error('requireRole error:', err);
      return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
  };
}

async function loadAdminPermissions(userId) {
  const { rows } = await pool.query(
    `
      SELECT permission_key
      FROM admin_permissions
      WHERE user_id = $1
      ORDER BY permission_key ASC
    `,
    [userId]
  );
  return rows.map((r) => r.permission_key);
}

/**
 * Granular admin scopes (after requireRole('admin')).
 * CEO always bypasses. Admins must hold EVERY listed key.
 *
 * Usage: requireRole('admin'), requirePermission('employees:view')
 */
function requirePermission(...requiredKeys) {
  const needed = requiredKeys.map((k) => String(k).trim()).filter(Boolean);

  return async function requirePermissionMiddleware(req, res, next) {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Forbidden: insufficient permissions' });
      }

      const role = req.user.role;
      if (role === 'ceo') {
        req.user.permissions = ['*'];
        return next();
      }

      if (role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      }

      const permissions = await loadAdminPermissions(req.user.id);
      req.user.permissions = permissions;

      if (needed.length === 0) {
        return next();
      }

      const missing = needed.filter((key) => !permissions.includes(key));
      if (missing.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: insufficient permissions',
          message: `Missing permission: ${missing.join(', ')}`,
          missing,
        });
      }

      return next();
    } catch (err) {
      console.error('requirePermission error:', err);
      return res.status(500).json({ message: 'Server error verifying permissions.' });
    }
  };
}

module.exports = {
  requireRole,
  requirePermission,
  loadAdminPermissions,
};
