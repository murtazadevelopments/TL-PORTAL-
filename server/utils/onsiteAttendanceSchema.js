const pool = require('../config/db');

let ensured = false;

async function denyAnon(table) {
  await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await pool.query(`DROP POLICY IF EXISTS ${table}_no_anon ON ${table}`);
  await pool.query(`
    CREATE POLICY ${table}_no_anon ON ${table}
      FOR ALL TO anon USING (false) WITH CHECK (false)
  `);
}

async function ensureOnsiteAttendanceSchema() {
  if (ensured) return;

  await pool.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS ip_address TEXT`);
  await pool.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`);
  await pool.query(
    `ALTER TABLE branches ADD COLUMN IF NOT EXISTS radius_meters INTEGER DEFAULT 150`
  );

  await pool.query(`
    UPDATE branches
    SET latitude = 24.8614834,
        longitude = 67.0099051,
        radius_meters = 150
    WHERE lower(name) = 'division'
      AND latitude IS NULL
      AND longitude IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id            BIGSERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      start_time    TIME NOT NULL,
      late_after    TIME NOT NULL,
      absent_after  TIME NOT NULL,
      created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT shifts_name_unique UNIQUE (name)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS shifts_name_idx ON shifts (name)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onsite_attendance (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date           DATE NOT NULL,
      checked_in_at       TIMESTAMPTZ NOT NULL,
      status              TEXT NOT NULL,
      method              TEXT NOT NULL,
      branch_name         TEXT NOT NULL,
      shift_name          TEXT,
      marked_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note                TEXT,
      status_overridden   BOOLEAN NOT NULL DEFAULT false,
      previous_status     TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, work_date)
    )
  `);

  await pool.query(`
    ALTER TABLE onsite_attendance DROP CONSTRAINT IF EXISTS onsite_attendance_status_check
  `);
  await pool.query(`
    ALTER TABLE onsite_attendance DROP CONSTRAINT IF EXISTS onsite_attendance_method_check
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE onsite_attendance
        ADD CONSTRAINT onsite_attendance_status_check
        CHECK (status IN ('on_time', 'late', 'absent'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE onsite_attendance
        ADD CONSTRAINT onsite_attendance_method_check
        CHECK (method IN ('ip', 'manual'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS onsite_attendance_date_idx
      ON onsite_attendance (work_date DESC, status)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS onsite_attendance_user_idx
      ON onsite_attendance (user_id, work_date DESC)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS onsite_attendance_user_work_date_uidx
      ON onsite_attendance (user_id, work_date)
  `);

  await denyAnon('shifts');
  await denyAnon('onsite_attendance');

  ensured = true;
}

module.exports = { ensureOnsiteAttendanceSchema };
