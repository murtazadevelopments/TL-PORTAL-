const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { loadAdminPermissions } = require('../middleware/permissions');
const {
  DOC_TYPES,
  resolveDocumentFile,
} = require('../services/localStorage');

/**
 * Auth for document streaming: Bearer header OR ?token= query (for <img>/<a>).
 */
function documentAuth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query?.token) {
    token = String(req.query.token);
  }

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

async function canAccessDocuments(requester, targetUserId, docType) {
  const role = String(requester.role || '').toLowerCase();
  const isSelf = String(requester.id) === String(targetUserId);

  // Profile photos: any authenticated admin/ceo can view list thumbs; employees only own
  if (docType === 'profile') {
    if (isSelf) return true;
    if (role === 'ceo' || role === 'admin') return true;
    return false;
  }

  // Sensitive docs: self, or CEO, or admin with documents:view
  if (isSelf) return true;
  if (role === 'ceo') return true;
  if (role === 'admin') {
    let perms = Array.isArray(requester.permissions) ? requester.permissions : [];
    if (!perms.length) {
      perms = await loadAdminPermissions(requester.id);
    }
    return perms.includes('documents:view') || perms.includes('*');
  }
  return false;
}

/**
 * GET /api/documents/:userId/:docType
 * docType: profile | cnic_front | cnic_back | cv
 *
 * URL uses logical types (profile), not exact filenames. Files on disk may be
 * profile_picture.jpeg, profile.jpg, cnic_front.png, etc.
 */
async function streamDocument(req, res) {
  try {
    const userId = Number(req.params.userId);
    const docType = String(req.params.docType || '').trim();
    const meta = DOC_TYPES[docType];

    if (!Number.isFinite(userId) || userId <= 0 || !meta) {
      return res.status(400).json({ message: 'Invalid document request.' });
    }

    const allowed = await canAccessDocuments(req.user, userId, docType);
    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to view this document.' });
    }

    const { rows } = await pool.query(
      `
        SELECT id, username, employee_id, ${meta.column} AS file_path
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    const row = rows[0];
    if (!row) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Legacy remote URL — redirect (pre-migration safety)
    if (row.file_path && /^https?:\/\//i.test(String(row.file_path))) {
      return res.redirect(row.file_path);
    }

    let abs;
    try {
      abs = resolveDocumentFile({
        userId,
        docType,
        storedPath: row.file_path,
        user: row,
      });
    } catch (err) {
      console.error('resolveDocumentFile error:', err.message);
      return res.status(400).json({ message: 'Invalid stored file path.' });
    }

    if (!abs) {
      return res.status(404).json({
        message: 'File missing on server.',
        docType,
        uploadHint: `Expected under private_uploads/id-${userId}/ (${meta.fileStems.join('|')}.*)`,
      });
    }

    const ext = path.extname(abs).toLowerCase();
    const type =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'image/jpeg';

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Type', type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${docType}${ext || ''}"`
    );
    return fs.createReadStream(abs).pipe(res);
  } catch (err) {
    console.error('streamDocument error:', err);
    return res.status(500).json({ message: 'Server error reading document.' });
  }
}

module.exports = {
  documentAuth,
  streamDocument,
};
