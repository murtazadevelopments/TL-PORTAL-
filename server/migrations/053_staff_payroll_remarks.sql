ALTER TABLE staff_salary_advances
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE staff_loans
  ADD COLUMN IF NOT EXISTS remarks TEXT;
