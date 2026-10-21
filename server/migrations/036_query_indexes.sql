-- Indexes for login, directory, and month-range attendance lookups.
-- Hostinger also runs these via ensureQueryIndexes() on boot.

BEGIN;

CREATE INDEX IF NOT EXISTS users_username_lower_idx
  ON users (lower(btrim(username)));

CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON users (lower(btrim(email)));

CREATE INDEX IF NOT EXISTS users_active_created_idx
  ON users (created_at DESC NULLS LAST, id DESC)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS users_onsite_active_idx
  ON users (id)
  WHERE is_active IS TRUE
    AND status = 'active';

CREATE INDEX IF NOT EXISTS onsite_attendance_user_work_date_idx
  ON onsite_attendance (user_id, work_date);

COMMIT;
