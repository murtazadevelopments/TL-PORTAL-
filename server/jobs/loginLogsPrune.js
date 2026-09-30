const pool = require('../config/db');

const RETENTION_INTERVAL = '30 days';

/**
 * Delete login_logs older than 30 days.
 * audit_log is never pruned (compliance).
 */
async function runLoginLogsPrune() {
  const { rowCount } = await pool.query(`
    DELETE FROM login_logs
    WHERE logged_in_at < NOW() - INTERVAL '${RETENTION_INTERVAL}'
  `);

  const deleted = rowCount || 0;
  if (deleted > 0) {
    console.log(
      `[login-logs-prune] ${new Date().toISOString()} deleted=${deleted} (older than ${RETENTION_INTERVAL})`
    );
  }
  return deleted;
}

module.exports = { runLoginLogsPrune, RETENTION_INTERVAL };
