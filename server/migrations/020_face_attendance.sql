-- Face-verification attendance for remote employees.
-- App authorizes via Express + JWT; Node connects as a privileged pooler role
-- (bypasses RLS unless FORCE). Policies below restrict PostgREST anon/authenticated.

BEGIN;

UPDATE users
SET employment_type = 'onsite'
WHERE employment_type IS NULL OR TRIM(employment_type) = '';

ALTER TABLE users
  ALTER COLUMN employment_type SET DEFAULT 'onsite';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_employment_type_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_employment_type_check
      CHECK (employment_type IN ('onsite', 'remote'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS face_enrollments (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  embedding     JSONB NOT NULL,
  sample_count  INTEGER NOT NULL DEFAULT 3,
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hour_key        TEXT NOT NULL,
  match_score     DOUBLE PRECISION,
  method          TEXT NOT NULL CHECK (method IN ('face', 'manual')),
  status          TEXT NOT NULL CHECK (status IN ('verified', 'failed', 'missed')),
  marked_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attendance_logs_user_checked_idx
  ON attendance_logs (user_id, checked_in_at DESC);

CREATE INDEX IF NOT EXISTS attendance_logs_hour_key_idx
  ON attendance_logs (hour_key, status);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_slot_unique
  ON attendance_logs (user_id, hour_key)
  WHERE status IN ('verified', 'missed') OR method = 'manual';

ALTER TABLE face_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS face_enrollments_no_anon ON face_enrollments;
CREATE POLICY face_enrollments_no_anon ON face_enrollments
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS attendance_logs_no_anon ON attendance_logs;
CREATE POLICY attendance_logs_no_anon ON attendance_logs
  FOR ALL TO anon USING (false) WITH CHECK (false);

COMMIT;
