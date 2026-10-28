const pool = require('../config/db');
const { writeAuditLog } = require('../utils/auditLog');
const { isLowerStaff } = require('../utils/staffKind');
const {
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
  loadLowerStaff,
  remainingForMonth,
  payrollForUsers,
  employeePayrollDetail,
} = require('../utils/staffPayroll');
const {
  buildPayrollBaseName,
  buildPayrollExcelXml,
  buildPayrollPdf,
} = require('../utils/staffPayrollExportFiles');

function canManageLowerStaff(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'ceo' || role === 'manager') return true;
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  return perms.includes('hr:add_employee') || perms.includes('*');
}

function denyUnlessHr(req, res) {
  if (canManageLowerStaff(req)) return false;
  res.status(403).json({
    message: 'Only HR with Add employees permission can manage subordinate staff salary.',
  });
  return true;
}

function attachmentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function parseMonth(value) {
  const key = String(value || '').slice(0, 7);
  return isMonthKey(key) ? key : karachiMonth();
}

async function listLowerStaffRows() {
  const { rows } = await pool.query(
    `
      SELECT id, employee_id, name, branch, salary, staff_kind, is_active
      FROM users
      WHERE is_active = true AND COALESCE(staff_kind, 'portal') = 'lower'
      ORDER BY name ASC NULLS LAST, id DESC
    `
  );
  return rows.filter((row) => isLowerStaff(row));
}

function withMonthTotals(person, monthKey, payroll) {
  const salary = money(person.salary);
  const advanceAmount = money(payroll?.advance_amount);
  const loanAmount = money(payroll?.loan_amount);
  const remaining = remainingForMonth(salary, advanceAmount, loanAmount);
  return {
    id: person.id,
    employee_id: person.employee_id,
    name: person.name,
    branch: person.branch,
    salary,
    month_key: monthKey,
    month_label: monthLabel(monthKey),
    advance_amount: advanceAmount,
    advance_count: Number(payroll?.advance_count) || 0,
    loan_amount: loanAmount,
    loan_count: Number(payroll?.loan_count) || 0,
    remaining,
    has_advance: (Number(payroll?.advance_count) || 0) > 0,
    has_loan: (Number(payroll?.loan_count) || 0) > 0,
    open_loans: Number(payroll?.open_loans) || 0,
  };
}

async function loadMonthReport(monthKey) {
  const people = await listLowerStaffRows();
  const payrollMap = await payrollForUsers(
    people.map((row) => row.id),
    monthKey
  );
  return people.map((person) =>
    withMonthTotals(person, monthKey, payrollMap.get(Number(person.id)))
  );
}

async function listStaffPayroll(req, res) {
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const monthKey = parseMonth(req.query.month);
    const employees = await loadMonthReport(monthKey);
    return res.json({
      month: monthKey,
      month_label: monthLabel(monthKey),
      today: karachiToday(),
      employees,
    });
  } catch (err) {
    console.error('listStaffPayroll error:', err);
    return res.status(500).json({ message: 'Server error loading salary details.' });
  }
}

async function getEmployeePayroll(req, res) {
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const user = await loadLowerStaff(Number(req.params.id));
    if (!user) return res.status(404).json({ message: 'Subordinate staff record not found.' });
    const current = karachiMonth();
    const fromMonth = addMonths(current, -11);
    const { rows: lastInstallment } = await pool.query(
      `
        SELECT MAX(month_key) AS last_month
        FROM staff_loan_installments
        WHERE user_id = $1
      `,
      [user.id]
    );
    let throughMonth = current;
    const lastLoanMonth = lastInstallment[0]?.last_month;
    if (lastLoanMonth && compareMonth(lastLoanMonth, throughMonth) > 0) {
      throughMonth = lastLoanMonth;
    }
    const detail = await employeePayrollDetail(user, fromMonth, throughMonth);
    const thisMonth = detail.months.find((row) => row.month_key === current) || {
      remaining: remainingForMonth(user.salary, 0, 0),
    };
    return res.json({
      ...detail,
      today: karachiToday(),
      current_month: current,
      remaining_this_month: thisMonth.remaining,
    });
  } catch (err) {
    console.error('getEmployeePayroll error:', err);
    return res.status(500).json({ message: 'Server error loading salary details.' });
  }
}

