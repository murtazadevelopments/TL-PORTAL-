const pool = require('../config/db');
const { zonedParts } = require('./attendanceWindows');
const { isLowerStaff } = require('./staffKind');

let ensured = false;
let ensurePromise = null;

async function runEnsurePayrollTables() {
  await pool.query(`
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
  `);
  ensured = true;
}

async function ensurePayrollTables() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsurePayrollTables().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ''));
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function karachiToday() {
  return zonedParts().dateKey;
}

function karachiMonth(dateKey = karachiToday()) {
  return String(dateKey).slice(0, 7);
}

function monthFromDate(dateKey) {
  if (!isDateKey(dateKey)) return '';
  return dateKey.slice(0, 7);
}

function addMonths(monthKey, delta) {
  if (!isMonthKey(monthKey)) return '';
  const [year, month] = monthKey.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1 + Number(delta || 0), 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey) {
  if (!isMonthKey(monthKey)) return String(monthKey || '');
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function compareMonth(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function splitInstallments(amount, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const total = money(amount);
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const parts = Array.from({ length: n }, () => money(base / 100));
  const used = Math.round(parts.slice(0, n - 1).reduce((sum, part) => sum + part, 0) * 100);
  parts[n - 1] = money((cents - used) / 100);
  return parts;
}

function formatMoney(value) {
  return money(value).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

async function loadLowerStaff(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, employee_id, name, branch, salary, staff_kind, date_joined, is_active
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  const row = rows[0];
  if (!row || !isLowerStaff(row) || row.is_active === false) return null;
  return row;
}

function remainingForMonth(salary, advanceTotal, loanTotal) {
  return money(money(salary) - money(advanceTotal) - money(loanTotal));
}

async function payrollForUsers(userIds, monthKey) {
  const ids = (userIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return new Map();

  const [{ rows: advances }, { rows: loans }] = await Promise.all([
    pool.query(
      `
        SELECT user_id, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
        FROM staff_salary_advances
        WHERE user_id = ANY($1::int[]) AND month_key = $2
        GROUP BY user_id
      `,
      [ids, monthKey]
    ),
    pool.query(
      `
        SELECT user_id, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
        FROM staff_loan_installments
        WHERE user_id = ANY($1::int[]) AND month_key = $2
        GROUP BY user_id
      `,
      [ids, monthKey]
    ),
  ]);

  const { rows: openLoans } = await pool.query(
    `
      SELECT user_id, COUNT(DISTINCT loan_id)::int AS open_loans
      FROM staff_loan_installments
      WHERE user_id = ANY($1::int[]) AND month_key >= $2
      GROUP BY user_id
    `,
    [ids, monthKey]
  );

  const byUser = new Map();
  for (const id of ids) {
    byUser.set(id, {
      advance_amount: 0,
      advance_count: 0,
      loan_amount: 0,
      loan_count: 0,
      open_loans: 0,
    });
  }
  for (const row of advances) {
    const item = byUser.get(Number(row.user_id));
    if (item) {
      item.advance_amount = money(row.total);
      item.advance_count = Number(row.count) || 0;
    }
  }
  for (const row of loans) {
    const item = byUser.get(Number(row.user_id));
    if (item) {
      item.loan_amount = money(row.total);
      item.loan_count = Number(row.count) || 0;
    }
  }
  for (const row of openLoans) {
    const item = byUser.get(Number(row.user_id));
    if (item) item.open_loans = Number(row.open_loans) || 0;
  }
  return byUser;
}

async function employeePayrollDetail(user, fromMonth, throughMonth) {
  const userId = user.id;
  const [{ rows: advances }, { rows: loans }, { rows: installments }] = await Promise.all([
    pool.query(
      `
        SELECT id, amount, paid_on::text AS paid_on, month_key, created_at
        FROM staff_salary_advances
        WHERE user_id = $1
        ORDER BY paid_on DESC, id DESC
      `,
      [userId]
    ),
    pool.query(
      `
        SELECT id, amount, installments, monthly_amount, start_month, created_at
        FROM staff_loans
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId]
    ),
    pool.query(
      `
        SELECT id, loan_id, month_key, amount
        FROM staff_loan_installments
        WHERE user_id = $1
        ORDER BY month_key ASC, id ASC
      `,
      [userId]
    ),
  ]);

  const currentMonth = karachiMonth();
  const scheduleByLoan = new Map();
  for (const row of installments) {
    const list = scheduleByLoan.get(Number(row.loan_id)) || [];
    list.push({
      id: row.id,
      month_key: row.month_key,
      month_label: monthLabel(row.month_key),
      amount: money(row.amount),
    });
    scheduleByLoan.set(Number(row.loan_id), list);
  }

  const loanRows = loans.map((loan) => {
    const schedule = scheduleByLoan.get(Number(loan.id)) || [];
    const remainingParts = schedule.filter((part) => compareMonth(part.month_key, currentMonth) >= 0);
    return {
      id: loan.id,
      amount: money(loan.amount),
      installments: Number(loan.installments) || 0,
      monthly_amount: money(loan.monthly_amount),
      start_month: loan.start_month,
      start_month_label: monthLabel(loan.start_month),
      created_at: loan.created_at,
      remaining_amount: money(remainingParts.reduce((sum, part) => sum + part.amount, 0)),
      remaining_installments: remainingParts.length,
      schedule,
    };
  });

  const advanceByMonth = new Map();
  for (const row of advances) {
    const key = row.month_key;
    const list = advanceByMonth.get(key) || [];
    list.push({
      id: row.id,
      amount: money(row.amount),
      paid_on: String(row.paid_on).slice(0, 10),
    });
    advanceByMonth.set(key, list);
  }
  const loanByMonth = new Map();
  for (const row of installments) {
    const key = row.month_key;
    const list = loanByMonth.get(key) || [];
    list.push({ loan_id: row.loan_id, amount: money(row.amount) });
    loanByMonth.set(key, list);
  }

  const months = [];
  let cursor = fromMonth;
  while (cursor && compareMonth(cursor, throughMonth) <= 0) {
    const monthAdvances = advanceByMonth.get(cursor) || [];
    const monthLoans = loanByMonth.get(cursor) || [];
    const advanceTotal = money(monthAdvances.reduce((sum, item) => sum + item.amount, 0));
    const loanTotal = money(monthLoans.reduce((sum, item) => sum + item.amount, 0));
    const salary = money(user.salary);
    months.push({
      month_key: cursor,
      month_label: monthLabel(cursor),
      salary,
      advance_amount: advanceTotal,
      loan_amount: loanTotal,
      remaining: remainingForMonth(salary, advanceTotal, loanTotal),
      has_advance: monthAdvances.length > 0,
      has_loan: monthLoans.length > 0,
      advances: monthAdvances,
    });
    cursor = addMonths(cursor, 1);
  }

  return {
    employee: {
      id: user.id,
      employee_id: user.employee_id,
      name: user.name,
      branch: user.branch,
      salary: money(user.salary),
    },
    advances: advances.map((row) => ({
      id: row.id,
      amount: money(row.amount),
      paid_on: String(row.paid_on).slice(0, 10),
      month_key: row.month_key,
      month_label: monthLabel(row.month_key),
      created_at: row.created_at,
    })),
    loans: loanRows,
    months,
  };
}

module.exports = {
  ensurePayrollTables,
  money,
  isMonthKey,
  isDateKey,
  karachiToday,
  karachiMonth,
  monthFromDate,
  addMonths,
  monthLabel,
  compareMonth,
  splitInstallments,
  formatMoney,
  loadLowerStaff,
  remainingForMonth,
  payrollForUsers,
  employeePayrollDetail,
};
