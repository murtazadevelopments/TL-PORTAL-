-- Picture attachment and sender display style on portal messages.

BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS image_mime TEXT,
  ADD COLUMN IF NOT EXISTS from_style TEXT NOT NULL DEFAULT 'portal';

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_from_style_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_from_style_check
  CHECK (from_style IN ('portal', 'name'));

COMMIT;
