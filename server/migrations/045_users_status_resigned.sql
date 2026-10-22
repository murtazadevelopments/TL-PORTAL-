ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (LOWER(TRIM(COALESCE(status::text, ''))) IN ('active', 'inactive', 'pending', 'resigned', ''));
