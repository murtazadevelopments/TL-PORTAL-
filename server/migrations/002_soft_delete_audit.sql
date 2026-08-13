-- Soft-delete + audit log (run in Supabase SQL Editor)
-- Does NOT modify existing row data beyond adding columns with defaults.

BEGIN;

-- Soft-delete flag on users (only deletable resource today)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Audit trail for irreversible CEO purges
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT,
  actor_username TEXT,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_table, target_id);
CREATE INDEX IF NOT EXISTS users_is_active_idx ON users (is_active);

COMMIT;
