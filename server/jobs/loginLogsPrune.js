const pool = require('../config/db');

/**
 * Delete login_logs older than 12 months.
 * audit_log is never pruned (compliance).
 */
async function runLoginLogsPrune() {
  const { rowCount } = await pool.query(`
    DELETE FROM login_logs
    WHERE logged_in_at < NOW() - INTERVAL '12 months'
  `);

  const deleted = rowCount || 0;
  console.log(
    `[login-logs-prune] ${new Date().toISOString()} deleted=${deleted} (older than 12 months)`
  );
  return deleted;
}

module.exports = { runLoginLogsPrune };
