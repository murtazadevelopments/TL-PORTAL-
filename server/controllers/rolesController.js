const pool = require('../config/db');
const {
  PERMISSIONS_CATALOG,
  normalizePermissionKeys,
} = require('../constants/permissionsCatalog');
const { findBranchName } = require('./branchesController');
const {
  normalizeScope,
  describeScope,
  isScopedPermissionKey,
  BRANCH_OPTIONS,
} = require('../utils/employeeScope');

const ALLOWED_ROLES = new Set(['ceo', 'admin', 'employee', 'team_leader']);

/**
 * Resolve target user by numeric id or employee_id string.
 */
async function findTargetUser({ userId, employeeId }) {
  if (userId != null && String(userId).trim() !== '') {
    const { rows } = await pool.query(
      `
        SELECT id, employee_id, username, name, email, role, branch, is_active
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    return rows[0] || null;
  }

  if (employeeId != null && String(employeeId).trim() !== '') {
    const { rows } = await pool.query(
      `
        SELECT id, employee_id, username, name, email, role, branch, is_active
        FROM users
        WHERE employee_id = $1
        LIMIT 1
      `,
      [String(employeeId).trim()]
    );
    return rows[0] || null;
  }

  return null;
}

/**
 * @param {string[]} permissionKeys
 * @param {Record<string, object>} [scopesByKey]
 */
function buildPermissionRows(permissionKeys, scopesByKey = {}) {
  return permissionKeys.map((key) => ({
    key,
    scope: isScopedPermissionKey(key)
      ? normalizeScope(scopesByKey[key])
      : { type: 'all' },
  }));
}

async function replaceAdminPermissions(client, userId, permissionRows, grantedBy) {
  await client.query(`DELETE FROM admin_permissions WHERE user_id = $1`, [userId]);

  for (const row of permissionRows) {
    await client.query(
      `
        INSERT INTO admin_permissions (user_id, permission_key, granted_by, scope)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [userId, row.key, grantedBy, JSON.stringify(row.scope || { type: 'all' })]
    );
  }
}

