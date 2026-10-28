-- Viewer PIN to unlock Team Leader Dashboard for non-CEO/manager viewers.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_otp_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_change_until TIMESTAMPTZ;
