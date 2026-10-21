const pool = require('../config/db');
const { writeAuditLog } = require('../utils/auditLog');
const { employeeMatchesScope, normalizeScope } = require('../utils/employeeScope');
const { loadAdminPermissionAccess } = require('../middleware/permissions');
const { notifyEmployeeAdminUpdated, queueCeoBranchManagerNotice } = require('../services/notifications');
const { notifyAfterResponse } = require('../utils/notifyAfterResponse');
const { getShiftByName } = require('./shiftsController');
const { ensureOnsiteAttendanceSchema } = require('../utils/onsiteAttendanceSchema');

const KIND_COLUMN = {
  team: 'department',
  shift: 'shift',
  branch: 'branch',
};

const KIND_LABEL = {
  team: 'Team',
  shift: 'Shift',
  branch: 'Branch',
};

let tableReady = false;
let tablePromise = null;

async function ensureTransferTable() {
  if (tableReady) return;
  if (!tablePromise) {
    tablePromise = pool
      .query(
        `
          CREATE TABLE IF NOT EXISTS employee_transfers (
            id              BIGSERIAL PRIMARY KEY,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL CHECK (kind IN ('team', 'shift', 'branch')),
            from_value      TEXT,
            to_value        TEXT NOT NULL,
            actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
            actor_username  TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `
      )
      .then(() =>
        pool.query(`
          CREATE INDEX IF NOT EXISTS employee_transfers_user_idx
            ON employee_transfers (user_id, created_at DESC)
        `)
      )
      .then(() => {
        tableReady = true;
      })
      .catch((err) => {
        tablePromise = null;
        throw err;
      });
  }
  await tablePromise;
}

function directoryAccess(req) {
  const role = String(req.user?.role || '').toLowerCase();
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  const ceo = role === 'ceo' || perms.includes('*');
  return {
    ceo,
    canEditOnsite: ceo || perms.includes('employees:edit') || perms.includes('hr:add_employee'),
    canEditRemote: ceo || perms.includes('employees:remote'),
  };
}

async function resolvePermissionScopes(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'ceo') return {};
  if (req.user?.permissionScopes && typeof req.user.permissionScopes === 'object') {
    return req.user.permissionScopes;
  }
  if (role === 'admin' && req.user?.id) {
    const access = await loadAdminPermissionAccess(req.user.id);
    req.user.permissions = access.permissions;
    req.user.permissionScopes = access.scopes;
    return access.scopes;
  }
  return {};
}

function isRemoteEmployment(value) {
  return String(value || '').trim().toLowerCase() === 'remote';
}

async function assertCanTransfer(req, target) {
  const access = directoryAccess(req);
  const remote = isRemoteEmployment(target.employment_type);
  if (remote && !access.canEditRemote) {
    return { error: 403, message: 'You need Remote employees permission to transfer remote staff.' };
  }
  if (!remote && !access.canEditOnsite) {
    return { error: 403, message: 'You do not have permission to transfer this employee.' };
  }
  const scopes = await resolvePermissionScopes(req);
  const editScope = remote
    ? normalizeScope(scopes['employees:remote'])
    : normalizeScope(scopes['employees:edit'] || scopes['hr:add_employee']);
  if (!employeeMatchesScope(target, editScope)) {
    return { error: 403, message: 'This employee is outside your assigned edit scope.' };
  }
  return { ok: true };
}

async function resolveCatalogValue(kind, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (kind === 'team') {
    const { rows } = await pool.query(
      `
        SELECT name
        FROM teams
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        ORDER BY id ASC
        LIMIT 1
      `,
      [trimmed]
    );
    return rows[0]?.name || null;
  }
  if (kind === 'branch') {
    await ensureOnsiteAttendanceSchema();
    const { rows } = await pool.query(
      `
        SELECT name
        FROM branches
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        ORDER BY id ASC
        LIMIT 1
      `,
      [trimmed]
    );
    return rows[0]?.name || null;
  }
  if (kind === 'shift') {
    const hit = await getShiftByName(trimmed);
    return hit?.name || null;
  }
  return null;
}

