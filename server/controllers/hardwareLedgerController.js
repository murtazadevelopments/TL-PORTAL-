const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { ensureHardwareLedgerSchema } = require('../utils/ensureHardwareLedgerSchema');
const {
  isCeoOrManagerRole,
  loadAdminPermissionAccess,
} = require('../middleware/permissions');
const { isMonthKey, isDateKey, monthLabel, karachiMonth } = require('../utils/staffPayroll');

const HARDWARE_LEDGER_KEY = 'hardware:ledger';
const RECORD_KINDS = new Set(['total', 'paid']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return round2(n);
}

/**
 * Client sends a full ISO timestamp (with timezone) so the saved moment is exact.
 * Plain datetime-local values are still accepted as a fallback.
 */
function parseOccurredAt(raw) {
  if (raw == null || String(raw).trim() === '') return new Date();
  const s = String(raw).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseMonth(value) {
  const key = String(value || '').trim().slice(0, 7);
  return isMonthKey(key) ? key : karachiMonth();
}

function monthFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return karachiMonth();
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7);
}

function summaryFrom(totalAmount, paidAmount) {
  const total = round2(totalAmount);
  const paid = round2(paidAmount);
  return {
    total_amount: total,
    paid_amount: paid,
    pending_amount: round2(total - paid),
  };
}

function pendingOnly(amount) {
  return Math.max(0, round2(amount));
}

function mapVendor(row) {
  const month = summaryFrom(row.total_amount, row.paid_amount);
  const priorTotal = Number(row.prior_total_amount || 0);
  const priorPaid = Number(row.prior_paid_amount || 0);
  const priorPending = pendingOnly(priorTotal - priorPaid);
  // Whole amount still owed through the selected month (never negative).
  const overallPending = pendingOnly(
    priorTotal + month.total_amount - (priorPaid + month.paid_amount)
  );
  return {
    id: Number(row.id),
    name: row.name || '',
    created_at: row.created_at,
    record_count: row.record_count != null ? Number(row.record_count) : undefined,
    total_amount: month.total_amount,
    paid_amount: month.paid_amount,
    month_pending_amount: month.pending_amount,
    prior_pending_amount: priorPending,
    pending_amount: overallPending,
  };
}

