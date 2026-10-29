const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { ensureLeaveRequestsSchema } = require('../utils/leaveRequestsSchema');
const { loadAdminPermissions, isCeoOrManagerRole } = require('../middleware/permissions');
const { writeRelativeFile, absoluteFromRelative } = require('../services/localStorage');
const { normalizeEmploymentType } = require('../utils/employmentType');

function canReviewLeave(role, permissions) {
  if (isCeoOrManagerRole(role)) return true;
  const keys = Array.isArray(permissions) ? permissions : [];
  return keys.includes('hr:followup') || keys.includes('hr:add_employee') || keys.includes('*');
}

async function reviewerAccess(req) {
  const role = String(req.user?.role || '').toLowerCase();
  let permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  if (role === 'admin' && !permissions.length && req.user?.id) {
    permissions = await loadAdminPermissions(req.user.id);
    req.user.permissions = permissions;
  }
  return canReviewLeave(role, permissions);
}

function parseDateOnly(value) {
  const raw = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function normalizeLeaveType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t === 'sick' || t === 'annual') return t;
  return null;
}

function leaveTypeLabel(value) {
  return value === 'annual' ? 'Annual leave' : 'Sick leave';
}

function serializeLeave(row) {
  if (!row) return null;
  const leaveType = normalizeLeaveType(row.leave_type) || 'sick';
  return {
    id: row.id,
    user_id: row.user_id,
    leave_type: leaveType,
    leave_type_label: leaveTypeLabel(leaveType),
    start_date: row.start_date ? String(row.start_date).slice(0, 10) : null,
    end_date: row.end_date ? String(row.end_date).slice(0, 10) : null,
    status: row.status,
    admin_remarks: row.admin_remarks || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    has_prescription: Boolean(row.prescription_path),
    prescription_url: row.prescription_path
      ? `/api/leave-requests/${row.id}/prescription`
      : null,
    employee_name: row.employee_name || null,
    employee_username: row.employee_username || null,
    employee_id_code: row.employee_id_code || null,
    employment_type: row.employment_type || null,
    department: row.department || null,
    branch: row.branch || null,
    reviewer_name: row.reviewer_name || null,
  };
}

async function loadApplicant(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, username, name, employee_id, employment_type, is_active,
             status, blocked_at, resigned_at, terminated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

/**
 * POST /api/leave-requests
 * multipart: leave_type (sick|annual), start_date, end_date,
 * prescription required for sick leave (image or PDF)
 */
async function createLeaveRequest(req, res) {
  try {
    await ensureLeaveRequestsSchema();
    const applicant = await loadApplicant(req.user.id);
    if (!applicant || applicant.is_active === false) {
      return res.status(403).json({ message: 'This account cannot apply for leave.' });
    }
    const employment = normalizeEmploymentType(applicant.employment_type);
    if (employment !== 'remote' && employment !== 'onsite') {
      return res.status(403).json({
        message: 'Leave requests are available for remote and onsite employees.',
      });
    }

    const leaveType = normalizeLeaveType(req.body?.leave_type);
    if (!leaveType) {
      return res.status(400).json({ message: 'Select leave type: Sick leave or Annual leave.' });
    }

    const startDate = parseDateOnly(req.body?.start_date);
    const endDate = parseDateOnly(req.body?.end_date);
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'From date and to date are required (YYYY-MM-DD).' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ message: 'To date must be on or after from date.' });
    }

    const file = req.file;
    let relativePath = null;
    let mime = null;

    if (leaveType === 'sick') {
      if (!file?.buffer) {
        return res.status(400).json({ message: 'Doctor prescription is required for sick leave.' });
      }
      mime = String(file.mimetype || '').toLowerCase();
      const isPdf = mime === 'application/pdf';
      const isImage = mime.startsWith('image/');
      if (!isPdf && !isImage) {
        return res.status(400).json({ message: 'Prescription must be an image or PDF.' });
      }
      const ext =
        path.extname(file.originalname || '').toLowerCase() ||
        (isPdf ? '.pdf' : mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg');
      relativePath = path.posix.join(
        'leave-prescriptions',
        `id-${req.user.id}`,
        `${randomUUID()}${ext}`
      );
      await writeRelativeFile(relativePath, file.buffer);
    } else if (file?.buffer) {
      // Annual leave: ignore optional uploads rather than failing.
      mime = null;
      relativePath = null;
    }

    const { rows } = await pool.query(
      `
        INSERT INTO leave_requests (
          user_id, leave_type, start_date, end_date, prescription_path, prescription_mime, status
        )
        VALUES ($1, $2, $3::date, $4::date, $5, $6, 'pending')
        RETURNING *
      `,
      [req.user.id, leaveType, startDate, endDate, relativePath, mime]
    );

    return res.status(201).json({
      message: 'Leave request submitted. Waiting for HR approval.',
      leave: serializeLeave(rows[0]),
    });
  } catch (err) {
    console.error('createLeaveRequest error:', err);
    return res.status(500).json({ message: 'Server error submitting leave request.' });
  }
}

/**
 * GET /api/leave-requests/mine
 */
