ALTER TABLE users
  ADD COLUMN IF NOT EXISTS work_days JSONB NOT NULL DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":true,"sun":true}'::jsonb;

UPDATE users
   SET work_days = jsonb_set(COALESCE(work_days, '{}'::jsonb), '{sun}', 'false'::jsonb)
 WHERE six_day_week = true
   AND COALESCE(work_days->>'sun', 'true') <> 'false';
