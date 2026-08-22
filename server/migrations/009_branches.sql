-- Branch catalog (add/remove offices used in employee + admin assignment dropdowns)

BEGIN;

CREATE TABLE IF NOT EXISTS branches (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT branches_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS branches_name_idx ON branches (name);

INSERT INTO branches (name, created_by)
VALUES
  ('Head Office', NULL),
  ('Unit', NULL),
  ('Branch', NULL),
  ('Amir Chamber', NULL)
ON CONFLICT (name) DO NOTHING;

INSERT INTO branches (name, created_by)
SELECT DISTINCT TRIM(branch), NULL::bigint
FROM users
WHERE branch IS NOT NULL
  AND TRIM(branch) <> ''
ON CONFLICT (name) DO NOTHING;

COMMIT;
