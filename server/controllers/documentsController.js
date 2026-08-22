const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const {
  DOC_TYPES,
  resolveDocumentFile,
  writeRelativeFile,
  absoluteFromRelative,
} = require('../services/localStorage');
const { canDownloadDocument } = require('../utils/documentAccess');

const DOC_BUCKET = {
  profile: 'profile-pictures',
  cnic_front: 'cnic-documents',
  cnic_back: 'cnic-documents',
  cv: 'cv-documents',
};

/**
 * Local private_uploads is empty on a fresh clone. Pull the object from
 * Supabase Storage (still the backup) and cache it on disk.
 */
async function hydrateMissingFile({ storedPath, docType, userId, user }) {
  const bucket = DOC_BUCKET[docType];
  if (!bucket) return null;

  let supabase;
  try {
    ({ supabase } = require('../config/supabaseClient'));
  } catch (err) {
    console.warn('Supabase client unavailable for document hydrate:', err.message);
    return null;
  }

  const keys = [];
  const add = (k) => {
    const v = String(k || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!v || /^https?:\/\//i.test(v) || keys.includes(v)) return;
    keys.push(v);
  };

  add(storedPath);
  const stems = DOC_TYPES[docType]?.fileStems || [docType];
  const exts =
    docType === 'cv' || docType === 'employment_form'
      ? ['.pdf']
      : ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const folders = [`id-${userId}`];
  if (user?.employee_id) folders.push(String(user.employee_id).trim());
  if (user?.username) folders.push(`user-${String(user.username).trim()}`);
  if (userId != null) folders.push(`u${userId}`);
  for (const folder of folders) {
    for (const stem of stems) {
      for (const ext of exts) add(`${folder}/${stem}${ext}`);
    }
  }

  for (const key of keys) {
    const { data, error } = await supabase.storage.from(bucket).download(key);
    if (error || !data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    const dest =
      storedPath && !/^https?:\/\//i.test(String(storedPath)) ? storedPath : key;
    await writeRelativeFile(dest, buf);
    return absoluteFromRelative(dest);
  }

  return null;
}

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

/**
 * GET /api/documents/:userId/:docType
 * docType: profile | cnic_front | cnic_back | cv | employment_form
 */
async function streamDocument(req, res) {
  try {
    const userId = Number(req.params.userId);
    const docType = String(req.params.docType || '').trim();
    const meta = DOC_TYPES[docType];

    if (!Number.isFinite(userId) || userId <= 0 || !meta) {
      return res.status(400).json({ message: 'Invalid document request.' });
    }

    const allowed = await canDownloadDocument(docType, req.user, {
      targetUserId: userId,
    });
    if (!allowed) {
      return res.status(403).json({
        message: 'You do not have permission to view this document.',
      });
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
      try {
        abs = await hydrateMissingFile({
          storedPath: row.file_path,
          docType,
          userId,
          user: row,
        });
      } catch (err) {
        console.warn('hydrateMissingFile error:', err.message);
      }
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

    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
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
