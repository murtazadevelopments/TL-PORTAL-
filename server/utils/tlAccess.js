/**
 * Shared role helpers for Team Leader Dashboard access.
 */

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

function isCeoRole(role) {
  return normalizeRole(role) === 'ceo';
}

function isTeamLeaderRole(role) {
  return normalizeRole(role) === 'team_leader';
}

/** Designation fallback when role has not been set to team_leader yet. */
function designationLooksLikeTeamLeader(designation) {
  return /team[\s_-]*leader/i.test(String(designation || ''));
}

function hasTeamLeaderDashboardAccess({ role, designation, assigned = false } = {}) {
  if (isCeoRole(role)) return true;
  if (isTeamLeaderRole(role)) return true;
  if (designationLooksLikeTeamLeader(designation)) return true;
  return Boolean(assigned);
}

/** Team Leaders see every category (copy-only); assignees only see assigned ones. */
function canViewAllTlCategories({ role, designation } = {}) {
  return (
    isCeoRole(role) ||
    isTeamLeaderRole(role) ||
    designationLooksLikeTeamLeader(designation)
  );
}

module.exports = {
  normalizeRole,
  isCeoRole,
  isTeamLeaderRole,
  designationLooksLikeTeamLeader,
  hasTeamLeaderDashboardAccess,
  canViewAllTlCategories,
};
