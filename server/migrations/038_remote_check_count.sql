ALTER TABLE users
  ADD COLUMN IF NOT EXISTS remote_check_count INTEGER NOT NULL DEFAULT 5;

ALTER TABLE attendance_challenges
  DROP CONSTRAINT IF EXISTS attendance_challenges_seq_check;

ALTER TABLE attendance_challenges
  ADD CONSTRAINT attendance_challenges_seq_check
  CHECK (seq >= 1 AND seq <= 12);
