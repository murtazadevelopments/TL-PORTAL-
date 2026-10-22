ALTER TABLE users
  ADD COLUMN IF NOT EXISTS attendance_review_email_at TIMESTAMPTZ;
