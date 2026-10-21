CREATE TABLE IF NOT EXISTS employee_transfers (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('team', 'shift', 'branch')),
  from_value      TEXT,
  to_value        TEXT NOT NULL,
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_username  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_transfers_user_idx
  ON employee_transfers (user_id, created_at DESC);
