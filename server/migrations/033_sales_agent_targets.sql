-- Sales supervisor PIN + per-agent monthly targets.
-- Permission key `sales:targets` lives in admin_permissions (no extra catalog table).

ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_pin_hash TEXT;

CREATE TABLE IF NOT EXISTS sales_agent_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  target_amount NUMERIC(14, 2),
  updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS sales_agent_targets_period_idx
  ON sales_agent_targets (period, user_id);
