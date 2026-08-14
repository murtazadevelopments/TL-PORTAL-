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

/** Admin panel / admin nav — CEO always included. */
export function canAccessAdmin(role) {
  const r = normalizeRole(role);
  return r === 'ceo' || r === 'admin';
}

/** CEO has '*'; admins use keys from /api/users/me.permissions */
export function hasPermission(permissions, key) {
  if (!key) return false;
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes('*')) return true;
  return permissions.includes(key);
}