async function listMyLeaveRequests(req, res) {
  try {
    await ensureLeaveRequestsSchema();
    const { rows } = await pool.query(
      `
        SELECT *
        FROM leave_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `,
      [req.user.id]
    );
    return res.json(rows.map(serializeLeave));
  } catch (err) {
    console.error('listMyLeaveRequests error:', err);
    return res.status(500).json({ message: 'Server error loading leave requests.' });
  }
}

/**
 * GET /api/leave-requests  (CEO / manager / HR)
 */
async function listLeaveRequests(req, res) {
  try {
    await ensureLeaveRequestsSchema();
    if (!(await reviewerAccess(req))) {
      return res.status(403).json({ message: 'Only CEO, manager, or HR can review leave requests.' });
    }

    const status = String(req.query.status || 'all').trim().toLowerCase();
    const params = [];
    let where = '';
    if (['pending', 'approved', 'rejected'].includes(status)) {
      params.push(status);
      where = `WHERE lr.status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `
        SELECT
          lr.*,
          u.name AS employee_name,
          u.username AS employee_username,
          u.employee_id AS employee_id_code,
          u.employment_type,
          u.department,
          u.branch,
          r.name AS reviewer_name
        FROM leave_requests lr
        JOIN users u ON u.id = lr.user_id
        LEFT JOIN users r ON r.id = lr.reviewed_by
        ${where}
        ORDER BY
          CASE WHEN lr.status = 'pending' THEN 0 ELSE 1 END,
          lr.created_at DESC
        LIMIT 300
      `,
      params
    );
    return res.json(rows.map(serializeLeave));
  } catch (err) {
    console.error('listLeaveRequests error:', err);
    return res.status(500).json({ message: 'Server error loading leave requests.' });
  }
}

/**
 * GET /api/leave-requests/:id/prescription
 */
async function streamPrescription(req, res) {
  try {
    await ensureLeaveRequestsSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid leave request.' });
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, prescription_path, prescription_mime FROM leave_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row?.prescription_path) {
      return res.status(404).json({ message: 'Prescription not found.' });
    }

    const isOwner = String(row.user_id) === String(req.user.id);
    if (!isOwner && !(await reviewerAccess(req))) {
      return res.status(403).json({ message: 'You do not have permission to view this prescription.' });
    }

    const abs = absoluteFromRelative(row.prescription_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ message: 'Prescription file missing on server.' });
    }

    const ext = path.extname(abs).toLowerCase();
    const type =
      row.prescription_mime ||
      (ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'image/jpeg');

    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Content-Type', type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="leave-prescription-${id}${ext || ''}"`
    );
    return fs.createReadStream(abs).pipe(res);
  } catch (err) {
    console.error('streamPrescription error:', err);
    return res.status(500).json({ message: 'Server error reading prescription.' });
  }
}

async function decideLeaveRequest(req, res, decision) {
  try {
    await ensureLeaveRequestsSchema();
    if (!(await reviewerAccess(req))) {
      return res.status(403).json({ message: 'Only CEO, manager, or HR can review leave requests.' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid leave request.' });
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ message: 'Invalid decision.' });
    }

    const remarksRaw = req.body?.remarks;
    const remarks =
      remarksRaw === undefined || remarksRaw === null || String(remarksRaw).trim() === ''
        ? null
        : String(remarksRaw).trim().slice(0, 1000);

    const { rows: existing } = await pool.query(
      `SELECT * FROM leave_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!existing[0]) {
      return res.status(404).json({ message: 'Leave request not found.' });
    }
    if (existing[0].status !== 'pending') {
      return res.status(409).json({
        message: `This leave request was already ${existing[0].status}.`,
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE leave_requests
        SET
          status = $1,
          admin_remarks = $2,
          reviewed_by = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4 AND status = 'pending'
        RETURNING *
      `,
      [decision, remarks, req.user.id, id]
    );

    if (!rows[0]) {
      return res.status(409).json({ message: 'This leave request was already reviewed.' });
    }

    const { rows: joined } = await pool.query(
      `
        SELECT
          lr.*,
          u.name AS employee_name,
          u.username AS employee_username,
          u.employee_id AS employee_id_code,
          u.employment_type,
          u.department,
          u.branch,
          r.name AS reviewer_name
        FROM leave_requests lr
        JOIN users u ON u.id = lr.user_id
        LEFT JOIN users r ON r.id = lr.reviewed_by
        WHERE lr.id = $1
        LIMIT 1
      `,
      [id]
    );

    return res.json({
      message: decision === 'approved' ? 'Leave request approved.' : 'Leave request rejected.',
      leave: serializeLeave(joined[0] || rows[0]),
    });
  } catch (err) {
    console.error('decideLeaveRequest error:', err);
    return res.status(500).json({ message: 'Server error updating leave request.' });
  }
}

async function approveLeaveRequest(req, res) {
  return decideLeaveRequest(req, res, 'approved');
}

async function rejectLeaveRequest(req, res) {
  return decideLeaveRequest(req, res, 'rejected');
}

module.exports = {
  createLeaveRequest,
  listMyLeaveRequests,
  listLeaveRequests,
  streamPrescription,
  approveLeaveRequest,
  rejectLeaveRequest,
  canReviewLeave,
};
