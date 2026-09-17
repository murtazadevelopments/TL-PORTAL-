-- Five employee-profile alerts lock the portal to incomplete employee fields only.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_alert_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_incomplete_locked_at TIMESTAMPTZ;

UPDATE users
SET profile_alert_count = 0
WHERE profile_alert_count IS NULL;
