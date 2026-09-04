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

/** Incomplete-employee inbox is only for people the CEO named as HR. */
export function isHrAssignee(user) {
  return Boolean(user?.is_hr);
}

/** CEO-assigned attendance permission (Assign Roles). */
export function hasCeoAssignedAttendance(permissions, role) {
  return (
    hasPermission(permissions, 'attendance:view', role) ||
    hasPermission(permissions, 'attendance:edit', role)
  );
}

/** Remote employees (directory + remote attendance): CEO or this grant. */
export function canManageRemoteEmployees(role, permissions) {
  return hasPermission(permissions, 'employees:remote', role);
}

/** Remote team attendance: CEO or Assign Roles “Remote employees” only. Not HR, not other admins. */
export function canViewRemoteTeamAttendance(role, permissions) {
  if (isCeo(role)) return true;
  const keys = Array.isArray(permissions) ? permissions : [];
  return keys.includes('employees:remote');
}

/** Onsite team attendance: CEO, HR, assigned attendance, or employee directory access. */
export function canViewOnsiteTeamAttendance(role, permissions) {
  if (isCeo(role)) return true;
  if (hasPermission(permissions, 'hr:add_employee', role)) return true;
  if (hasCeoAssignedAttendance(permissions, role)) return true;
  return (
    hasPermission(permissions, 'employees:view', role) ||
    hasPermission(permissions, 'employees:edit', role)
  );
}

export function canViewTeamAttendance(role, permissions) {
  return (
    canViewRemoteTeamAttendance(role, permissions) ||
    canViewOnsiteTeamAttendance(role, permissions)
  );
}
