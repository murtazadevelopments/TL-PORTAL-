const path = require('path');
const { randomUUID } = require('crypto');
const fsp = require('fs/promises');
const pool = require('../config/db');
const { ensurePettyCashSchema } = require('../utils/ensurePettyCashSchema');
const {
  isCeoOrManagerRole,
  loadAdminPermissionAccess,
} = require('../middleware/permissions');
const {
  writeRelativeFile,
  absoluteFromRelative,
  deleteRelativeFile,
  prepareFileBuffer,
} = require('../services/localStorage');
const { extFromFile } = require('../middleware/uploadMiddleware');
const {
  monthLabel,
  buildPettyCashBaseName,
  buildPettyCashExcelXml,
  buildPettyCashPdf,
} = require('../utils/pettyCashExportFiles');

const PETTY_CASH_KEY = 'petty:cash';

function karachiMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7);
}

function isMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ''));
}

function parseMonth(value) {
  const key = String(value || '').slice(0, 7);
  return isMonthKey(key) ? key : karachiMonth();
}

function attachmentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

function parsePrice(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parseQuantity(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parseTotalAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Amount to add onto the fund total; must be > 0. */
function parseAddAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function mapFundAddition(row) {
  return {
    id: Number(row.id),
    owner_user_id: Number(row.owner_user_id),
    amount: Math.round((Number(row.amount) || 0) * 100) / 100,
    occurred_at: row.occurred_at || row.created_at || null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: row.created_at,
  };
}

/** Accepts datetime-local (YYYY-MM-DDTHH:mm) or ISO; defaults to now. */
function parseOccurredAt(raw) {
  if (raw == null || String(raw).trim() === '') return new Date();
  const s = String(raw).trim();
  const normalized =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)
      ? `${s}:00`
      : /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? `${s}T12:00:00`
        : s;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function mapEntry(row) {
  const price = Number(row.price) || 0;
  const quantity = row.quantity != null ? Number(row.quantity) : null;
  return {
    id: Number(row.id),
    owner_user_id: Number(row.owner_user_id),
    item_name: row.item_name || '',
    price,
    quantity,
    branch: row.branch || '',
    person_name: row.person_name || '',
    amount: Math.round(price * 100) / 100,
    occurred_at: row.occurred_at || row.created_at || null,
    has_receipt: Boolean(row.receipt_path),
    receipt_mime: row.receipt_mime || null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function summarize(entries, fundTotal = 0) {
  const used = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const total = Math.round((Number(fundTotal) || 0) * 100) / 100;
  const usedAmount = Math.round(used * 100) / 100;
  const pendingAmount = Math.round((total - usedAmount) * 100) / 100;
  return {
    total_amount: total,
    used_amount: usedAmount,
    pending_amount: pendingAmount,
    items_amount: usedAmount,
    count: entries.length,
  };
}

async function userHasPettyCashPermission(userId, role) {
  if (isCeoOrManagerRole(role)) return false;
  if (normalizeRole(role) !== 'admin') return false;
  const access = await loadAdminPermissionAccess(userId);
  return access.permissions.includes(PETTY_CASH_KEY);
}

async function loadOwnerProfile(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, name, username, employee_id, role
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function listEntriesForOwner(ownerUserId, monthKey = null) {
  const params = [ownerUserId];
  let monthFilter = '';
  if (monthKey && isMonthKey(monthKey)) {
    params.push(monthKey);
    monthFilter = `
      AND to_char(
        COALESCE(occurred_at, created_at) AT TIME ZONE 'Asia/Karachi',
        'YYYY-MM'
      ) = $2
    `;
  }
  const { rows } = await pool.query(
    `
      SELECT id, owner_user_id, item_name, price, quantity, branch, person_name,
             occurred_at, receipt_path, receipt_mime, created_by, created_at, updated_at
      FROM petty_cash_entries
      WHERE owner_user_id = $1
      ${monthFilter}
      ORDER BY occurred_at DESC, id DESC
    `,
    params
  );
  return rows.map(mapEntry);
}

async function loadFundTotal(ownerUserId) {
  const { rows } = await pool.query(
    `
      SELECT total_amount
      FROM petty_cash_funds
      WHERE owner_user_id = $1
      LIMIT 1
    `,
    [ownerUserId]
  );
  return rows[0] ? Number(rows[0].total_amount) || 0 : 0;
}

async function listFundAdditionsForOwner(ownerUserId, monthKey = null) {
  const params = [ownerUserId];
  let monthFilter = '';
  if (monthKey && isMonthKey(monthKey)) {
    params.push(monthKey);
    monthFilter = `
      AND to_char(
        COALESCE(occurred_at, created_at) AT TIME ZONE 'Asia/Karachi',
        'YYYY-MM'
      ) = $2
    `;
  }
  const { rows } = await pool.query(
    `
      SELECT id, owner_user_id, amount, occurred_at, created_by, created_at
      FROM petty_cash_fund_additions
      WHERE owner_user_id = $1
      ${monthFilter}
      ORDER BY occurred_at DESC, id DESC
    `,
    params
  );
  return rows.map(mapFundAddition);
}

async function assertAssignee(req, res) {
  const role = normalizeRole(req.user?.role);
  const ok = await userHasPettyCashPermission(req.user.id, role);
  if (!ok) {
    res.status(403).json({
      message: 'Petty cash is only available to the person assigned this permission.',
    });
    return false;
  }
  return true;
}

async function assertOverseer(req, res) {
  const role = normalizeRole(req.user?.role);
  if (!isCeoOrManagerRole(role)) {
    res.status(403).json({
      message: 'Only the CEO or a manager can view assigned petty cash dashboards.',
    });
    return false;
  }
  return true;
}

function parseEntryBody(body) {
  const itemName = String(body?.item_name || body?.itemName || '').trim().slice(0, 200);
  const price = parsePrice(body?.price);
  const quantity = parseQuantity(body?.quantity);
  const branch = String(body?.branch || '').trim().slice(0, 120) || null;
  const personName = String(body?.person_name || body?.personName || '')
    .trim()
    .slice(0, 120) || null;
  const occurredAt = parseOccurredAt(body?.occurred_at || body?.occurredAt);
  return { itemName, price, quantity, branch, personName, occurredAt };
}

async function saveReceiptFile(ownerUserId, file) {
  if (!file?.buffer) return null;
  const mime = String(file.mimetype || '').toLowerCase();
  const asImage = mime.startsWith('image/');
  const prepared = asImage
    ? await prepareFileBuffer(file, { asImage: true })
    : {
        buffer: file.buffer,
        ext: extFromFile(file, '.pdf') || '.pdf',
        contentType: mime || 'application/pdf',
      };
  const relativePath = path.posix.join(
    'petty-cash',
    String(ownerUserId),
    `${randomUUID()}${prepared.ext}`
  );
  await writeRelativeFile(relativePath, prepared.buffer);
  return {
    relativePath,
    contentType: prepared.contentType || mime || null,
  };
}

async function getMyLedger(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;
    const monthKey = parseMonth(req.query.month);
    const owner = await loadOwnerProfile(req.user.id);
    const entries = await listEntriesForOwner(req.user.id, monthKey);
    const fundAdditions = await listFundAdditionsForOwner(req.user.id, monthKey);
    const fundTotal = await loadFundTotal(req.user.id);
    return res.json({
      owner: owner
        ? {
            id: Number(owner.id),
            name: owner.name,
            username: owner.username,
            employee_id: owner.employee_id,
          }
        : { id: req.user.id },
      month: monthKey,
      month_label: monthLabel(monthKey),
      entries,
      fund_additions: fundAdditions,
      summary: summarize(entries, fundTotal),
      can_edit: true,
    });
  } catch (err) {
    console.error('getMyLedger error:', err);
    return res.status(500).json({ message: 'Failed to load petty cash.' });
  }
}

async function updateMyTotal(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;

    const addAmount = parseAddAmount(
      req.body?.amount ?? req.body?.add_amount ?? req.body?.total_amount ?? req.body?.totalAmount
    );
    if (addAmount == null) {
      return res.status(400).json({ message: 'Enter an amount greater than 0 to add.' });
    }

    const occurredAt = parseOccurredAt(req.body?.occurred_at || req.body?.occurredAt);
    if (!occurredAt) {
      return res.status(400).json({ message: 'Enter a valid date and time.' });
    }

    const client = await pool.connect();
    let fundRow;
    let additionRow;
    try {
      await client.query('BEGIN');
      const { rows: addRows } = await client.query(
        `
          INSERT INTO petty_cash_fund_additions
            (owner_user_id, amount, occurred_at, created_by)
          VALUES ($1, $2, $3, $4)
          RETURNING id, owner_user_id, amount, occurred_at, created_by, created_at
        `,
        [req.user.id, addAmount, occurredAt.toISOString(), req.user.id]
      );
      additionRow = addRows[0];

      const { rows: fundRows } = await client.query(
        `
          INSERT INTO petty_cash_funds (owner_user_id, total_amount, updated_by, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (owner_user_id) DO UPDATE
            SET total_amount = petty_cash_funds.total_amount + EXCLUDED.total_amount,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
          RETURNING total_amount, updated_at
        `,
        [req.user.id, addAmount, req.user.id]
      );
      fundRow = fundRows[0];
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }

    const monthKey = parseMonth(req.body?.month || req.query?.month);
    const entries = await listEntriesForOwner(req.user.id, monthKey);
    const fundAdditions = await listFundAdditionsForOwner(req.user.id, monthKey);
    return res.json({
      total_amount: Number(fundRow.total_amount) || 0,
      added_amount: addAmount,
      addition: mapFundAddition(additionRow),
      fund_additions: fundAdditions,
      updated_at: fundRow.updated_at,
      month: monthKey,
      summary: summarize(entries, Number(fundRow.total_amount) || 0),
      message: 'Amount added to total.',
    });
  } catch (err) {
    console.error('updateMyTotal error:', err);
    return res.status(500).json({ message: 'Failed to update total amount.' });
  }
}

async function createMyEntry(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;

    const { itemName, price, quantity, branch, personName, occurredAt } =
      parseEntryBody(req.body);
    if (!itemName) {
      return res.status(400).json({ message: 'Item name is required.' });
    }
    if (price == null) {
      return res.status(400).json({ message: 'Price is required.' });
    }
    if (!occurredAt) {
      return res.status(400).json({ message: 'Enter a valid date and time.' });
    }

    let receiptPath = null;
    let receiptMime = null;
    if (req.file) {
      const saved = await saveReceiptFile(req.user.id, req.file);
      receiptPath = saved?.relativePath || null;
      receiptMime = saved?.contentType || null;
    }

    const { rows } = await pool.query(
      `
        INSERT INTO petty_cash_entries
          (owner_user_id, item_name, price, quantity, branch, person_name, status,
           occurred_at, receipt_path, receipt_mime, created_by, description, amount, direction)
        VALUES ($1, $2, $3, $4, $5, $6, 'used', $7, $8, $9, $10, $2, $3, 'out')
        RETURNING id, owner_user_id, item_name, price, quantity, branch, person_name,
                  occurred_at, receipt_path, receipt_mime, created_by, created_at, updated_at
      `,
      [
        req.user.id,
        itemName,
        price,
        quantity,
        branch,
        personName,
        occurredAt.toISOString(),
        receiptPath,
        receiptMime,
        req.user.id,
      ]
    );
    return res.status(201).json({ entry: mapEntry(rows[0]) });
  } catch (err) {
    console.error('createMyEntry error:', err);
    return res.status(500).json({ message: 'Failed to save petty cash entry.' });
  }
}

async function updateMyEntry(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;

    const entryId = Number(req.params.id);
    if (!Number.isFinite(entryId)) {
      return res.status(400).json({ message: 'Invalid entry.' });
    }

    const { itemName, price, quantity, branch, personName, occurredAt } =
      parseEntryBody(req.body);
    if (!itemName) {
      return res.status(400).json({ message: 'Item name is required.' });
    }
    if (price == null) {
      return res.status(400).json({ message: 'Price is required.' });
    }
    if (!occurredAt) {
      return res.status(400).json({ message: 'Enter a valid date and time.' });
    }

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, receipt_path, receipt_mime
        FROM petty_cash_entries
        WHERE id = $1 AND owner_user_id = $2
        LIMIT 1
      `,
      [entryId, req.user.id]
    );
    if (!existingRows[0]) {
      return res.status(404).json({ message: 'Entry not found.' });
    }

    let receiptPath = existingRows[0].receipt_path || null;
    let receiptMime = existingRows[0].receipt_mime || null;
    const clearReceipt =
      String(req.body?.clear_receipt || req.body?.clearReceipt || '') === '1' ||
      String(req.body?.clear_receipt || req.body?.clearReceipt || '').toLowerCase() === 'true';

    if (req.file) {
      const saved = await saveReceiptFile(req.user.id, req.file);
      if (receiptPath) await deleteRelativeFile(receiptPath);
      receiptPath = saved?.relativePath || null;
      receiptMime = saved?.contentType || null;
    } else if (clearReceipt) {
      if (receiptPath) await deleteRelativeFile(receiptPath);
      receiptPath = null;
      receiptMime = null;
    }

    const { rows } = await pool.query(
      `
        UPDATE petty_cash_entries
        SET item_name = $3,
            price = $4,
            quantity = $5,
            branch = $6,
            person_name = $7,
            occurred_at = $8,
            receipt_path = $9,
            receipt_mime = $10,
            description = $3,
            amount = $4,
            updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING id, owner_user_id, item_name, price, quantity, branch, person_name,
                  occurred_at, receipt_path, receipt_mime, created_by, created_at, updated_at
      `,
      [
        entryId,
        req.user.id,
        itemName,
        price,
        quantity,
        branch,
        personName,
        occurredAt.toISOString(),
        receiptPath,
        receiptMime,
      ]
    );
    return res.json({ entry: mapEntry(rows[0]) });
  } catch (err) {
    console.error('updateMyEntry error:', err);
    return res.status(500).json({ message: 'Failed to update petty cash entry.' });
  }
}

async function deleteMyEntry(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;

    const entryId = Number(req.params.id);
    if (!Number.isFinite(entryId)) {
      return res.status(400).json({ message: 'Invalid entry.' });
    }

    const { rows } = await pool.query(
      `
        DELETE FROM petty_cash_entries
        WHERE id = $1 AND owner_user_id = $2
        RETURNING receipt_path
      `,
      [entryId, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: 'Entry not found.' });
    }
    if (rows[0].receipt_path) {
      await deleteRelativeFile(rows[0].receipt_path);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteMyEntry error:', err);
    return res.status(500).json({ message: 'Failed to delete petty cash entry.' });
  }
}

async function streamReceiptForOwner(ownerUserId, entryId, res) {
  const { rows } = await pool.query(
    `
      SELECT receipt_path, receipt_mime
      FROM petty_cash_entries
      WHERE id = $1 AND owner_user_id = $2
      LIMIT 1
    `,
    [entryId, ownerUserId]
  );
  const row = rows[0];
  if (!row?.receipt_path) {
    return res.status(404).json({ message: 'No receipt for this entry.' });
  }
  const abs = absoluteFromRelative(row.receipt_path);
  if (!abs) {
    return res.status(404).json({ message: 'Receipt file missing.' });
  }
  try {
    await fsp.access(abs);
  } catch {
    return res.status(404).json({ message: 'Receipt file missing.' });
  }
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader(
    'Content-Type',
    row.receipt_mime || (String(row.receipt_path).toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'application/octet-stream')
  );
  return res.sendFile(abs);
}

async function getMyReceipt(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;
    const entryId = Number(req.params.id);
    if (!Number.isFinite(entryId)) {
      return res.status(400).json({ message: 'Invalid entry.' });
    }
    return streamReceiptForOwner(req.user.id, entryId, res);
  } catch (err) {
    console.error('getMyReceipt error:', err);
    return res.status(500).json({ message: 'Failed to open receipt.' });
  }
}

async function listHolders(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertOverseer(req, res))) return;

    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.name,
          u.username,
          u.employee_id,
          u.role,
          COALESCE(f.total_amount, 0) AS total_amount,
          COALESCE(SUM(COALESCE(e.price, 0)), 0) AS used_amount,
          COUNT(e.id)::int AS entry_count
        FROM admin_permissions ap
        INNER JOIN users u ON u.id = ap.user_id
        LEFT JOIN petty_cash_funds f ON f.owner_user_id = u.id
        LEFT JOIN petty_cash_entries e ON e.owner_user_id = u.id
        WHERE ap.permission_key = $1
          AND COALESCE(u.is_active, true) = true
          AND u.blocked_at IS NULL
        GROUP BY u.id, u.name, u.username, u.employee_id, u.role, f.total_amount
        ORDER BY LOWER(COALESCE(u.name, u.username, '')) ASC
      `,
      [PETTY_CASH_KEY]
    );

    const holders = rows.map((row) => {
      const total = Math.round((Number(row.total_amount) || 0) * 100) / 100;
      const used = Math.round((Number(row.used_amount) || 0) * 100) / 100;
      const pending = Math.round((total - used) * 100) / 100;
      return {
        id: Number(row.id),
        name: row.name || row.username || 'Unnamed',
        username: row.username,
        employee_id: row.employee_id,
        role: row.role,
        entry_count: Number(row.entry_count) || 0,
        total_amount: total,
        used_amount: used,
        pending_amount: pending,
        items_amount: used,
        balance: pending,
      };
    });

    return res.json({ holders });
  } catch (err) {
    console.error('listHolders error:', err);
    return res.status(500).json({ message: 'Failed to load petty cash assignees.' });
  }
}

