/**
 * Grant a one-time exam congratulations overlay to a specific employee.
 *
 *   cd server
 *   node scripts/grant-exam-congrats.js murtaza_ali "your exam"
 *   node scripts/grant-exam-congrats.js murtaza_ali "your exam" --reset
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const pool = require('../config/db');
const { ensureExamCongratsSchema } = require('../utils/examCongrats');

async function main() {
  const args = process.argv.slice(2).filter(Boolean);
  const reset = args.includes('--reset');
  const positional = args.filter((a) => a !== '--reset');
  const who = String(positional[0] || '').trim();
  const examLabel = String(positional[1] || 'your exam').trim();
  if (!who) {
    console.error('Usage: node scripts/grant-exam-congrats.js <username-or-id> [exam-label] [--reset]');
    process.exit(1);
  }

  await ensureExamCongratsSchema();
  const { rows } = await pool.query(
    `
      SELECT id, username, name
      FROM users
      WHERE (
        (username IS NOT NULL AND LOWER(TRIM(username)) = LOWER($1))
        OR id::text = $1
        OR (employee_id IS NOT NULL AND LOWER(TRIM(employee_id)) = LOWER($1))
      )
      LIMIT 1
    `,
    [who]
  );
  const user = rows[0];
  if (!user) {
    console.error(`No user found for "${who}".`);
    process.exit(1);
  }

  if (reset) {
    await pool.query(
      `
        UPDATE exam_congratulations
        SET seen_at = NULL
        WHERE user_id = $1 AND exam_label = $2
      `,
      [user.id, examLabel]
    );
  }

  const { rows: saved } = await pool.query(
    `
      INSERT INTO exam_congratulations (user_id, exam_label)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET
        exam_label = EXCLUDED.exam_label,
        seen_at = CASE WHEN $3::boolean THEN NULL ELSE exam_congratulations.seen_at END
      RETURNING id, seen_at
    `,
    [user.id, examLabel, reset]
  );

  console.log(
    `Exam congratulations ready for ${user.name} (@${user.username}, id=${user.id}) exam="${examLabel}" seen=${Boolean(saved[0]?.seen_at)}`
  );
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
