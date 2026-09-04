/**
 * Employee access scopes for admin permissions (view / edit).
 * Match team → users.department (team name string).
 * Match branch → users.branch.
 */

const BRANCH_OPTIONS = ['Head Office', 'Unit', 'Branch', 'Amir Chamber'];

const DEFAULT_SCOPE = Object.freeze({ type: 'all' });

function normalizeScope(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SCOPE };

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_SCOPE };
    }
  }

  const type = String(parsed.type || 'all')
    .trim()
    .toLowerCase();

  if (type === 'branch' || type === 'team') {
    const values = [
      ...new Set(
        (Array.isArray(parsed.values) ? parsed.values : [])
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      ),
    ];
    // Empty values stay typed so callers can validate; list filters treat empty as no match
    return { type, values };
  }

  return { ...DEFAULT_SCOPE };
}

function isAllScope(scope) {
  return !scope || normalizeScope(scope).type === 'all';
}

/**
 * @param {{ branch?: string|null, department?: string|null }} employee
 * @param {object} scope
 */
function employeeMatchesScope(employee, scope) {
  const s = normalizeScope(scope);
  if (s.type === 'all') return true;
  if (s.type === 'branch') {
    const branch = String(employee?.branch || '').trim();
    return Boolean(branch) && s.values.includes(branch);
  }
  if (s.type === 'team') {
    const team = String(employee?.department || '').trim();
    return Boolean(team) && s.values.includes(team);
  }
  return true;
}

/**
 * Build AND clause for list queries. Params appended starting at startIndex.
 * @returns {{ sql: string, params: any[] }}
 */
function scopeWhereClause(scope, startIndex = 1) {
  const s = normalizeScope(scope);
  if (s.type === 'all') return { sql: '', params: [] };
  if (s.type === 'branch') {
    return {
      sql: `AND COALESCE(TRIM(branch), '') = ANY($${startIndex}::text[])`,
      params: [s.values],
    };
  }
  if (s.type === 'team') {
    return {
      sql: `AND COALESCE(TRIM(department), '') = ANY($${startIndex}::text[])`,
      params: [s.values],
    };
  }
  return { sql: '', params: [] };
}

/**
 * List filter: onsite rows vs remote rows, each with its own scope.
 */
function employmentAccessWhere({
  canOnsite,
  canRemote,
  onsiteScope,
  remoteScope,
  startIndex = 1,
}) {
  const parts = [];
  const params = [];
  let i = startIndex;
  if (canOnsite) {
    const f = scopeWhereClause(onsiteScope, i);
    parts.push(
      `(COALESCE(NULLIF(TRIM(employment_type), ''), 'onsite') <> 'remote'${f.sql ? ` ${f.sql}` : ''})`
    );
    params.push(...f.params);
    i += f.params.length;
  }
  if (canRemote) {
    const f = scopeWhereClause(remoteScope, i);
    parts.push(
      `(COALESCE(NULLIF(TRIM(employment_type), ''), 'onsite') = 'remote'${f.sql ? ` ${f.sql}` : ''})`
    );
    params.push(...f.params);
    i += f.params.length;
  }
  if (!parts.length) {
    return { sql: 'AND FALSE', params: [] };
  }
  return { sql: `AND (${parts.join(' OR ')})`, params };
}

function describeScope(scope) {
  const s = normalizeScope(scope);
  if (s.type === 'all') return 'all employees';
  if (s.type === 'branch') {
    return s.values.length ? `branch: ${s.values.join(', ')}` : 'branch (none selected)';
  }
  if (s.type === 'team') {
    return s.values.length ? `team: ${s.values.join(', ')}` : 'team (none selected)';
  }
  return 'all employees';
}

const SCOPED_PERMISSION_KEYS = new Set([
  'employees:view',
  'employees:edit',
  'employees:remote',
  'attendance:view',
  'attendance:edit',
]);

function isScopedPermissionKey(key) {
  return SCOPED_PERMISSION_KEYS.has(String(key || ''));
}

module.exports = {
  BRANCH_OPTIONS,
  DEFAULT_SCOPE,
  normalizeScope,
  isAllScope,
  employeeMatchesScope,
  scopeWhereClause,
  employmentAccessWhere,
  describeScope,
  isScopedPermissionKey,
  SCOPED_PERMISSION_KEYS,
};
