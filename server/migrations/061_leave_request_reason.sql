-- Employee reason for leave (required for new annual leave; stored for all types).

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS reason TEXT;
