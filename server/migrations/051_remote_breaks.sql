ALTER TABLE users
  ADD COLUMN IF NOT EXISTS breaks_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS attendance_breaks (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date    TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  match_score   DOUBLE PRECISION,
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attendance_breaks_user_date_idx
  ON attendance_breaks (user_id, shift_date, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_breaks_one_open
  ON attendance_breaks (user_id)
  WHERE ended_at IS NULL;

ALTER TABLE attendance_days
  ADD COLUMN IF NOT EXISTS work_minutes INTEGER;

ALTER TABLE attendance_days
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER;
