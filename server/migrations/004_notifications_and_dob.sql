-- Notification settings + date of birth (Postgres / Supabase)
BEGIN;

CREATE TABLE IF NOT EXISTS notification_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_log (
  id BIGSERIAL PRIMARY KEY,
  email_type TEXT NOT NULL,
  recipient TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_log_created_at_idx ON email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_type_idx ON email_log (email_type);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMIT;
