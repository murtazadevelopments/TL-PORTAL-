-- 24-hour cooldown between profile-complete alerts
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_alert_sent_at TIMESTAMPTZ;

UPDATE users
SET profile_alert_sent_at = profile_alert_at
WHERE profile_alert_sent_at IS NULL
  AND profile_alert_at IS NOT NULL;

COMMIT;
