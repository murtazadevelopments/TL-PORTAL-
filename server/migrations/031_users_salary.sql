-- Subordinate-staff payroll. Hostinger DBs that skipped older schema still need this.
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary NUMERIC;
