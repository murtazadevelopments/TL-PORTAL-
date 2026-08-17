const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

/**
 * Hostinger private file storage (outside public_html).
 *
 * UPLOAD_ROOT examples:
 *   /home/uXXXXXX/private_uploads
 *   ./private_uploads  (local default, gitignored)
 */

function getUploadRoot() {
  const fromEnv = String(process.env.UPLOAD_ROOT || process.env.UPLOADS_ROOT || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  // Default: server/private_uploads (same folder used by migration + local uploads)
  return path.resolve(__dirname, '..', 'private_uploads');
}

const DOC_TYPES = {
  profile: { column: 'profile_picture_url', image: true, defaultExt: '.jpg' },
  cnic_front: { column: 'cnic_front_url', image: true, defaultExt: '.jpg' },
  cnic_back: { column: 'cnic_back_url', image: true, defaultExt: '.jpg' },
  cv: { column: 'cv_url', image: false, defaultExt: '.pdf' },
};

function userFolder(user) {
  const emp = user?.employee_id != null ? String(user.employee_id).trim() : '';
  // Ignore placeholders / junk IDs that would collide or create awkward folders
  if (emp && emp !== '-' && emp.toLowerCase() !== 'n/a' && emp !== '.') {
    const safe = emp.replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (safe && safe !== '-' && safe !== '_') return safe;
  }
  if (user?.id != null) return `u${user.id}`;
  if (user?.username) return `user-${String(user.username).trim().toLowerCase()}`;
  throw new Error('Cannot resolve upload folder without user id or username.');
}

function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Invalid storage path.');
  }
  return resolved;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

/**
 * Compress images with sharp before save. PDFs/non-images saved as-is.
 * @returns {{ buffer: Buffer, ext: string, contentType: string }}
 */
async function prepareFileBuffer(file, { asImage = false } = {}) {
  const mime = String(file.mimetype || '').toLowerCase();
  const isImage = asImage || mime.startsWith('image/');

  if (isImage && mime !== 'application/pdf') {
    const buffer = await sharp(file.buffer)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { buffer, ext: '.jpg', contentType: 'image/jpeg' };
  }

  const original = file.originalname || '';
  const ext =
    path.extname(original).toLowerCase() ||
    (mime.includes('pdf') ? '.pdf' : '.bin');
  return {
    buffer: file.buffer,
    ext,
    contentType: file.mimetype || 'application/octet-stream',
  };
}

/**
 * Save a multer file under UPLOAD_ROOT/<folder>/<basename><ext>
 * Returns relative path stored in DB (posix-style).
 */
async function saveUserFile(user, docType, file) {
  const meta = DOC_TYPES[docType];
  if (!meta) throw new Error(`Unknown doc type: ${docType}`);
  if (!file?.buffer) throw new Error('Missing file buffer.');

  const prepared = await prepareFileBuffer(file, { asImage: meta.image });
  const folder = userFolder(user);
  const relativePath = path.posix.join(folder, `${docType}${prepared.ext}`);
  const absPath = safeJoin(getUploadRoot(), relativePath);

  await ensureDir(path.dirname(absPath));
  await fsp.writeFile(absPath, prepared.buffer);
  return relativePath;
}

/**
 * Write a raw buffer (migration) to a relative path.
 */
async function writeRelativeFile(relativePath, buffer) {
  if (!relativePath || !buffer) return null;
  const absPath = safeJoin(getUploadRoot(), relativePath);
  await ensureDir(path.dirname(absPath));
  await fsp.writeFile(absPath, buffer);
  return relativePath.replace(/\\/g, '/');
}

function absoluteFromRelative(relativePath) {
  if (!relativePath) return null;
  // Ignore legacy full http URLs
  if (/^https?:\/\//i.test(relativePath)) return null;
  return safeJoin(getUploadRoot(), relativePath);
}

async function deleteRelativeFile(relativePath) {
  const abs = absoluteFromRelative(relativePath);
  if (!abs) return;
  try {
    await fsp.unlink(abs);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Failed to delete local file ${relativePath}:`, err.message);
    }
  }
}

async function fileExists(relativePath) {
  const abs = absoluteFromRelative(relativePath);
  if (!abs) return false;
  try {
    await fsp.access(abs, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DOC_TYPES,
  getUploadRoot,
  userFolder,
  saveUserFile,
  writeRelativeFile,
  absoluteFromRelative,
  deleteRelativeFile,
  fileExists,
  prepareFileBuffer,
  ensureDir,
};
