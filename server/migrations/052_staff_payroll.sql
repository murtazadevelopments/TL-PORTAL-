-- Advance salary and loans for subordinate (lower) staff payroll.

CREATE TABLE IF NOT EXISTS staff_salary_advances (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL,
  paid_on       DATE NOT NULL,
  month_key     TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_salary_advances_user_month_idx
  ON staff_salary_advances (user_id, month_key);

CREATE TABLE IF NOT EXISTS staff_loans (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  installments    INTEGER NOT NULL,
  monthly_amount  NUMERIC(12,2) NOT NULL,
  start_month     TEXT NOT NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_loans_user_idx
  ON staff_loans (user_id, start_month);

CREATE TABLE IF NOT EXISTS staff_loan_installments (
  id          BIGSERIAL PRIMARY KEY,
  loan_id     BIGINT NOT NULL REFERENCES staff_loans(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key   TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_loan_installments_user_month_idx
  ON staff_loan_installments (user_id, month_key);

CREATE INDEX IF NOT EXISTS staff_loan_installments_loan_idx
  ON staff_loan_installments (loan_id);
