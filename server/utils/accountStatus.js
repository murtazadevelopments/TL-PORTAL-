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
const STATUS_CACHE_TTL_MS = 45 * 1000;

const statusCache = new Map();
let blockedColumnReady = false;
let ensurePromise = null;

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

function cacheKey(userId) {
  return Number(userId);
}

function invalidateAccountStatus(userId) {
  const key = cacheKey(userId);
  if (!Number.isFinite(key)) return;
  statusCache.delete(key);
}

async function ensureBlockedColumn() {
  if (blockedColumnReady) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_day_in_office DATE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS resigned_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS exit_remarks TEXT;
    `);

    const { rows } = await pool.query(
      `
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_status_check'
          AND conrelid = 'public.users'::regclass
        LIMIT 1
      `
    );
    if (!rows.length) {
      try {
        await pool.query(`
          ALTER TABLE users
            ADD CONSTRAINT users_status_check
            CHECK (LOWER(TRIM(COALESCE(status::text, ''))) IN ('active', 'inactive', 'pending', 'resigned', 'terminated', ''))
        `);
      } catch (err) {
        if (err.code !== '42710') throw err;
      }
    }
    blockedColumnReady = true;
  })();

  try {
    await ensurePromise;
  } catch (err) {
    ensurePromise = null;
    throw err;
  }
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
  const key = cacheKey(userId);
  const hit = statusCache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.row;
  }

  const { rows } = await pool.query(
    `
      SELECT id, is_active, locked_at, blocked_at, blocked_reason, resigned_at, terminated_at, status
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  const row = rows[0] || null;
  statusCache.set(key, { row, expires: Date.now() + STATUS_CACHE_TTL_MS });
  return row;
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
  invalidateAccountStatus,
  denialForAccount,
  loadAccountStatus,
  rejectIfAccountDisabled,
};
