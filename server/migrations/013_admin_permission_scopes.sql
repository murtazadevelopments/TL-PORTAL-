-- Scoped admin access for employees:view / employees:edit
-- scope examples:
--   {"type":"all"}
--   {"type":"branch","values":["Head Office","Unit"]}
--   {"type":"team","values":["Sales"]}
-- Run in Supabase SQL Editor.

BEGIN;

ALTER TABLE admin_permissions
  ADD COLUMN IF NOT EXISTS scope JSONB NOT NULL DEFAULT '{"type":"all"}'::jsonb;

COMMIT;
