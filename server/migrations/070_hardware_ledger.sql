-- Hardware ledger: vendors and their total / paid amount records.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS hardware_vendors (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hardware_vendors_name_lower_idx
  ON hardware_vendors (LOWER(name));

CREATE TABLE IF NOT EXISTS hardware_vendor_records (
  id          BIGSERIAL PRIMARY KEY,
  vendor_id   BIGINT NOT NULL REFERENCES hardware_vendors(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('total', 'paid')),
  amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hardware_vendor_records_vendor_occurred_idx
  ON hardware_vendor_records (vendor_id, occurred_at DESC, id DESC);

COMMIT;
