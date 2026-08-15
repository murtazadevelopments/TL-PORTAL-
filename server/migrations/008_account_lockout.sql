-- Account lockout after failed password attempts
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

COMMIT;
