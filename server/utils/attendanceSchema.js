const pool = require('../config/db');

let ensured = false;
let ensurePromise = null;

function compactName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function workHourColumns() {
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
  `);
  const startCols = [];
  const endCols = [];
  for (const row of rows) {
    const compact = compactName(row.column_name);
    if (!compact.includes('work') || !compact.includes('hour')) continue;
    if (compact.includes('start')) startCols.push(row.column_name);
    else if (compact.includes('end')) endCols.push(row.column_name);
  }
  return { startCols, endCols };
}

async function addWorkHourColumns() {
  const candidates = ['work_start_hour', 'work_end_hour', 'work_start_hour', 'work_end_hour'];
  for (const col of [...new Set(candidates)]) {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} INTEGER`);
  }
}

async function syncWorkHourColumns() {
  await addWorkHourColumns();
  const { startCols, endCols } = await workHourColumns();
  if (!startCols.length || !endCols.length) return;
  const startExpr = `COALESCE(${startCols.map((c) => `"${c}"`).join(', ')}, 9)`;
  const endExpr = `COALESCE(${endCols.map((c) => `"${c}"`).join(', ')}, 18)`;
  const sets = [
    ...startCols.map((c) => `"${c}" = ${startExpr}`),
    ...endCols.map((c) => `"${c}" = ${endExpr}`),
  ];
  await pool.query(`UPDATE users SET ${sets.join(', ')}`);
}

async function persistUserWorkHours(userId, start, end) {
  await addWorkHourColumns();
  const { startCols, endCols } = await workHourColumns();
  const sets = [];
  const params = [];
  for (const col of startCols) {
    params.push(start);
    sets.push(`"${col}" = $${params.length}`);
  }
  for (const col of endCols) {
    params.push(end);
    sets.push(`"${col}" = $${params.length}`);
  }
  if (!sets.length) {
    throw new Error('Working hour columns are missing on users.');
  }
  params.push(userId);
  await pool.query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params
  );
}

async function ensureAttendanceTables() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureAttendanceTables().then(
      () => {
        ensured = true;
      },
      (err) => {
        ensurePromise = null;
        throw err;
      }
    );
  }
  await ensurePromise;
}

async function runEnsureAttendanceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS face_enrollments (
      id            BIGSERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      embedding     JSONB NOT NULL,
      sample_count  INTEGER NOT NULL DEFAULT 3,
      enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id              BIGSERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hour_key        TEXT NOT NULL,
      match_score     DOUBLE PRECISION,
      method          TEXT NOT NULL,
      status          TEXT NOT NULL,
      marked_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note            TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await addWorkHourColumns();

  await pool.query(`
    ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_method_check;
  `);
  await pool.query(`
    ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_status_check;
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE attendance_logs
        ADD CONSTRAINT attendance_logs_method_check
        CHECK (method IN ('face', 'manual'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE attendance_logs
        ADD CONSTRAINT attendance_logs_status_check
        CHECK (status IN ('verified', 'failed', 'missed', 'late', 'leave'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS attendance_logs_user_checked_idx
      ON attendance_logs (user_id, checked_in_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS attendance_logs_hour_key_idx
      ON attendance_logs (hour_key, status);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_slot_unique
      ON attendance_logs (user_id, hour_key)
      WHERE status IN ('verified', 'missed', 'late', 'leave') OR method = 'manual';
  `).catch((err) => {
    if (err.code !== '23505') throw err;
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_days (
      id              BIGSERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date_key        TEXT NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'leave', 'pending')),
      first_check_in  TIMESTAMPTZ,
      note            TEXT,
      marked_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, date_key)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS attendance_days_date_idx
      ON attendance_days (date_key, status);
  `);
}

module.exports = { ensureAttendanceTables, persistUserWorkHours };