async function createAdvance(req, res) {
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const user = await loadLowerStaff(Number(req.params.id));
    if (!user) return res.status(404).json({ message: 'Subordinate staff record not found.' });

    const amount = money(req.body?.amount);
    const paidOn = isDateKey(req.body?.paid_on) ? String(req.body.paid_on).slice(0, 10) : karachiToday();
    if (!(amount > 0)) {
      return res.status(400).json({ message: 'Enter an advance amount greater than 0.' });
    }

    const monthKey = monthFromDate(paidOn);
    const { rows } = await pool.query(
      `
        INSERT INTO staff_salary_advances (user_id, amount, paid_on, month_key, created_by)
        VALUES ($1, $2, $3::date, $4, $5)
        RETURNING id, amount, paid_on::text AS paid_on, month_key, created_at
      `,
      [user.id, amount, paidOn, monthKey, req.user.id]
    );

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'staff_advance_created',
        targetTable: 'staff_salary_advances',
        targetId: rows[0].id,
        reason: `Advance ${amount} for ${user.name} on ${paidOn}`,
      });
    } catch (auditErr) {
      console.warn('staff_advance_created audit failed:', auditErr.message || auditErr);
    }

    return res.status(201).json({
      message: `Advance of ${amount.toLocaleString('en-PK')} saved for ${monthLabel(monthKey)}.`,
      advance: {
        ...rows[0],
        amount,
        paid_on: paidOn,
        month_label: monthLabel(monthKey),
      },
    });
  } catch (err) {
    console.error('createAdvance error:', err);
    return res.status(500).json({ message: 'Server error saving advance salary.' });
  }
}

