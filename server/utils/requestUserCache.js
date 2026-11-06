/**
 * Process-local 30s cache of the user row auth/permission middleware reads,
 * plus the assembled GET /api/users/me payload.
 * Failures and missing users are never stored.
 */
const pool = require('../config/db');
const { managerPermissionKeys } = require('../constants/permissionsCatalog');
const { normalizeScope } = require('./employeeScope');

const TTL_MS = 30_000;

/** @type {Map<number, { auth?: object, me?: object, expiresAt: number }>} */
const store = new Map();

function cacheKey(userId) {
  const key = Number(userId);
  return Number.isFinite(key) ? key : null;
}

function read(userId) {
  const key = cacheKey(userId);
  if (key == null) return null;
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry;
}

function write(userId, patch) {
  const key = cacheKey(userId);
  if (key == null) return;
  const prev = read(userId) || {};
  store.set(key, {
    auth: patch.auth !== undefined ? patch.auth : prev.auth,
    me: patch.me !== undefined ? patch.me : prev.me,
    expiresAt: Date.now() + TTL_MS,
  });
}

function invalidateRequestUser(userId) {
  if (userId == null) {
    store.clear();
    return;
  }
  const key = cacheKey(userId);
  if (key == null) return;
  store.delete(key);
}

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

async function loadAdminAccess(userId) {
  const { rows } = await pool.query(
    `
      SELECT permission_key, scope
      FROM admin_permissions
      WHERE user_id = $1
      ORDER BY permission_key ASC
    `,
    [userId]
  );
  const permissions = [];
  const permissionScopes = {};
  for (const row of rows) {
    permissions.push(row.permission_key);
    permissionScopes[row.permission_key] = normalizeScope(row.scope);
  }
  return { permissions, permissionScopes };
}

/**
 * Fields requireRole / requirePermission / account gate need.
 * One users query, plus admin_permissions only for admins. Cached 30s.
 * @returns {Promise<object|null>}
 */
async function loadAuthUser(userId) {
  const hit = read(userId);
  if (hit?.auth) return hit.auth;

  let rows;
  try {
    ({ rows } = await pool.query(
      `
        SELECT role, is_active, locked_at, blocked_at, blocked_reason,
               resigned_at, terminated_at, status
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    ));
  } catch (err) {
    throw err;
  }

  const row = rows[0];
  if (!row) return null;

  const role = normalizeRole(row.role);
  let permissions = [];
  let permissionScopes = {};
  if (role === 'ceo') {
    permissions = ['*'];
  } else if (role === 'manager') {
    permissions = managerPermissionKeys();
  } else if (role === 'admin') {
    const access = await loadAdminAccess(userId);
    permissions = access.permissions;
    permissionScopes = access.permissionScopes;
  }

  const auth = {
    role,
    is_active: row.is_active,
    locked_at: row.locked_at,
    blocked_at: row.blocked_at,
    blocked_reason: row.blocked_reason,
    resigned_at: row.resigned_at,
    terminated_at: row.terminated_at,
    status: row.status,
    permissions,
    permissionScopes,
  };
  write(userId, { auth });
  return auth;
}

function getCachedMe(userId) {
  const hit = read(userId);
  if (!hit?.me) return null;
  return structuredClone(hit.me);
}

function rememberMe(userId, payload) {
  if (!payload || payload.id == null) return;
  write(userId, { me: structuredClone(payload) });
}

module.exports = {
  TTL_MS,
  invalidateRequestUser,
  loadAuthUser,
  getCachedMe,
  rememberMe,
};