function mapRecord(row) {
  return {
    id: Number(row.id),
    vendor_id: Number(row.vendor_id),
    kind: row.kind,
    item: row.item || '',
    amount: round2(row.amount),
    occurred_at: row.occurred_at,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function userHasHardwareLedgerPermission(userId, role) {
  if (isCeoOrManagerRole(role)) return true;
  if (normalizeRole(role) !== 'admin') return false;
  const access = await loadAdminPermissionAccess(userId);
  return access.permissions.includes(HARDWARE_LEDGER_KEY);
}

async function assertAssignee(req, res) {
  const role = normalizeRole(req.user?.role);
  const ok = await userHasHardwareLedgerPermission(req.user.id, role);
  if (!ok) {
    res.status(403).json({
      message: 'Hardware ledger is only available to persons assigned this permission.',
    });
    return false;
  }
  return true;
}

const MONTH_EXPR = `to_char(r.occurred_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM')`;

function vendorSelectSql(monthParamIndex) {
  const monthParam = `$${monthParamIndex}`;
  return `
  SELECT
    v.id,
    v.name,
    v.created_at,
    COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total' AND ${MONTH_EXPR} = ${monthParam}), 0) AS total_amount,
    COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid' AND ${MONTH_EXPR} = ${monthParam}), 0) AS paid_amount,
    COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total' AND ${MONTH_EXPR} < ${monthParam}), 0) AS prior_total_amount,
    COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid' AND ${MONTH_EXPR} < ${monthParam}), 0) AS prior_paid_amount,
    COUNT(r.id) FILTER (WHERE ${MONTH_EXPR} = ${monthParam}) AS record_count
  FROM hardware_vendors v
  LEFT JOIN hardware_vendor_records r
    ON r.vendor_id = v.id
`;
}

async function loadPriorPendingMonths(vendorId, monthKey) {
  const { rows } = await pool.query(
    `
      SELECT
        ${MONTH_EXPR} AS month_key,
        COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
        COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount
      FROM hardware_vendor_records r
      WHERE r.vendor_id = $1
        AND ${MONTH_EXPR} < $2
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    [vendorId, monthKey]
  );
  return rows
    .map((row) => {
      const pending = pendingOnly(Number(row.total_amount) - Number(row.paid_amount));
      if (pending <= 0) return null;
      const label = monthLabel(row.month_key);
      return {
        month: row.month_key,
        month_label: label,
        pending_amount: pending,
        status: `That amount is pending for the month of ${label}.`,
      };
    })
    .filter(Boolean);
}

async function loadVendor(vendorId, monthKey) {
  const { rows } = await pool.query(
    `${vendorSelectSql(2)} WHERE v.id = $1 GROUP BY v.id`,
    [vendorId, monthKey]
  );
  return rows[0] ? mapVendor(rows[0]) : null;
}

async function listRecords(vendorId, monthKey) {
  const { rows } = await pool.query(
    `
      SELECT r.id, r.vendor_id, r.kind, r.item, r.amount, r.occurred_at,
             r.created_by, u.name AS created_by_name, r.created_at, r.updated_at
      FROM hardware_vendor_records r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.vendor_id = $1
        AND to_char(r.occurred_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM') = $2
      ORDER BY r.occurred_at DESC, r.id DESC
    `,
    [vendorId, monthKey]
  );
  return rows.map(mapRecord);
}

function buildVendorSummary(vendor) {
  return {
    total_amount: vendor.total_amount,
    paid_amount: vendor.paid_amount,
    month_pending_amount: vendor.month_pending_amount,
    prior_pending_amount: vendor.prior_pending_amount,
    pending_amount: vendor.pending_amount,
  };
}

async function vendorPayload(vendorId, monthKey) {
  const vendorRow = await pool.query(
    'SELECT id, name, created_at FROM hardware_vendors WHERE id = $1 LIMIT 1',
    [vendorId]
  );
  if (!vendorRow.rows[0]) return null;
  const vendor =
    (await loadVendor(vendorId, monthKey)) ||
    mapVendor({
      ...vendorRow.rows[0],
      total_amount: 0,
      paid_amount: 0,
      prior_total_amount: 0,
      prior_paid_amount: 0,
      record_count: 0,
    });
  const records = await listRecords(vendorId, monthKey);
  const prior_pending_months = await loadPriorPendingMonths(vendorId, monthKey);
  return {
    vendor,
    summary: buildVendorSummary(vendor),
    prior_pending_months,
    records,
    month: monthKey,
    month_label: monthLabel(monthKey),
  };
}

async function listVendors(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const monthKey = parseMonth(req.query.month);
    const { rows } = await pool.query(
      `${vendorSelectSql(1)} GROUP BY v.id ORDER BY LOWER(v.name) ASC, v.id ASC`,
      [monthKey]
    );
    const vendors = rows.map(mapVendor);
    const totals = vendors.reduce(
      (acc, v) => {
        acc.total += v.total_amount;
        acc.paid += v.paid_amount;
        acc.prior += v.prior_pending_amount;
        acc.monthPending += v.month_pending_amount;
        acc.pending += v.pending_amount;
        return acc;
      },
      { total: 0, paid: 0, prior: 0, monthPending: 0, pending: 0 }
    );
    return res.json({
      vendors,
      summary: {
        total_amount: round2(totals.total),
        paid_amount: round2(totals.paid),
        month_pending_amount: round2(totals.monthPending),
        prior_pending_amount: round2(totals.prior),
        pending_amount: round2(totals.pending),
      },
      month: monthKey,
      month_label: monthLabel(monthKey),
      can_remove_vendors: isCeoOrManagerRole(req.user?.role),
    });
  } catch (err) {
    console.error('hardware listVendors error:', err);
    return res.status(500).json({ message: 'Failed to load vendors.' });
  }
}

async function createVendor(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    if (!name) {
      return res.status(400).json({ message: 'Vendor name is required.' });
    }
    const { rows: existing } = await pool.query(
      'SELECT id FROM hardware_vendors WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [name]
    );
    if (existing[0]) {
      return res.status(409).json({ message: 'A vendor with this name already exists.' });
    }
    const monthKey = parseMonth(req.body?.month || req.query?.month);
    const { rows } = await pool.query(
      `
        INSERT INTO hardware_vendors (name, created_by)
        VALUES ($1, $2)
        RETURNING id
      `,
      [name, req.user.id]
    );
    const vendor = await loadVendor(Number(rows[0].id), monthKey);
    return res.status(201).json({ vendor, message: 'Vendor added.', month: monthKey });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ message: 'A vendor with this name already exists.' });
    }
    console.error('hardware createVendor error:', err);
    return res.status(500).json({ message: 'Failed to add vendor.' });
  }
}

async function getVendor(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const vendorId = parseId(req.params.vendorId);
    if (!vendorId) return res.status(400).json({ message: 'Invalid vendor.' });
    const monthKey = parseMonth(req.query.month);
    const payload = await vendorPayload(vendorId, monthKey);
    if (!payload) return res.status(404).json({ message: 'Vendor not found.' });
    return res.json({
      ...payload,
      can_remove_vendor: isCeoOrManagerRole(req.user?.role),
    });
  } catch (err) {
    console.error('hardware getVendor error:', err);
    return res.status(500).json({ message: 'Failed to load vendor.' });
  }
}

async function deleteVendor(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    if (!isCeoOrManagerRole(req.user?.role)) {
      return res.status(403).json({
        message: 'Only CEO or manager can remove vendors.',
      });
    }

    const password = String(req.body?.password ?? req.body?.current_password ?? '');
    if (!password) {
      return res.status(400).json({
        message: 'Enter your account password to remove this vendor.',
      });
    }

    const { rows: authRows } = await pool.query(
      'SELECT id, password FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    const authUser = authRows[0];
    if (!authUser?.password) {
      return res.status(401).json({ message: 'Could not verify your account.' });
    }
    const passwordOk = await bcrypt.compare(password, authUser.password);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Account password is incorrect.' });
    }

    const vendorId = parseId(req.params.vendorId);
    if (!vendorId) return res.status(400).json({ message: 'Invalid vendor.' });

    const { rows } = await pool.query(
      'DELETE FROM hardware_vendors WHERE id = $1 RETURNING id, name',
      [vendorId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Vendor not found.' });

    return res.json({
      message: `Vendor “${rows[0].name}” removed.`,
      vendor_id: Number(rows[0].id),
    });
  } catch (err) {
    console.error('hardware deleteVendor error:', err);
    return res.status(500).json({ message: 'Failed to remove vendor.' });
  }
}

function parseRecordBody(body) {
  const kind = String(body?.kind || '').trim().toLowerCase();
  const item = String(body?.item || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const amount = parseAmount(body?.amount);
  const occurredAt = parseOccurredAt(body?.occurred_at || body?.occurredAt);
  if (!RECORD_KINDS.has(kind)) return { error: 'Choose Total amount or Paid amount.' };
  if (kind === 'total' && !item) return { error: 'Item is required.' };
  if (amount == null) return { error: 'Enter an amount greater than 0.' };
  if (!occurredAt) return { error: 'Enter a valid date and time.' };
  return { kind, item, amount, occurredAt };
}

function resolveViewMonth(req, occurredAt) {
  // Prefer the record's own Karachi month so newly saved items stay visible.
  if (occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime())) {
    return monthFromDate(occurredAt);
  }
  return parseMonth(req.body?.month || req.query?.month);
}

async function createRecord(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const vendorId = parseId(req.params.vendorId);
    if (!vendorId) return res.status(400).json({ message: 'Invalid vendor.' });
    const parsed = parseRecordBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const { rows: vendorRows } = await pool.query(
      'SELECT id FROM hardware_vendors WHERE id = $1 LIMIT 1',
      [vendorId]
    );
    if (!vendorRows[0]) return res.status(404).json({ message: 'Vendor not found.' });

    await pool.query(
      `
        INSERT INTO hardware_vendor_records
          (vendor_id, kind, item, amount, occurred_at, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        vendorId,
        parsed.kind,
        parsed.item,
        parsed.amount,
        parsed.occurredAt.toISOString(),
        req.user.id,
      ]
    );
    const monthKey = resolveViewMonth(req, parsed.occurredAt);
    const payload = await vendorPayload(vendorId, monthKey);
    return res.status(201).json({
      ...payload,
      message: parsed.kind === 'paid' ? 'Paid amount saved.' : 'Item added.',
      can_remove_vendor: isCeoOrManagerRole(req.user?.role),
    });
  } catch (err) {
    console.error('hardware createRecord error:', err);
    return res.status(500).json({ message: 'Failed to save record.' });
  }
}

async function updateRecord(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const vendorId = parseId(req.params.vendorId);
    const recordId = parseId(req.params.recordId);
    if (!vendorId || !recordId) return res.status(400).json({ message: 'Invalid record.' });
    const parsed = parseRecordBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const { rowCount } = await pool.query(
      `
        UPDATE hardware_vendor_records
        SET kind = $3, item = $4, amount = $5, occurred_at = $6, updated_at = NOW()
        WHERE id = $1 AND vendor_id = $2
      `,
      [
        recordId,
        vendorId,
        parsed.kind,
        parsed.item,
        parsed.amount,
        parsed.occurredAt.toISOString(),
      ]
    );
    if (!rowCount) return res.status(404).json({ message: 'Record not found.' });
    const monthKey = resolveViewMonth(req, parsed.occurredAt);
    const payload = await vendorPayload(vendorId, monthKey);
    return res.json({
      ...payload,
      message: 'Record updated.',
      can_remove_vendor: isCeoOrManagerRole(req.user?.role),
    });
  } catch (err) {
    console.error('hardware updateRecord error:', err);
    return res.status(500).json({ message: 'Failed to update record.' });
  }
}

async function deleteRecord(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const vendorId = parseId(req.params.vendorId);
    const recordId = parseId(req.params.recordId);
    if (!vendorId || !recordId) return res.status(400).json({ message: 'Invalid record.' });
    const monthKey = parseMonth(req.query.month || req.body?.month);
    const { rowCount } = await pool.query(
      'DELETE FROM hardware_vendor_records WHERE id = $1 AND vendor_id = $2',
      [recordId, vendorId]
    );
    if (!rowCount) return res.status(404).json({ message: 'Record not found.' });
    const payload = await vendorPayload(vendorId, monthKey);
    return res.json({
      ...payload,
      message: 'Record removed.',
      can_remove_vendor: isCeoOrManagerRole(req.user?.role),
    });
  } catch (err) {
    console.error('hardware deleteRecord error:', err);
    return res.status(500).json({ message: 'Failed to remove record.' });
  }
}

