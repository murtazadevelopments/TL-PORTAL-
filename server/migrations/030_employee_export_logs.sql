-- CEO-only record of employee data exports.
CREATE TABLE IF NOT EXISTS employee_export_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT,
  actor_name TEXT,
  actor_username TEXT,
  actor_employee_id TEXT,
  format TEXT NOT NULL,
  data_limit TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_export_logs_created_at_idx
  ON employee_export_logs (created_at DESC);
