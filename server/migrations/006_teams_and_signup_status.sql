-- Teams/departments catalog + ensure signup status defaults to inactive
-- Run in Supabase SQL Editor (or any Postgres client connected to Textured Lab Portal).

BEGIN;

CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teams_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS teams_name_idx ON teams (name);

-- Backfill from existing employee department values
INSERT INTO teams (name, created_by)
SELECT DISTINCT TRIM(department), NULL::bigint
FROM users
WHERE department IS NOT NULL
  AND TRIM(department) <> ''
ON CONFLICT (name) DO NOTHING;

-- New accounts stay pending until an admin sets status = active
ALTER TABLE users
  ALTER COLUMN status SET DEFAULT 'inactive';

COMMIT;
