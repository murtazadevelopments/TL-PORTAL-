-- Achieved sales logged by the supervisor (manual).
ALTER TABLE sales_agent_targets
  ADD COLUMN IF NOT EXISTS achieved_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;
