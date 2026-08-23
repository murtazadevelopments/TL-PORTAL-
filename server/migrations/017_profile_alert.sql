-- Admin "complete your profile" alert shown on next portal visit
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_alert_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_alert_fields TEXT;

COMMIT;
