-- Admin → employee messaging
-- Run in Supabase SQL Editor if the table is not already present.

BEGIN;

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT NOT NULL,
  delivery_method TEXT NOT NULL
    CHECK (delivery_method IN ('portal', 'email', 'both')),
  email_sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_recipient
  ON messages (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread
  ON messages (recipient_id)
  WHERE read_at IS NULL;

COMMIT;
