-- Medical leave requests (remote + onsite). Prescription required; HR/CEO/manager review.

CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  prescription_path TEXT NOT NULL,
  prescription_mime TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_remarks TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_requests_dates_ok CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_status_created_idx
  ON leave_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS leave_requests_user_created_idx
  ON leave_requests (user_id, created_at DESC);
