-- Sick leave vs annual leave. Prescription required for sick leave only.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS leave_type TEXT;

UPDATE leave_requests
SET leave_type = 'sick'
WHERE leave_type IS NULL OR TRIM(leave_type) = '';

ALTER TABLE leave_requests
  ALTER COLUMN leave_type SET DEFAULT 'sick';

ALTER TABLE leave_requests
  ALTER COLUMN leave_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_leave_type_check'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_leave_type_check
      CHECK (leave_type IN ('sick', 'annual'));
  END IF;
END $$;

ALTER TABLE leave_requests
  ALTER COLUMN prescription_path DROP NOT NULL;
