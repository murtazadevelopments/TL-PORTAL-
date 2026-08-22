-- Team Leader Dashboard: categories, items, viewer assignments, CEO T-Pin
-- Run in Supabase SQL Editor (or any Postgres client connected to Textured Lab Portal).

BEGIN;

-- CEO transaction PIN (hashed). Only used for TL dashboard mutations.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS t_pin_hash TEXT;

-- Categories live under a section tab: all | merchant
CREATE TABLE IF NOT EXISTS tl_categories (
  id BIGSERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('all', 'merchant')),
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tl_categories_section_idx ON tl_categories (section, sort_order, id);

-- Links / bank / free-text rows inside a category (unlimited)
CREATE TABLE IF NOT EXISTS tl_category_items (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES tl_categories(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'text'
    CHECK (item_type IN ('link', 'text', 'bank')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tl_category_items_category_idx
  ON tl_category_items (category_id, sort_order, id);

-- CEO assigns who may VIEW + COPY a category (no edit)
CREATE TABLE IF NOT EXISTS tl_category_assignments (
  category_id BIGINT NOT NULL REFERENCES tl_categories(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category_id, user_id)
);

CREATE INDEX IF NOT EXISTS tl_category_assignments_user_idx
  ON tl_category_assignments (user_id);

COMMIT;