function parseStatementRange(query) {
  const mode = String(query?.mode || 'month').trim().toLowerCase();
  if (mode === 'year') {
    const fromYear = String(query?.from || '').trim().slice(0, 4);
    const toYear = String(query?.to || '').trim().slice(0, 4);
    if (!/^\d{4}$/.test(fromYear) || !/^\d{4}$/.test(toYear)) {
      return { error: 'Enter valid from/to years (YYYY).' };
    }
    if (fromYear > toYear) {
      return { error: 'From year must be on or before to year.' };
    }
    return {
      mode: 'year',
      from: fromYear,
      to: toYear,
      label: `${fromYear} to ${toYear}`,
      sql: `${MONTH_EXPR} >= $FROM AND ${MONTH_EXPR} <= $TO`,
      params: [`${fromYear}-01`, `${toYear}-12`],
    };
  }
  if (mode === 'date') {
    const fromDate = String(query?.from || '').trim().slice(0, 10);
    const toDate = String(query?.to || '').trim().slice(0, 10);
    if (!isDateKey(fromDate) || !isDateKey(toDate)) {
      return { error: 'Enter valid from/to dates (YYYY-MM-DD).' };
    }
    if (fromDate > toDate) {
      return { error: 'From date must be on or before to date.' };
    }
    return {
      mode: 'date',
      from: fromDate,
      to: toDate,
      label: `${fromDate} to ${toDate}`,
      sql: `(r.occurred_at AT TIME ZONE 'Asia/Karachi')::date >= $FROM::date
            AND (r.occurred_at AT TIME ZONE 'Asia/Karachi')::date <= $TO::date`,
      params: [fromDate, toDate],
    };
  }

  const fromMonth = String(query?.from || '').trim().slice(0, 7);
  const toMonth = String(query?.to || '').trim().slice(0, 7);
  if (!isMonthKey(fromMonth) || !isMonthKey(toMonth)) {
    return { error: 'Enter valid from/to months (YYYY-MM).' };
  }
  if (fromMonth > toMonth) {
    return { error: 'From month must be on or before to month.' };
  }
  return {
    mode: 'month',
    from: fromMonth,
    to: toMonth,
    label: `${monthLabel(fromMonth)} to ${monthLabel(toMonth)}`,
    sql: `${MONTH_EXPR} >= $FROM AND ${MONTH_EXPR} <= $TO`,
    params: [fromMonth, toMonth],
  };
}

