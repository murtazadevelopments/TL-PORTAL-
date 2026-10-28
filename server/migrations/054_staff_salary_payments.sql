ALTER TABLE staff_loans
  ADD COLUMN IF NOT EXISTS loaned_on DATE;

UPDATE staff_loans
SET loaned_on = to_date(start_month || '-01', 'YYYY-MM-DD')
WHERE loaned_on IS NULL AND start_month ~ '^\d{4}-\d{2}$';

CREATE TABLE IF NOT EXISTS staff_salary_payments (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key   TEXT NOT NULL,
  paid_on     DATE NOT NULL,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_key)
);

CREATE INDEX IF NOT EXISTS staff_salary_payments_month_idx
  ON staff_salary_payments (month_key, user_id);
