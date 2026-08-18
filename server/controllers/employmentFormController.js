const pool = require('../config/db');
const {
  saveUserFile,
  deleteRelativeFile,
  folderForUserId,
} = require('../services/localStorage');
const { imagesToEmploymentFormPdf } = require('../services/employmentFormPdf');
const { writeAuditLog } = require('../utils/auditLog');
const { documentApiPath } = require('../utils/storageUrls');

const DOC_TYPE = 'employment_form';
const MAX_IMAGES = 10;

function relativeStoragePath(value) {
  if (!value) return null;
  const s = String(value);
  if (/^https?:\/\//i.test(s)) return null;
  if (s.startsWith('/api/documents/')) return null;
  return s.replace(/^\/+/, '');
}

/**
 * POST /api/admin/employees/:employeeId/employment-form
 * multipart field: images (1–10 image files)
 */
async function uploadEmploymentForm(req, res) {
  try {
    const employeeId = Number(req.params.employeeId || req.params.id);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return res.status(400).json({ message: 'Invalid employee id.' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({
        message: 'Add at least one image (field name: images).',
      });
    }
    if (files.length > MAX_IMAGES) {
      return res.status(400).json({
        message: `Maximum ${MAX_IMAGES} images allowed.`,
      });
    }

    const { rows } = await pool.query(
      `
        SELECT id, username, name, employee_id, employment_form_url
        FROM users
        WHERE id = $1 AND is_active = true
        LIMIT 1
      `,
      [employeeId]
    );
    const employee = rows[0];
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const previousRelative = relativeStoragePath(employee.employment_form_url);

    const pdfBuffer = await imagesToEmploymentFormPdf(files);

    const relativePath = await saveUserFile(employee, DOC_TYPE, {
      buffer: pdfBuffer,
      mimetype: 'application/pdf',
      originalname: 'employment_form.pdf',
    });

    if (previousRelative && previousRelative !== relativePath) {
      await deleteRelativeFile(previousRelative);
    }

    const { rows: updated } = await pool.query(
      `
        UPDATE users
        SET employment_form_url = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, employment_form_url, updated_at
      `,
      [relativePath, employeeId]
    );

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: 'employment_form_uploaded',
        targetTable: 'users',
        targetId: employeeId,
        reason: `Employment form PDF (${files.length} page(s)) saved to ${folderForUserId(employeeId)}/`,
      });
    } catch (auditErr) {
      console.warn('employment form audit log failed:', auditErr.message);
    }

    const row = updated[0];
    return res.json({
      message: 'Employment form saved.',
      document: {
        id: row.id,
        type: DOC_TYPE,
        document_type: DOC_TYPE,
        url: documentApiPath(row.id, DOC_TYPE),
        uploaded_at: row.updated_at,
        page_count: files.length,
      },
    });
  } catch (err) {
    console.error('uploadEmploymentForm error:', err);
    return res.status(500).json({
      message: err.message || 'Server error creating employment form.',
    });
  }
}

module.exports = {
  uploadEmploymentForm,
  MAX_IMAGES,
  DOC_TYPE,
};
