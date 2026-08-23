-- Admin-initiated account block (separate from failed-login lockout)
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

COMMIT;
