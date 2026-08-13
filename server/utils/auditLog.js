const pool = require('../config/db');

/**
 * Insert an audit_log row. Does not throw to the caller if logging fails
 * after we already decided to proceed — callers should await and handle.
 */
async function writeAuditLog({
  actorId,
  actorUsername,
  action,
  targetTable,
  targetId,
  reason,
}) {
  const { rows } = await pool.query(
    `
      INSERT INTO audit_log (
        actor_id, actor_username, action, target_table, target_id, reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      actorId ?? null,
      actorUsername ?? null,
      action,
      targetTable,
      String(targetId),
      reason,
    ]
  );
  return rows[0];
}

module.exports = { writeAuditLog };