async function getPermissionsForUser(userId) {
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
 * POST /api/roles/assign
 * Body: {
 *   user_id | userId | employee_id | employeeId,
 *   role: 'admin' | 'employee' | 'ceo',
 *   permissions?: string[],
 *   branch?: string,
 *   permission_scopes?: { [permission_key]: { type, values? } },
 *   reason?: string
 * }
 */
async function assignRole(req, res) {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const userId = body.user_id ?? body.userId ?? null;
    const employeeId = body.employee_id ?? body.employeeId ?? null;
    const role = String(body.role || '')
      .trim()
      .toLowerCase();
    const reasonRaw = body.reason != null ? String(body.reason).trim() : '';
    const scopesByKey = body.permission_scopes || body.permissionScopes || {};

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({
        message: "role must be one of: 'ceo', 'admin', 'employee', 'team_leader'.",
      });
    }

    if (userId == null && (employeeId == null || String(employeeId).trim() === '')) {
      return res.status(400).json({
        message: 'user_id or employee_id is required.',
      });
    }

    const target = await findTargetUser({ userId, employeeId });
    if (!target) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (target.is_active === false) {
      return res.status(400).json({ message: 'Cannot assign a role to a deactivated user.' });
    }

    if (String(target.id) === String(req.user.id) && role !== 'ceo') {
      return res.status(400).json({
        message: 'You cannot demote your own CEO account.',
      });
    }

    if (
      target.role === 'ceo' &&
      String(target.id) !== String(req.user.id) &&
      role !== 'ceo'
    ) {
      return res.status(403).json({
        message: 'You cannot demote or change another CEO account.',
      });
    }

    let permissionKeys = [];
    let permissionRows = [];
    if (role === 'admin') {
      permissionKeys = normalizePermissionKeys(body.permissions);
      if (permissionKeys.length === 0) {
        return res.status(400).json({
          message: 'Select at least one permission scope when assigning the admin role.',
        });
      }

      for (const key of permissionKeys) {
        if (!isScopedPermissionKey(key)) continue;
        const scope = normalizeScope(scopesByKey[key]);
        if (scope.type !== 'all' && (!scope.values || !scope.values.length)) {
          return res.status(400).json({
            message: `Select at least one ${scope.type || 'value'} for ${key}, or choose All employees.`,
          });
        }
      }

      permissionRows = buildPermissionRows(permissionKeys, scopesByKey);
    }

    let nextBranch = target.branch || null;
    if (role === 'admin') {
      const parsed = await findBranchName(body.branch);
      if (!parsed) {
        return res.status(400).json({
          message: 'Select a branch when assigning the admin role.',
        });
      }
      nextBranch = parsed;
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `
        UPDATE users
        SET role = $1, branch = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, employee_id, username, name, email, role, branch
      `,
      [role, nextBranch, target.id]
    );

    const updated = rows[0];
    await replaceAdminPermissions(client, updated.id, permissionRows, req.user.id);

    const scopeParts = permissionRows
      .filter((r) => isScopedPermissionKey(r.key))
      .map((r) => `${r.key} (${describeScope(r.scope)})`);
    const auditReason =
      reasonRaw ||
      `Assigned role '${role}'` +
        (permissionKeys.length ? ` with [${permissionKeys.join(', ')}]` : '') +
        (role === 'admin' && nextBranch ? ` branch=${nextBranch}` : '') +
        (scopeParts.length ? `; scopes: ${scopeParts.join('; ')}` : '');

    await client.query(
      `
        INSERT INTO audit_log (
          actor_id, actor_username, action, target_table, target_id, reason
        )
        VALUES ($1, $2, 'role_assigned', 'users', $3, $4)
      `,
      [req.user.id, req.user.username || null, String(updated.id), auditReason]
    );

    await client.query('COMMIT');

    const scopesOut = {};
    for (const row of permissionRows) {
      scopesOut[row.key] = row.scope;
    }

    return res.json({
      message: `Role assigned successfully to ${updated.name || updated.username}.`,
      user: {
        ...updated,
        permissions: permissionKeys,
        scopes: scopesOut,
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('assignRole error:', err);
    return res.status(500).json({ message: 'Server error assigning role.' });
  } finally {
    client.release();
  }
}

/**
 * GET /api/admin/permissions-catalog
 */
function getPermissionsCatalog(req, res) {
  return res.json({
    permissions: PERMISSIONS_CATALOG,
    branch_options: BRANCH_OPTIONS,
  });
}

/**
 * GET /api/admin/employees-list — lightweight picker for CEO role assignment
 */
async function listEmployeesForRoleAssign(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, employee_id, name, role, department, designation, branch
        FROM users
        WHERE is_active = true
        ORDER BY name ASC NULLS LAST, id ASC
      `
    );
    return res.json({ employees: rows });
  } catch (err) {
    console.error('listEmployeesForRoleAssign error:', err);
    return res.status(500).json({ message: 'Server error fetching employees list.' });
  }
}

/**
 * GET /api/admin/role-holders — current admin/ceo accounts + permission keys + scopes
 */
async function listRoleHolders(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.employee_id,
          u.name,
          u.username,
          u.email,
          u.role,
          u.department,
          u.designation,
          u.branch,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'key', ap.permission_key,
                  'scope', COALESCE(ap.scope, '{"type":"all"}'::jsonb)
                )
                ORDER BY ap.permission_key
              )
              FROM admin_permissions ap
              WHERE ap.user_id = u.id
            ),
            '[]'::jsonb
          ) AS permission_rows
        FROM users u
        WHERE u.is_active = true
          AND u.role IN ('admin', 'ceo')
        ORDER BY
          CASE u.role WHEN 'ceo' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
          u.name ASC NULLS LAST,
          u.id ASC
      `
    );

    return res.json({
      holders: rows.map((r) => {
        const permissionRows = Array.isArray(r.permission_rows) ? r.permission_rows : [];
        const permissions = permissionRows.map((p) => p.key);
        const scopes = {};
        for (const p of permissionRows) {
          scopes[p.key] = normalizeScope(p.scope);
        }
        return {
          id: r.id,
          employee_id: r.employee_id,
          name: r.name,
          username: r.username,
          email: r.email,
          role: r.role,
          department: r.department,
          designation: r.designation,
          permissions,
          scopes,
        };
      }),
    });
  } catch (err) {
    console.error('listRoleHolders error:', err);
    return res.status(500).json({ message: 'Server error fetching role holders.' });
  }
}

