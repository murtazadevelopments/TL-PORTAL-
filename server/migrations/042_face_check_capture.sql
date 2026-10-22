ALTER TABLE users
  ADD COLUMN IF NOT EXISTS face_check_capture BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS face_check_captures (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_log_id BIGINT REFERENCES attendance_logs(id) ON DELETE SET NULL,
  hour_key TEXT,
  status TEXT,
  match_score DOUBLE PRECISION,
  image_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS face_check_captures_captured_idx
  ON face_check_captures (captured_at DESC);

CREATE INDEX IF NOT EXISTS face_check_captures_user_idx
  ON face_check_captures (user_id, captured_at DESC);
