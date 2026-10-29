const pool = require('../config/db');

let ensured = false;

async function ensureLeaveRequestsSchema() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      leave_type TEXT NOT NULL DEFAULT 'sick'
        CHECK (leave_type IN ('sick', 'annual')),
      prescription_path TEXT,
      prescription_mime TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_remarks TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT leave_requests_dates_ok CHECK (end_date >= start_date)
    )
  `);
  await pool.query(`
    ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS leave_type TEXT
  `);
  await pool.query(`
    UPDATE leave_requests
    SET leave_type = 'sick'
    WHERE leave_type IS NULL OR TRIM(leave_type) = ''
  `);
  await pool.query(`
    ALTER TABLE leave_requests
      ALTER COLUMN leave_type SET DEFAULT 'sick'
  `);
  try {
    await pool.query(`
      ALTER TABLE leave_requests
        ALTER COLUMN leave_type SET NOT NULL
    `);
  } catch {
    /* already NOT NULL */
  }
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_leave_type_check'
      ) THEN
        ALTER TABLE leave_requests
          ADD CONSTRAINT leave_requests_leave_type_check
          CHECK (leave_type IN ('sick', 'annual'));
      END IF;
    END $$
  `);
  try {
    await pool.query(`
      ALTER TABLE leave_requests
        ALTER COLUMN prescription_path DROP NOT NULL
    `);
  } catch {
    /* already nullable */
  }
  await pool.query(`
    CREATE INDEX IF NOT EXISTS leave_requests_status_created_idx
      ON leave_requests (status, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS leave_requests_user_created_idx
      ON leave_requests (user_id, created_at DESC)
  `);
  ensured = true;
}

module.exports = { ensureLeaveRequestsSchema };
