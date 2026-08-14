-- Login activity log for CEO review
BEGIN;

CREATE TABLE IF NOT EXISTS login_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  employee_id TEXT,
  employee_name TEXT,
  username TEXT,
  ip_address TEXT,
  location TEXT,
  user_agent TEXT,
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_logs_logged_in_at_idx ON login_logs (logged_in_at DESC);
CREATE INDEX IF NOT EXISTS login_logs_user_id_idx ON login_logs (user_id);
CREATE INDEX IF NOT EXISTS login_logs_employee_id_idx ON login_logs (employee_id);

COMMIT;
