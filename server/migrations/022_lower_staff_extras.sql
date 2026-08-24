-- Extra labeled text/file slots for lower staff records
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_kind TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_label TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_text TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_1_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_kind TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_label TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_text TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_extra_2_url TEXT;

COMMIT;
