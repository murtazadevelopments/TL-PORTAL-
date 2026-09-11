-- Job titles for employee designation dropdown + Team Lead dashboard access.
CREATE TABLE IF NOT EXISTS designations (
  id                   BIGSERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  tl_dashboard_access  BOOLEAN NOT NULL DEFAULT false,
  created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT designations_name_unique UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS designations_name_lower_idx ON designations (lower(name));