async function getHolderLedger(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertOverseer(req, res))) return;

    const ownerId = Number(req.params.userId);
    if (!Number.isFinite(ownerId)) {
      return res.status(400).json({ message: 'Invalid user.' });
    }

    const { rows: permRows } = await pool.query(
      `
        SELECT 1
        FROM admin_permissions
        WHERE user_id = $1 AND permission_key = $2
        LIMIT 1
      `,
      [ownerId, PETTY_CASH_KEY]
    );
    if (!permRows[0]) {
      return res.status(404).json({
        message: 'This person is not assigned petty cash.',
      });
    }

    const owner = await loadOwnerProfile(ownerId);
    if (!owner) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const monthKey = parseMonth(req.query.month);
    const entries = await listEntriesForOwner(ownerId, monthKey);
    const fundAdditions = await listFundAdditionsForOwner(ownerId, monthKey);
    const fundTotal = await loadFundTotal(ownerId);
    return res.json({
      owner: {
        id: Number(owner.id),
        name: owner.name || owner.username || 'Unnamed',
        username: owner.username,
        employee_id: owner.employee_id,
      },
      month: monthKey,
      month_label: monthLabel(monthKey),
      entries,
      fund_additions: fundAdditions,
      summary: summarize(entries, fundTotal),
      can_edit: false,
    });
  } catch (err) {
    console.error('getHolderLedger error:', err);
    return res.status(500).json({ message: 'Failed to load petty cash dashboard.' });
  }
}

