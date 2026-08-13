/**
 * @deprecated Prefer requireRole('admin') from ./permissions
 * Kept so older imports keep working; CEO now allowed via requireRole bypass.
 */
const { requireRole } = require('./permissions');

module.exports = requireRole('admin');
