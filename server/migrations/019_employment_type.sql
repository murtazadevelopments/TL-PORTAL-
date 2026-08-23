-- Employment type captured at signup (onsite | remote)
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employment_type TEXT;

COMMIT;