async function resolveExportActorName(userId) {
  const { rows } = await pool.query(
    `SELECT name, username FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return String(rows[0]?.name || rows[0]?.username || '').trim() || 'Unknown';
}

async function sendPettyCashExport(res, {
  format,
  entries,
  summary,
  monthKey,
  ownerName,
  generatedBy,
}) {
  const filenameBase = buildPettyCashBaseName(monthKey, ownerName);
  const meta = {
    title: 'Textured Lab Petty Cash',
    month: monthLabel(monthKey),
    monthKey,
    ownerName: ownerName || 'Petty cash',
    generatedAt: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
    generatedBy,
  };

  if (format === 'pdf') {
    const pdfName = `${filenameBase}.pdf`;
    const buffer = await buildPettyCashPdf(entries, summary, meta);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentDisposition(pdfName));
    res.setHeader('X-Export-Filename', pdfName);
    return res.send(buffer);
  }

  const excelName = `${filenameBase}.xls`;
  const xml = buildPettyCashExcelXml(entries, summary, meta);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', attachmentDisposition(excelName));
  res.setHeader('X-Export-Filename', excelName);
  return res.send(xml);
}

async function exportMyLedger(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertAssignee(req, res))) return;

    const format = String(req.query.format || 'xlsx').trim().toLowerCase();
    if (format !== 'xlsx' && format !== 'excel' && format !== 'pdf') {
      return res.status(400).json({ message: 'format must be xlsx or pdf.' });
    }

    const monthKey = parseMonth(req.query.month);
    const owner = await loadOwnerProfile(req.user.id);
    const entries = await listEntriesForOwner(req.user.id, monthKey);
    const fundTotal = await loadFundTotal(req.user.id);
    const summary = summarize(entries, fundTotal);
    const generatedBy = await resolveExportActorName(req.user.id);
    const ownerName = owner?.name || owner?.username || 'My petty cash';

    return sendPettyCashExport(res, {
      format,
      entries,
      summary,
      monthKey,
      ownerName,
      generatedBy,
    });
  } catch (err) {
    console.error('exportMyLedger error:', err);
    const detail = String(err?.message || err || '').trim();
    return res.status(500).json({
      message: detail
        ? `Server error exporting petty cash: ${detail}`
        : 'Server error exporting petty cash.',
    });
  }
}

async function exportHolderLedger(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertOverseer(req, res))) return;

    const format = String(req.query.format || 'xlsx').trim().toLowerCase();
    if (format !== 'xlsx' && format !== 'excel' && format !== 'pdf') {
      return res.status(400).json({ message: 'format must be xlsx or pdf.' });
    }

    const ownerId = Number(req.params.userId);
    if (!Number.isFinite(ownerId)) {
      return res.status(400).json({ message: 'Invalid user.' });
    }

    const { rows: permRows } = await pool.query(
      `
        SELECT 1
        FROM admin_permissions
        WHERE user_id = $1 AND permission_key = $2
        LIMIT 1
      `,
      [ownerId, PETTY_CASH_KEY]
    );
    if (!permRows[0]) {
      return res.status(404).json({
        message: 'This person is not assigned petty cash.',
      });
    }

    const monthKey = parseMonth(req.query.month);
    const owner = await loadOwnerProfile(ownerId);
    if (!owner) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const entries = await listEntriesForOwner(ownerId, monthKey);
    const fundTotal = await loadFundTotal(ownerId);
    const summary = summarize(entries, fundTotal);
    const generatedBy = await resolveExportActorName(req.user.id);
    const ownerName = owner.name || owner.username || 'Petty cash';

    return sendPettyCashExport(res, {
      format,
      entries,
      summary,
      monthKey,
      ownerName,
      generatedBy,
    });
  } catch (err) {
    console.error('exportHolderLedger error:', err);
    const detail = String(err?.message || err || '').trim();
    return res.status(500).json({
      message: detail
        ? `Server error exporting petty cash: ${detail}`
        : 'Server error exporting petty cash.',
    });
  }
}

async function getHolderReceipt(req, res) {
  try {
    await ensurePettyCashSchema();
    if (!(await assertOverseer(req, res))) return;
    const ownerId = Number(req.params.userId);
    const entryId = Number(req.params.id);
    if (!Number.isFinite(ownerId) || !Number.isFinite(entryId)) {
      return res.status(400).json({ message: 'Invalid request.' });
    }
    return streamReceiptForOwner(ownerId, entryId, res);
  } catch (err) {
    console.error('getHolderReceipt error:', err);
    return res.status(500).json({ message: 'Failed to open receipt.' });
  }
}

module.exports = {
  getMyLedger,
  updateMyTotal,
  createMyEntry,
  updateMyEntry,
  deleteMyEntry,
  getMyReceipt,
  exportMyLedger,
  listHolders,
  getHolderLedger,
  getHolderReceipt,
  exportHolderLedger,
};
