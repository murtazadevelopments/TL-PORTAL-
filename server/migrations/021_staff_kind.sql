-- Payroll-only lower staff records (name + salary), separate from portal employees
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS staff_kind TEXT;

UPDATE users
SET staff_kind = 'portal'
WHERE staff_kind IS NULL OR TRIM(staff_kind) = '';

ALTER TABLE users
  ALTER COLUMN staff_kind SET DEFAULT 'portal';

COMMIT;