function applyRangePlaceholders(sql, fromIndex) {
  return String(sql || '')
    .replaceAll('$FROM', `$${fromIndex}`)
    .replaceAll('$TO', `$${fromIndex + 1}`);
}

async function loadOpeningPrior({ vendorId = null, range }) {
  const vendorFilter = vendorId ? 'r.vendor_id = $1 AND' : '';
  const params = vendorId ? [vendorId] : [];
  if (range.mode === 'month' || range.mode === 'year') {
    const beforeKey = range.mode === 'year' ? `${range.from}-01` : range.from;
    params.push(beforeKey);
    const beforeIdx = params.length;
    const { rows } = await pool.query(
      `
        SELECT
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount
        FROM hardware_vendor_records r
        WHERE ${vendorFilter} ${MONTH_EXPR} < $${beforeIdx}
      `,
      params
    );
    return pendingOnly(Number(rows[0]?.total_amount || 0) - Number(rows[0]?.paid_amount || 0));
  }
  params.push(range.from);
  const beforeIdx = params.length;
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
        COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount
      FROM hardware_vendor_records r
      WHERE ${vendorFilter}
        (r.occurred_at AT TIME ZONE 'Asia/Karachi')::date < $${beforeIdx}::date
    `,
    params
  );
  return pendingOnly(Number(rows[0]?.total_amount || 0) - Number(rows[0]?.paid_amount || 0));
}

/**
 * GET /api/hardware-ledger/vendors/:vendorId/statement
 * Query: mode=month|year|date, from=, to=
 */
async function getVendorStatement(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const vendorId = parseId(req.params.vendorId);
    if (!vendorId) return res.status(400).json({ message: 'Invalid vendor.' });

    const { rows: vendorRows } = await pool.query(
      'SELECT id, name, created_at FROM hardware_vendors WHERE id = $1 LIMIT 1',
      [vendorId]
    );
    if (!vendorRows[0]) return res.status(404).json({ message: 'Vendor not found.' });

    const range = parseStatementRange(req.query);
    if (range.error) return res.status(400).json({ message: range.error });
    const rangeSql = applyRangePlaceholders(range.sql, 2);

    const { rows: recordRows } = await pool.query(
      `
        SELECT r.id, r.vendor_id, r.kind, r.item, r.amount, r.occurred_at,
               r.created_by, u.name AS created_by_name, r.created_at, r.updated_at,
               ${MONTH_EXPR} AS month_key
        FROM hardware_vendor_records r
        LEFT JOIN users u ON u.id = r.created_by
        WHERE r.vendor_id = $1
          AND ${rangeSql}
        ORDER BY r.occurred_at ASC, r.id ASC
      `,
      [vendorId, ...range.params]
    );
    const records = recordRows.map((row) => ({
      ...mapRecord(row),
      month: row.month_key,
      month_label: monthLabel(row.month_key),
    }));

    const { rows: monthRows } = await pool.query(
      `
        SELECT
          ${MONTH_EXPR} AS month_key,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount
        FROM hardware_vendor_records r
        WHERE r.vendor_id = $1
          AND ${rangeSql}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      [vendorId, ...range.params]
    );

    const openingPrior = await loadOpeningPrior({ vendorId, range });

    const months = monthRows.map((row) => {
      const monthSummary = summaryFrom(row.total_amount, row.paid_amount);
      const label = monthLabel(row.month_key);
      return {
        month: row.month_key,
        month_label: label,
        ...monthSummary,
        status:
          monthSummary.pending_amount > 0
            ? `That amount is pending for the month of ${label}.`
            : null,
      };
    });

    const rangeTotal = round2(months.reduce((sum, m) => sum + m.total_amount, 0));
    const rangePaid = round2(months.reduce((sum, m) => sum + m.paid_amount, 0));
    const rangePending = round2(rangeTotal - rangePaid);
    const closingPending = round2(openingPrior + rangePending);

    return res.json({
      vendor: {
        id: Number(vendorRows[0].id),
        name: vendorRows[0].name || '',
        created_at: vendorRows[0].created_at,
      },
      mode: range.mode,
      from: range.from,
      to: range.to,
      range_label: range.label,
      generated_at: new Date().toISOString(),
      opening_prior_pending: openingPrior,
      months,
      records,
      summary: {
        total_amount: rangeTotal,
        paid_amount: rangePaid,
        range_pending_amount: rangePending,
        prior_pending_amount: openingPrior,
        pending_amount: closingPending,
      },
    });
  } catch (err) {
    console.error('hardware getVendorStatement error:', err);
    return res.status(500).json({ message: 'Failed to generate statement.' });
  }
}

