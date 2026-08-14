-- Admin permission scopes (run in Supabase SQL Editor)
-- Used when CEO assigns role=admin with granular access keys.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_permissions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS admin_permissions_user_id_idx
  ON admin_permissions (user_id);

COMMIT;
