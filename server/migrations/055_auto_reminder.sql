-- Auto reminder controls random check-in emails for remote employees.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auto_reminder BOOLEAN NOT NULL DEFAULT true;
