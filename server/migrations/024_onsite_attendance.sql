-- Onsite attendance: branch office IP, configurable shifts, IP check-in (no check-out).
-- App authorizes via Express + JWT; Node uses a privileged pooler role (bypasses RLS unless FORCE).
-- Policies restrict PostgREST anon.

BEGIN;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS ip_address TEXT;
-- ip_address stores one or more public IPs, comma-separated.

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
);

CREATE INDEX IF NOT EXISTS shifts_name_idx ON shifts (name);

CREATE TABLE IF NOT EXISTS onsite_attendance (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date           DATE NOT NULL,
  checked_in_at       TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('on_time', 'late', 'absent')),
  method              TEXT NOT NULL CHECK (method IN ('ip', 'manual')),
  branch_name         TEXT NOT NULL,
  shift_name          TEXT,
  marked_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note                TEXT,
  status_overridden   BOOLEAN NOT NULL DEFAULT false,
  previous_status     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS onsite_attendance_date_idx
  ON onsite_attendance (work_date DESC, status);

CREATE INDEX IF NOT EXISTS onsite_attendance_user_idx
  ON onsite_attendance (user_id, work_date DESC);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE onsite_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_no_anon ON shifts;
CREATE POLICY shifts_no_anon ON shifts
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS onsite_attendance_no_anon ON onsite_attendance;
CREATE POLICY onsite_attendance_no_anon ON onsite_attendance
  FOR ALL TO anon USING (false) WITH CHECK (false);

COMMIT;
