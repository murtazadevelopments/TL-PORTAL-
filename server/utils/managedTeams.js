const pool = require('../config/db');

/**
 * Official team / department names from the managed `teams` table.
 * Portal dropdowns should use this list — not free-text users.department values.
 */
async function listManagedTeamNames() {
  try {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT ON (LOWER(TRIM(name)))
          TRIM(name) AS name
        FROM teams
        WHERE NULLIF(TRIM(name), '') IS NOT NULL
        ORDER BY LOWER(TRIM(name)) ASC, id ASC
      `
    );
    return rows.map((row) => row.name).filter(Boolean);
  } catch (err) {
    console.warn('listManagedTeamNames error:', err.message || err);
    return [];
  }
}

/**
 * Team names for dropdowns, optionally limited to an admin's assigned team scope.
 */
async function listTeamNamesForScope(scope) {
  const managed = await listManagedTeamNames();
  const type = String(scope?.type || 'all').toLowerCase();
  if (type !== 'team') return managed;
  const allowed = new Set(
    (Array.isArray(scope.values) ? scope.values : [])
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowed.size) return [];
  return managed.filter((name) => allowed.has(String(name).toLowerCase()));
}

module.exports = {
  listManagedTeamNames,
  listTeamNamesForScope,
};