async function deleteAdvance(req, res) {
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const user = await loadLowerStaff(Number(req.params.id));
    if (!user) return res.status(404).json({ message: 'Subordinate staff record not found.' });
    const { rows } = await pool.query(
      `
        DELETE FROM staff_salary_advances
        WHERE id = $1 AND user_id = $2
        RETURNING id, amount, paid_on
      `,
      [req.params.advanceId, user.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Advance not found.' });
    return res.json({ message: 'Advance removed.' });
  } catch (err) {
    console.error('deleteAdvance error:', err);
    return res.status(500).json({ message: 'Server error removing advance.' });
  }
}

async function createLoan(req, res) {
  const client = await pool.connect();
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const user = await loadLowerStaff(Number(req.params.id));
    if (!user) return res.status(404).json({ message: 'Subordinate staff record not found.' });

    const amount = money(req.body?.amount);
    const installments = Math.floor(Number(req.body?.installments));
    const startMonth = isMonthKey(req.body?.start_month)
      ? String(req.body.start_month).slice(0, 7)
      : karachiMonth();
    if (!(amount > 0)) {
      return res.status(400).json({ message: 'Enter a loan amount greater than 0.' });
    }
    if (!Number.isFinite(installments) || installments < 1 || installments > 36) {
      return res.status(400).json({ message: 'Installments must be between 1 and 36.' });
    }

    const parts = splitInstallments(amount, installments);
    const monthlyAmount = parts[0];

    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        INSERT INTO staff_loans (user_id, amount, installments, monthly_amount, start_month, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, amount, installments, monthly_amount, start_month, created_at
      `,
      [user.id, amount, installments, monthlyAmount, startMonth, req.user.id]
    );
    const loan = rows[0];
    for (let i = 0; i < parts.length; i += 1) {
      await client.query(
        `
          INSERT INTO staff_loan_installments (loan_id, user_id, month_key, amount)
          VALUES ($1, $2, $3, $4)
        `,
        [loan.id, user.id, addMonths(startMonth, i), parts[i]]
      );
    }
    await client.query('COMMIT');

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'staff_loan_created',
        targetTable: 'staff_loans',
        targetId: loan.id,
        reason: `Loan ${amount} in ${installments} installments for ${user.name}`,
      });
    } catch (auditErr) {
      console.warn('staff_loan_created audit failed:', auditErr.message || auditErr);
    }

    return res.status(201).json({
      message: `Loan of ${amount.toLocaleString('en-PK')} saved. ${monthlyAmount.toLocaleString(
        'en-PK'
      )} per month for ${installments} months.`,
      loan: {
        ...loan,
        amount,
        monthly_amount: monthlyAmount,
        start_month_label: monthLabel(startMonth),
        schedule: parts.map((part, index) => ({
          month_key: addMonths(startMonth, index),
          month_label: monthLabel(addMonths(startMonth, index)),
          amount: part,
        })),
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('createLoan error:', err);
    return res.status(500).json({ message: 'Server error saving loan.' });
  } finally {
    client.release();
  }
}

async function deleteLoan(req, res) {
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const user = await loadLowerStaff(Number(req.params.id));
    if (!user) return res.status(404).json({ message: 'Subordinate staff record not found.' });
    const { rows } = await pool.query(
      `
        DELETE FROM staff_loans
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `,
      [req.params.loanId, user.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Loan not found.' });
    return res.json({ message: 'Loan removed.' });
  } catch (err) {
    console.error('deleteLoan error:', err);
    return res.status(500).json({ message: 'Server error removing loan.' });
  }
}

async function exportStaffPayroll(req, res) {
  try {
    if (denyUnlessHr(req, res)) return;
    await ensurePayrollTables();
    const format = String(req.query.format || 'xlsx').trim().toLowerCase();
    if (format !== 'xlsx' && format !== 'excel' && format !== 'pdf') {
      return res.status(400).json({ message: 'format must be xlsx or pdf.' });
    }
    const monthKey = parseMonth(req.query.month);
    const employees = await loadMonthReport(monthKey);

    const details = [];
    for (const person of employees) {
      if (person.has_advance) {
        details.push({
          name: person.name,
          kind: 'Advance',
          date: person.month_label,
          amount: person.advance_amount.toLocaleString('en-PK'),
          extra: `${person.advance_count} advance${person.advance_count === 1 ? '' : 's'} this month`,
        });
      }
      if (person.has_loan || person.open_loans) {
        details.push({
          name: person.name,
          kind: 'Loan',
          date: person.month_label,
          amount: person.loan_amount.toLocaleString('en-PK'),
          extra: person.open_loans
            ? `${person.open_loans} open loan${person.open_loans === 1 ? '' : 's'}`
            : 'Loan installment this month',
        });
      }
    }

    const { rows: actorRows } = await pool.query(
      `SELECT name, username FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const generatedBy =
      String(actorRows[0]?.name || actorRows[0]?.username || '').trim() || 'Unknown';
    const filenameBase = buildPayrollBaseName(monthKey);
    const meta = {
      title: 'Textured Lab Subordinate Staff Salary',
      month: monthLabel(monthKey),
      monthKey,
      generatedAt: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
      generatedBy,
    };

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'staff_payroll_exported',
        targetTable: 'staff_salary_advances',
        targetId: req.user.id,
        reason: `${format.toUpperCase()} subordinate salary · ${employees.length} records · ${monthKey}`,
      });
    } catch (auditErr) {
      console.warn('staff_payroll_exported audit failed:', auditErr.message || auditErr);
    }

    if (format === 'pdf') {
      const pdfName = `${filenameBase}.pdf`;
      const buffer = await buildPayrollPdf(employees, meta);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', attachmentDisposition(pdfName));
      res.setHeader('X-Export-Filename', pdfName);
      return res.send(buffer);
    }

    const excelName = `${filenameBase}.xls`;
    const xml = buildPayrollExcelXml(employees, details, meta);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentDisposition(excelName));
    res.setHeader('X-Export-Filename', excelName);
    return res.send(xml);
  } catch (err) {
    console.error('exportStaffPayroll error:', err);
    const detail = String(err?.message || err || '').trim();
    return res.status(500).json({
      message: detail
        ? `Server error exporting salary report: ${detail}`
        : 'Server error exporting salary report.',
    });
  }
}

module.exports = {
  listStaffPayroll,
  getEmployeePayroll,
  createAdvance,
  deleteAdvance,
  createLoan,
  deleteLoan,
  exportStaffPayroll,
};
