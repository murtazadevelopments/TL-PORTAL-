const pool = require('../config/db');
const { ensureHardwareLedgerSchema } = require('../utils/ensureHardwareLedgerSchema');
const {
  isCeoOrManagerRole,
  loadAdminPermissionAccess,
} = require('../middleware/permissions');

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

function summaryFrom(totalAmount, paidAmount) {
  const total = round2(totalAmount);
  const paid = round2(paidAmount);
  return {
    total_amount: total,
    paid_amount: paid,
    pending_amount: round2(total - paid),
  };
}

function mapVendor(row) {
  return {
    id: Number(row.id),
    name: row.name || '',
    created_at: row.created_at,
    record_count: row.record_count != null ? Number(row.record_count) : undefined,
    ...summaryFrom(row.total_amount, row.paid_amount),
  };
}

function mapRecord(row) {
  return {
    id: Number(row.id),
    vendor_id: Number(row.vendor_id),
    kind: row.kind,
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

const VENDOR_SELECT = `
  SELECT
    v.id,
    v.name,
    v.created_at,
    COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'total'), 0) AS total_amount,
    COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'paid'), 0) AS paid_amount,
    COUNT(r.id) AS record_count
  FROM hardware_vendors v
  LEFT JOIN hardware_vendor_records r ON r.vendor_id = v.id
`;

async function loadVendor(vendorId) {
  const { rows } = await pool.query(
    `${VENDOR_SELECT} WHERE v.id = $1 GROUP BY v.id`,
    [vendorId]
  );
  return rows[0] ? mapVendor(rows[0]) : null;
}

async function listRecords(vendorId) {
  const { rows } = await pool.query(
    `
      SELECT r.id, r.vendor_id, r.kind, r.amount, r.occurred_at,
             r.created_by, u.name AS created_by_name, r.created_at, r.updated_at
      FROM hardware_vendor_records r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.vendor_id = $1
      ORDER BY r.occurred_at DESC, r.id DESC
    `,
    [vendorId]
  );
  return rows.map(mapRecord);
}

async function vendorPayload(vendorId) {
  const vendor = await loadVendor(vendorId);
  if (!vendor) return null;
  const records = await listRecords(vendorId);
  return {
    vendor,
    summary: summaryFrom(vendor.total_amount, vendor.paid_amount),
    records,
  };
}

async function listVendors(req, res) {
  try {
    await ensureHardwareLedgerSchema();
    if (!(await assertAssignee(req, res))) return;
    const { rows } = await pool.query(
      `${VENDOR_SELECT} GROUP BY v.id ORDER BY LOWER(v.name) ASC, v.id ASC`
    );
    const vendors = rows.map(mapVendor);
    const totals = vendors.reduce(
      (acc, v) => {
        acc.total += v.total_amount;
        acc.paid += v.paid_amount;
        return acc;
      },
      { total: 0, paid: 0 }
    );
    return res.json({ vendors, summary: summaryFrom(totals.total, totals.paid) });
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
    const { rows } = await pool.query(
      `
        INSERT INTO hardware_vendors (name, created_by)
        VALUES ($1, $2)
        RETURNING id
      `,
      [name, req.user.id]
    );
    const vendor = await loadVendor(Number(rows[0].id));
    return res.status(201).json({ vendor, message: 'Vendor added.' });
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
    const payload = await vendorPayload(vendorId);
    if (!payload) return res.status(404).json({ message: 'Vendor not found.' });
    return res.json(payload);
  } catch (err) {
    console.error('hardware getVendor error:', err);
    return res.status(500).json({ message: 'Failed to load vendor.' });
  }
}

function parseRecordBody(body) {
  const kind = String(body?.kind || '').trim().toLowerCase();
  const amount = parseAmount(body?.amount);
  const occurredAt = parseOccurredAt(body?.occurred_at || body?.occurredAt);
  if (!RECORD_KINDS.has(kind)) return { error: 'Choose Total amount or Paid amount.' };
  if (amount == null) return { error: 'Enter an amount greater than 0.' };
  if (!occurredAt) return { error: 'Enter a valid date and time.' };
  return { kind, amount, occurredAt };
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
        INSERT INTO hardware_vendor_records (vendor_id, kind, amount, occurred_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [vendorId, parsed.kind, parsed.amount, parsed.occurredAt.toISOString(), req.user.id]
    );
    const payload = await vendorPayload(vendorId);
    return res.status(201).json({
      ...payload,
      message: parsed.kind === 'paid' ? 'Paid amount saved.' : 'Total amount saved.',
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
        SET kind = $3, amount = $4, occurred_at = $5, updated_at = NOW()
        WHERE id = $1 AND vendor_id = $2
      `,
      [recordId, vendorId, parsed.kind, parsed.amount, parsed.occurredAt.toISOString()]
    );
    if (!rowCount) return res.status(404).json({ message: 'Record not found.' });
    const payload = await vendorPayload(vendorId);
    return res.json({ ...payload, message: 'Record updated.' });
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
    const { rowCount } = await pool.query(
      'DELETE FROM hardware_vendor_records WHERE id = $1 AND vendor_id = $2',
      [recordId, vendorId]
    );
    if (!rowCount) return res.status(404).json({ message: 'Record not found.' });
    const payload = await vendorPayload(vendorId);
    return res.json({ ...payload, message: 'Record removed.' });
  } catch (err) {
    console.error('hardware deleteRecord error:', err);
    return res.status(500).json({ message: 'Failed to remove record.' });
  }
}

module.exports = {
  listVendors,
  createVendor,
  getVendor,
  createRecord,
  updateRecord,
  deleteRecord,
};
