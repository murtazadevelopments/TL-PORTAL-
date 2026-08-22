/** Frontend UI helpers only — backend requireRole / requirePermission is authoritative. */

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

export function isCeo(role) {
  return normalizeRole(role) === 'ceo';
}

export function isAdmin(role) {
  return normalizeRole(role) === 'admin';
}

export function isTeamLeader(role) {
  return normalizeRole(role) === 'team_leader';
}

/** Admin panel / admin nav — CEO always included. */
export function canAccessAdmin(role) {
  const r = normalizeRole(role);
  return r === 'ceo' || r === 'admin';
}

/**
 * Permission check for UI.
 * CEO always has full access (no catalog keys required).
 * Admins use keys from /api/users/me.permissions ('*' = all).
 */
export function hasPermission(permissions, key, role) {
  if (isCeo(role)) return true;
  if (!key) return false;
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes('*')) return true;
  return permissions.includes(key);
}

/** Convenience: CEO bypass + permission key in one call. */
export function can(role, permissions, key) {
  return hasPermission(permissions, key, role);
}
