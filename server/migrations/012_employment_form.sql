-- Employment form PDF path on users (admin-only document)
-- Run in Supabase SQL Editor.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employment_form_url TEXT;

COMMIT;