const HR_FOLLOWUP_KEY = 'hr:followup';
const HR_SUPPORT_KEYS = ['employees:view', 'employees:edit', 'hr:add_employee'];

async function grantPermission(client, userId, key, grantedBy) {
  await client.query(
    `
      INSERT INTO admin_permissions (user_id, permission_key, granted_by, scope)
      VALUES ($1, $2, $3, '{"type":"all"}'::jsonb)
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `,
    [userId, key, grantedBy]
  );
}

async function revokePermission(client, userId, key) {
  await client.query(
    `DELETE FROM admin_permissions WHERE user_id = $1 AND permission_key = $2`,
    [userId, key]
  );
}

/**
 * GET /api/admin/hr-people
 * Active staff plus whether the CEO named them as HR.
 */
async function listHrPeople(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.employee_id,
          u.name,
          u.role,
          u.department,
          u.designation,
          u.branch,
          EXISTS (
            SELECT 1
            FROM admin_permissions ap
            WHERE ap.user_id = u.id
              AND ap.permission_key = $1
          ) AS is_hr
        FROM users u
        WHERE u.is_active = true
          AND LOWER(COALESCE(u.role, '')) <> 'ceo'
        ORDER BY u.name ASC NULLS LAST, u.id ASC
      `,
      [HR_FOLLOWUP_KEY]
    );
    return res.json({
      people: rows.map((r) => ({
        ...r,
        is_hr: Boolean(r.is_hr),
      })),
    });
  } catch (err) {
    console.error('listHrPeople error:', err);
    return res.status(500).json({ message: 'Server error loading HR people.' });
  }
}

/**
 * PUT /api/admin/hr-people
 * Body: { user_ids: number[] } — names the CEO selected as HR.
 */
async function saveHrPeople(req, res) {
  const client = await pool.connect();
  try {
    const requested = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
    const ids = [...new Set(requested.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

    const { rows: staff } = await pool.query(
      `
        SELECT id, role, name
        FROM users
        WHERE is_active = true
          AND LOWER(COALESCE(role, '')) <> 'ceo'
      `
    );
    const allowed = new Set(staff.map((r) => Number(r.id)));
    const selected = ids.filter((id) => allowed.has(id));

    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `
        SELECT user_id
        FROM admin_permissions
        WHERE permission_key = $1
      `,
      [HR_FOLLOWUP_KEY]
    );
    const current = new Set(currentRows.map((r) => Number(r.user_id)));
    const next = new Set(selected);

    for (const id of next) {
      const person = staff.find((r) => Number(r.id) === id);
      if (!person) continue;
      if (String(person.role || '').toLowerCase() !== 'admin') {
        await client.query(`UPDATE users SET role = 'admin', updated_at = NOW() WHERE id = $1`, [id]);
      }
      await grantPermission(client, id, HR_FOLLOWUP_KEY, req.user.id);
      for (const key of HR_SUPPORT_KEYS) {
        await grantPermission(client, id, key, req.user.id);
      }
    }

    for (const id of current) {
      if (!next.has(id)) {
        await revokePermission(client, id, HR_FOLLOWUP_KEY);
      }
    }

    await client.query('COMMIT');

    const { rows: assigned } = await pool.query(
      `
        SELECT u.id, u.employee_id, u.name
        FROM users u
        INNER JOIN admin_permissions ap ON ap.user_id = u.id AND ap.permission_key = $1
        WHERE u.is_active = true
        ORDER BY u.name ASC NULLS LAST
      `,
      [HR_FOLLOWUP_KEY]
    );

    return res.json({
      message:
        assigned.length === 0
          ? 'No HR people selected.'
          : `HR assigned to ${assigned.length} ${assigned.length === 1 ? 'person' : 'people'}.`,
      people: assigned,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('saveHrPeople error:', err);
    return res.status(500).json({ message: 'Server error saving HR people.' });
  } finally {
    client.release();
  }
}

module.exports = {
  assignRole,
  getPermissionsCatalog,
  listEmployeesForRoleAssign,
  listRoleHolders,
  getPermissionsForUser,
  listHrPeople,
  saveHrPeople,
};
