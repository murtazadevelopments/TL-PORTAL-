-- ZKTeco biometric punches. Kept separate from attendance_logs (remote face check-ins).
CREATE TABLE IF NOT EXISTS zkteco_attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, punch_time)
);

CREATE INDEX IF NOT EXISTS zkteco_attendance_logs_punch_time_idx
  ON zkteco_attendance_logs (punch_time DESC);

ALTER TABLE zkteco_attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zkteco_attendance_logs_no_anon ON zkteco_attendance_logs;
CREATE POLICY zkteco_attendance_logs_no_anon ON zkteco_attendance_logs
  FOR ALL TO anon USING (false) WITH CHECK (false);
