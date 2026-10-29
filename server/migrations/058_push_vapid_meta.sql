-- Track which VAPID public key the DB subscriptions were created with.
-- When the key rotates (e.g. Hostinger env fixed), old endpoints return 403
-- and must be cleared so devices can re-subscribe.
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
