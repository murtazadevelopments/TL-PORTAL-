ALTER TABLE face_check_captures
  ADD COLUMN IF NOT EXISTS image_bytes BYTEA;
