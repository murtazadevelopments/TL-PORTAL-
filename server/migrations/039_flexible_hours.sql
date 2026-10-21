ALTER TABLE users
  ADD COLUMN IF NOT EXISTS flexible_hours BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE attendance_days
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

ALTER TABLE attendance_days
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE attendance_challenges DROP CONSTRAINT IF EXISTS attendance_challenges_kind_check;

DO $$
BEGIN
  ALTER TABLE attendance_challenges
    ADD CONSTRAINT attendance_challenges_kind_check
    CHECK (kind IN ('start', 'random', 'checkout'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
