const pool = require('../config/db');
const { normalizeScope } = require('./employeeScope');
const { normalizeDesignation } = require('../constants/designations');

const SALES_TEAM_LEAD_TITLES = new Set([
  'team lead',
  'assistant team lead',
  'sales agent',
  'sales executive',
]);

/**
 * People who can have individual sales targets: sales executives/agents and team leaders.
 * Production, HR, admins, artists, etc. are excluded.
 */
function isSalesRosterPerson(user) {
  const role = String(user?.role || '')
    .trim()
    .toLowerCase();
  if (role === 'ceo') return false;
  if (role === 'team_leader') return true;
  const designation = normalizeDesignation(user?.designation);
  if (!designation) return false;
  if (/\bsales\b/.test(designation)) return true;
  return SALES_TEAM_LEAD_TITLES.has(designation);
}

/** SQL AND-clause (alias `u`) matching {@link isSalesRosterPerson}. */
const SALES_ROSTER_SQL = `
  AND (
    LOWER(TRIM(COALESCE(u.role, ''))) = 'team_leader'
    OR COALESCE(u.designation, '') ~* '\\ysales\\y'
    OR LOWER(REGEXP_REPLACE(TRIM(COALESCE(u.designation, '')), '[\\s_-]+', ' ', 'g'))
      IN ('team lead', 'assistant team lead', 'sales agent', 'sales executive')
  )
`;

/**
 * Team names the CEO assigned to sales supervisors (`sales:targets` + specific teams).
 * `all` / branch scopes are ignored so this is never company-wide.
 */
async function listSupervisedSalesTeams() {
  const { rows } = await pool.query(
    `SELECT scope FROM admin_permissions WHERE permission_key = 'sales:targets'`
  );
  const teams = new Set();
  for (const row of rows) {
    const scope = normalizeScope(row.scope);
    if (scope.type !== 'team') continue;
    for (const raw of scope.values || []) {
      const name = String(raw || '').trim();
      if (name) teams.add(name.toLowerCase());
    }
  }
  return teams;
}

function departmentIsSupervisedTeam(department, teamSet) {
  const team = String(department || '').trim().toLowerCase();
  return Boolean(team) && teamSet instanceof Set && teamSet.has(team);
}

async function employeeHasSalesAgentDashboard(user) {
  const role = String(user?.role || '')
    .trim()
    .toLowerCase();
  if (role === 'ceo') return false;
  if (!isSalesRosterPerson(user)) return false;
  const teams = await listSupervisedSalesTeams();
  return departmentIsSupervisedTeam(user?.department, teams);
}

module.exports = {
  listSupervisedSalesTeams,
  departmentIsSupervisedTeam,
  employeeHasSalesAgentDashboard,
  isSalesRosterPerson,
  SALES_ROSTER_SQL,
};
