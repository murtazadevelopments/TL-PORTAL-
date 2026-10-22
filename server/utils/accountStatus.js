const pool = require('../config/db');

const ACCOUNT_CODES = {
  DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  BLOCKED: 'ACCOUNT_BLOCKED',
  LOCKED: 'ACCOUNT_LOCKED',
  RESIGNED: 'ACCOUNT_RESIGNED',
  TERMINATED: 'ACCOUNT_TERMINATED',
};

const RESIGNED_REASON = 'resigned';
const TERMINATED_REASON = 'terminated';

function isResignedAccount(row) {
  if (!row) return false;
  if (row.resigned_at) return true;
  if (String(row.status || '').trim().toLowerCase() === RESIGNED_REASON) return true;
  return String(row.blocked_reason || '').trim().toLowerCase() === RESIGNED_REASON;
}

function isTerminatedAccount(row) {
  if (!row) return false;
  if (row.terminated_at) return true;
  if (String(row.status || '').trim().toLowerCase() === TERMINATED_REASON) return true;
  return String(row.blocked_reason || '').trim().toLowerCase() === TERMINATED_REASON;
}

function isClosedAccount(row) {
  return isResignedAccount(row) || isTerminatedAccount(row);
}

function blockedLoginMessage(row) {
  if (isTerminatedAccount(row)) {
    return {
      message: 'This account is closed because the employee was terminated.',
      code: ACCOUNT_CODES.TERMINATED,
    };
  }
  if (isResignedAccount(row)) {
    return {
      message: 'This account is closed because the employee resigned.',
      code: ACCOUNT_CODES.RESIGNED,
    };
  }
  return {
    message: 'This account has been blocked. Contact an administrator.',
    code: ACCOUNT_CODES.BLOCKED,
  };
}

let blockedColumnReady = false;

async function ensureBlockedColumn() {
  if (blockedColumnReady) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_day_in_office DATE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS resigned_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS exit_remarks TEXT;
  `);
  await pool.query(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check
  `);
  await pool.query(`
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (LOWER(TRIM(COALESCE(status::text, ''))) IN ('active', 'inactive', 'pending', 'resigned', 'terminated', ''))
  `);
  blockedColumnReady = true;
}

function denialForAccount(row) {
  if (!row) {
    return {
      status: 401,
      body: { message: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' },
    };
  }
  if (row.is_active === false) {
    return {
      status: 403,
      body: {
        message: 'This account has been deactivated. Contact an administrator.',
        code: ACCOUNT_CODES.DEACTIVATED,
      },
    };
  }
  if (row.blocked_at || isClosedAccount(row)) {
    return {
      status: 403,
      body: blockedLoginMessage(row),
    };
  }
  if (row.locked_at) {
    return {
      status: 403,
      body: {
        message:
          'Account locked due to too many failed attempts. Contact your admin.',
        code: ACCOUNT_CODES.LOCKED,
        accountLocked: true,
      },
    };
  }
  return null;
}

async function loadAccountStatus(userId) {
  await ensureBlockedColumn();
  const { rows } = await pool.query(
    `
      SELECT id, is_active, locked_at, blocked_at, blocked_reason, resigned_at, terminated_at, status
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Rejects deactivated, admin-blocked, and failed-login-locked accounts.
 * Returns true if a response was already sent.
 */
async function rejectIfAccountDisabled(userId, res) {
  const row = await loadAccountStatus(userId);
  const denial = denialForAccount(row);
  if (!denial) return false;
  res.status(denial.status).json(denial.body);
  return true;
}

module.exports = {
  ACCOUNT_CODES,
  RESIGNED_REASON,
  TERMINATED_REASON,
  isResignedAccount,
  isTerminatedAccount,
  isClosedAccount,
  blockedLoginMessage,
  ensureBlockedColumn,
  denialForAccount,
  loadAccountStatus,
  rejectIfAccountDisabled,
};
