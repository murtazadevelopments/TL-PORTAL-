-- Branch GPS geofence for onsite check-in (OR with office IP whitelist).
-- App also applies these columns via ensureOnsiteAttendanceSchema().

BEGIN;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS radius_meters INTEGER DEFAULT 150;

UPDATE branches
SET latitude = 24.8614834,
    longitude = 67.0099051,
    radius_meters = 150
WHERE lower(name) = 'division'
  AND latitude IS NULL
  AND longitude IS NULL;

COMMIT;