async function loadTarget(id) {
  const { rows } = await pool.query(
    `
      SELECT id, name, username, employee_id, department, branch, shift,
             employment_type, status, is_active, staff_kind
      FROM users
      WHERE id = $1 AND is_active = true
      LIMIT 1
    `,
    [id]
  );
  return rows[0] || null;
}

async function transferEmployee(req, res) {
  try {
    await ensureTransferTable();
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ message: 'Invalid employee.' });
    }
    const kind = String(req.body?.kind || req.body?.type || '').trim().toLowerCase();
    if (!KIND_COLUMN[kind]) {
      return res.status(400).json({ message: 'Choose team, shift, or branch transfer.' });
    }
    const nextValue = await resolveCatalogValue(kind, req.body?.value || req.body?.to);
    if (!nextValue) {
      return res.status(400).json({
        message: `Choose a valid ${KIND_LABEL[kind].toLowerCase()} from the list.`,
      });
    }

    const target = await loadTarget(targetId);
    if (!target || String(target.staff_kind || '').toLowerCase() === 'lower') {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    const denied = await assertCanTransfer(req, target);
    if (!denied.ok) return res.status(denied.error).json({ message: denied.message });

    const column = KIND_COLUMN[kind];
    const fromValue = String(target[column] || '').trim();
    if (fromValue.toLowerCase() === nextValue.toLowerCase()) {
      return res.status(400).json({
        message: `${target.name || target.username} is already on ${nextValue}.`,
      });
    }

    await pool.query(`UPDATE users SET ${column} = $1, updated_at = NOW() WHERE id = $2`, [
      nextValue,
      targetId,
    ]);

    const { rows: historyRows } = await pool.query(
      `
        INSERT INTO employee_transfers (
          user_id, kind, from_value, to_value, actor_id, actor_username
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, kind, from_value, to_value, actor_id, actor_username, created_at
      `,
      [
        targetId,
        kind,
        fromValue || null,
        nextValue,
        req.user.id,
        req.user.username || null,
      ]
    );

    const reason = `${KIND_LABEL[kind]} transfer: ${fromValue || 'unset'} → ${nextValue}`;
    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: `employee.transfer_${kind}`,
        targetTable: 'users',
        targetId,
        reason,
      });
    } catch (auditErr) {
      console.warn('employee transfer audit failed:', auditErr.message || auditErr);
    }

    const employee = {
      ...target,
      [column]: nextValue,
    };
    await notifyAfterResponse('employee-transfer', targetId, () =>
      notifyEmployeeAdminUpdated(employee, [reason])
    );
    queueCeoBranchManagerNotice(req, {
      action: `${KIND_LABEL[kind]} transfer`,
      targetName: target.name || target.username,
      targetId,
      details: [reason],
    });

    return res.json({
      message: `${KIND_LABEL[kind]} updated to ${nextValue}.`,
      kind,
      from: fromValue || null,
      to: nextValue,
      employee: {
        id: target.id,
        department: kind === 'team' ? nextValue : target.department,
        shift: kind === 'shift' ? nextValue : target.shift,
        branch: kind === 'branch' ? nextValue : target.branch,
      },
      transfer: historyRows[0],
    });
  } catch (err) {
    console.error('transferEmployee error:', err);
    return res.status(500).json({ message: 'Server error transferring employee.' });
  }
}

async function listEmployeeTransfers(req, res) {
  try {
    await ensureTransferTable();
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ message: 'Invalid employee.' });
    }
    const target = await loadTarget(targetId);
    if (!target || String(target.staff_kind || '').toLowerCase() === 'lower') {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    const { rows } = await pool.query(
      `
        SELECT id, user_id, kind, from_value, to_value, actor_id, actor_username, created_at
        FROM employee_transfers
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 100
      `,
      [targetId]
    );
    return res.json({
      employee: {
        id: target.id,
        name: target.name,
        username: target.username,
      },
      transfers: rows,
    });
  } catch (err) {
    console.error('listEmployeeTransfers error:', err);
    return res.status(500).json({ message: 'Server error loading transfer history.' });
  }
}

module.exports = {
  transferEmployee,
  listEmployeeTransfers,
  ensureTransferTable,
};
