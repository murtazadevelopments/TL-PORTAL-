-- Portal TL schema updates (run in Supabase SQL Editor)
-- Safe to re-run pieces carefully; review before production.

BEGIN;

-- 1) Single name column (app historically used first_name + father_name, not last_name)
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE users
SET name = TRIM(BOTH FROM CONCAT_WS(' ', NULLIF(TRIM(first_name), ''), NULLIF(TRIM(father_name), '')))
WHERE name IS NULL OR TRIM(name) = '';

-- Backfill any still-empty names from username
UPDATE users
SET name = COALESCE(NULLIF(TRIM(username), ''), 'Unknown')
WHERE name IS NULL OR TRIM(name) = '';

ALTER TABLE users ALTER COLUMN name SET NOT NULL;

-- Drop old name columns after backfill
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
ALTER TABLE users DROP COLUMN IF EXISTS father_name;

-- 2) Employee ID: admin-assigned only (nullable until admin sets it)
ALTER TABLE users ALTER COLUMN employee_id DROP NOT NULL;

-- Unique when present (multiple NULLs allowed in Postgres UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_unique
  ON users (employee_id)
  WHERE employee_id IS NOT NULL;

-- 3) CNIC optional
ALTER TABLE users ALTER COLUMN cnic_number DROP NOT NULL;

-- 4) Education + last job status
ALTER TABLE users ADD COLUMN IF NOT EXISTS education TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_job_status TEXT;

-- 5) Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);

COMMIT;
