-- Five availability checks per remote shift (start window + 4 random pings).

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_challenges (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date          TEXT NOT NULL,
  seq                 INTEGER NOT NULL CHECK (seq BETWEEN 1 AND 5),
  kind                TEXT NOT NULL CHECK (kind IN ('start', 'random')),
  hour_key            TEXT NOT NULL,
  scheduled_at       TIMESTAMPTZ NOT NULL,
  late_at             TIMESTAMPTZ NOT NULL,
  absent_at           TIMESTAMPTZ NOT NULL,
  notified_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'notified', 'verified', 'late', 'missed')),
  attendance_log_id  BIGINT REFERENCES attendance_logs(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, shift_date, seq),
  UNIQUE (user_id, hour_key)
);

CREATE INDEX IF NOT EXISTS attendance_challenges_due_idx
  ON attendance_challenges (scheduled_at, status);

CREATE INDEX IF NOT EXISTS attendance_challenges_user_date_idx
  ON attendance_challenges (user_id, shift_date);

ALTER TABLE attendance_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_challenges_no_anon ON attendance_challenges;
CREATE POLICY attendance_challenges_no_anon ON attendance_challenges
  FOR ALL TO anon USING (false) WITH CHECK (false);

COMMIT;
