-- Performance indexes for common WHERE / JOIN / ORDER BY filters.
-- Do NOT auto-run: apply manually during a maintenance window.
-- Safe to re-run (IF NOT EXISTS). Skips indexes already created in earlier migrations.

BEGIN;

-- Users: directory filters + attendance joins
CREATE INDEX IF NOT EXISTS users_employee_id_idx
  ON users (employee_id)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_branch_idx
  ON users (branch)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS users_department_idx
  ON users (department)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS users_status_active_idx
  ON users (status)
  WHERE is_active IS TRUE;

-- Remote attendance
CREATE INDEX IF NOT EXISTS attendance_logs_user_status_idx
  ON attendance_logs (user_id, status);

CREATE INDEX IF NOT EXISTS attendance_days_date_status_idx
  ON attendance_days (date_key, status);

CREATE INDEX IF NOT EXISTS attendance_days_user_date_idx
  ON attendance_days (user_id, date_key);

-- Onsite attendance date+status (user_work_date already in 036)
CREATE INDEX IF NOT EXISTS onsite_attendance_work_date_status_idx
  ON onsite_attendance (work_date, status);

-- Audit log actor + time (created_at / target indexes exist in 002)
CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON audit_log (actor_id, created_at DESC);

-- Login logs username filter
CREATE INDEX IF NOT EXISTS login_logs_username_logged_idx
  ON login_logs (username, logged_in_at DESC);

COMMIT;