/**
 * GET /api/hardware-ledger/statement
 * All-vendors statement. Query: mode=month|year|date, from=, to=
 */
async function getLedgerStatement(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;

    const range = parseStatementRange(req.query);
    if (range.error) return res.status(400).json({ message: range.error });
    const rangeSql = applyRangePlaceholders(range.sql, 1);

    const { rows: vendorRows } = await pool.query(
      `
        SELECT
          v.id,
          v.name,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount
        FROM hardware_vendors v
        LEFT JOIN hardware_vendor_records r
          ON r.vendor_id = v.id
         AND ${rangeSql}
        GROUP BY v.id
        ORDER BY LOWER(v.name) ASC, v.id ASC
      `,
      range.params
    );

    const openingPrior = await loadOpeningPrior({ range });

    const vendors = [];
    for (const row of vendorRows) {
      const monthSummary = summaryFrom(row.total_amount, row.paid_amount);
      const vendorPrior = await loadOpeningPrior({ vendorId: Number(row.id), range });
      const overallPending = round2(vendorPrior + monthSummary.pending_amount);
      vendors.push({
        id: Number(row.id),
        name: row.name || '',
        total_amount: monthSummary.total_amount,
        paid_amount: monthSummary.paid_amount,
        month_pending_amount: monthSummary.pending_amount,
        prior_pending_amount: vendorPrior,
        pending_amount: overallPending,
        status:
          vendorPrior > 0
            ? `Prior unpaid ${vendorPrior.toFixed(2)} carried into this statement range.`
            : monthSummary.pending_amount > 0
              ? `Pending amount in selected range: ${monthSummary.pending_amount.toFixed(2)}.`
              : null,
      });
    }

    const { rows: monthRows } = await pool.query(
      `
        SELECT
          ${MONTH_EXPR} AS month_key,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
          COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount
        FROM hardware_vendor_records r
        WHERE ${rangeSql}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      range.params
    );

    const months = monthRows.map((row) => {
      const monthSummary = summaryFrom(row.total_amount, row.paid_amount);
      const label = monthLabel(row.month_key);
      return {
        month: row.month_key,
        month_label: label,
        ...monthSummary,
        status:
          monthSummary.pending_amount > 0
            ? `That amount is pending for the month of ${label}.`
            : null,
      };
    });

    const { rows: recordRows } = await pool.query(
      `
        SELECT r.id, r.vendor_id, v.name AS vendor_name, r.kind, r.item, r.amount, r.occurred_at,
               r.created_by, u.name AS created_by_name, r.created_at, r.updated_at,
               ${MONTH_EXPR} AS month_key
        FROM hardware_vendor_records r
        JOIN hardware_vendors v ON v.id = r.vendor_id
        LEFT JOIN users u ON u.id = r.created_by
        WHERE ${rangeSql}
        ORDER BY r.occurred_at ASC, r.id ASC
      `,
      range.params
    );
    const records = recordRows.map((row) => ({
      ...mapRecord(row),
      vendor_name: row.vendor_name || '',
      month: row.month_key,
      month_label: monthLabel(row.month_key),
    }));

    const rangeTotal = round2(vendors.reduce((sum, v) => sum + v.total_amount, 0));
    const rangePaid = round2(vendors.reduce((sum, v) => sum + v.paid_amount, 0));
    const rangePending = round2(rangeTotal - rangePaid);
    const closingPending = round2(openingPrior + rangePending);

    return res.json({
      mode: range.mode,
      from: range.from,
      to: range.to,
      range_label: range.label,
      generated_at: new Date().toISOString(),
      opening_prior_pending: openingPrior,
      vendors,
      months,
      records,
      summary: {
        total_amount: rangeTotal,
        paid_amount: rangePaid,
        range_pending_amount: rangePending,
        prior_pending_amount: openingPrior,
        pending_amount: closingPending,
      },
    });
  } catch (err) {
    console.error('hardware getLedgerStatement error:', err);
    return res.status(500).json({ message: 'Failed to generate statement.' });
  }
}

module.exports = {
  listVendors,
  createVendor,
  getVendor,
  deleteVendor,
  createRecord,
  updateRecord,
  deleteRecord,
  getVendorStatement,
  getLedgerStatement,
};
