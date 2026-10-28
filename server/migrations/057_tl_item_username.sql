-- Optional username on Team Leader Dashboard link items (separate from label).
ALTER TABLE tl_category_items ADD COLUMN IF NOT EXISTS username TEXT;
