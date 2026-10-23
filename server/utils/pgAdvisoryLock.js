const pool = require('../config/db');

/** Stable int4 keys so two Node processes cannot run the same job together. */
const JOB_LOCKS = {
  birthdayEmails: 7102401,
  loginLogsPrune: 7102402,
  attendanceMissed: 7102403,
};

/**
 * Hold a session-level advisory lock on one pooled connection for the duration of `work`.
 * Returns null when another instance already holds the lock.
 */
async function withAdvisoryLock(lockKey, work) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
    if (!rows[0]?.locked) return null;
    try {
      return await work();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      } catch (err) {
        console.warn('[cron] advisory unlock failed:', err.message || err);
      }
    }
  } finally {
    client.release();
  }
}

function lockedJob(name, lockKey, runner) {
  return async (...args) => {
    const result = await withAdvisoryLock(lockKey, () => runner(...args));
    if (result === null) {
      console.log(`[cron] skip ${name} — another instance holds the lock`);
    }
    return result;
  };
}

module.exports = { JOB_LOCKS, withAdvisoryLock, lockedJob };
