const pool = require('../config/db');

const ACCOUNT_CODES = {
  DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  BLOCKED: 'ACCOUNT_BLOCKED',
  LOCKED: 'ACCOUNT_LOCKED',
};

let blockedColumnReady = false;

async function ensureBlockedColumn() {
  if (blockedColumnReady) return;
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
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
  if (row.blocked_at) {
    return {
      status: 403,
      body: {
        message: 'This account has been blocked. Contact an administrator.',
        code: ACCOUNT_CODES.BLOCKED,
      },
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
      SELECT id, is_active, locked_at, blocked_at
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
  ensureBlockedColumn,
  denialForAccount,
  loadAccountStatus,
  rejectIfAccountDisabled,
};
