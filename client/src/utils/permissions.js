/** Frontend UI helpers only — backend requireRole is authoritative. */

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
