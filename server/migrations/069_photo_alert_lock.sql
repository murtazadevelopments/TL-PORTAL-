-- Photo alert count + lock after 3 alerts until a new profile picture is uploaded.
-- Safe to re-run.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_alert_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_alert_locked_at TIMESTAMPTZ;

COMMIT;
