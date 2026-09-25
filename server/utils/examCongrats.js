const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

async function runEnsureExamCongratsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_congratulations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      exam_label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      seen_at TIMESTAMPTZ,
      UNIQUE (user_id)
    )
  `);
  await pool.query(`
    ALTER TABLE exam_congratulations DROP CONSTRAINT IF EXISTS exam_congratulations_user_id_exam_label_key
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exam_congratulations_user_id_key'
      ) THEN
        ALTER TABLE exam_congratulations ADD CONSTRAINT exam_congratulations_user_id_key UNIQUE (user_id);
      END IF;
    END $$
  `);
  ensured = true;
}

async function ensureExamCongratsSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureExamCongratsSchema().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

async function pendingExamCongrats(userId) {
  await ensureExamCongratsSchema();
  const { rows } = await pool.query(
    `
      SELECT id, exam_label
      FROM exam_congratulations
      WHERE user_id = $1 AND seen_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [userId]
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, exam_label: rows[0].exam_label };
}

async function acknowledgeExamCongrats(userId, congratsId) {
  await ensureExamCongratsSchema();
  const { rowCount } = await pool.query(
    `
      UPDATE exam_congratulations
      SET seen_at = NOW()
      WHERE id = $1 AND user_id = $2 AND seen_at IS NULL
    `,
    [congratsId, userId]
  );
  return rowCount > 0;
}

module.exports = {
  ensureExamCongratsSchema,
  pendingExamCongrats,
  acknowledgeExamCongrats,
};
