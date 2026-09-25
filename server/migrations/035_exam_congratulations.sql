-- One-time exam congratulations overlay for named employees only.
CREATE TABLE IF NOT EXISTS exam_congratulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exam_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at TIMESTAMPTZ,
      UNIQUE (user_id)
    );

CREATE INDEX IF NOT EXISTS exam_congratulations_unseen_idx
  ON exam_congratulations (user_id)
  WHERE seen_at IS NULL;
