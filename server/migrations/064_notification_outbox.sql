-- Durable attendance reminder outbox.
-- Do not auto-run. Apply manually after review.
-- Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id               BIGSERIAL PRIMARY KEY,
  challenge_id     BIGINT NOT NULL REFERENCES attendance_challenges(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel          TEXT NOT NULL CHECK (channel IN ('email', 'push')),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge_id, channel)
);

CREATE INDEX IF NOT EXISTS notification_outbox_status_next_idx
  ON notification_outbox (status, next_attempt_at);

COMMIT;
