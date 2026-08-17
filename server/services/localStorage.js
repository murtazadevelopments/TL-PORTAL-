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

/**
 * API :docType → DB column + on-disk filename stems.
 * Migration wrote profile_picture.*; new saves historically used profile.* —
 * resolveDocumentFile accepts both. Prefer the first stem when writing.
 */
const DOC_TYPES = {
  profile: {
    column: 'profile_picture_url',
    image: true,
    defaultExt: '.jpg',
    fileStems: ['profile_picture', 'profile'],
  },
  cnic_front: {
    column: 'cnic_front_url',
    image: true,
    defaultExt: '.jpg',
    fileStems: ['cnic_front'],
  },
  cnic_back: {
    column: 'cnic_back_url',
    image: true,
    defaultExt: '.jpg',
    fileStems: ['cnic_back'],
  },
  cv: {
    column: 'cv_url',
    image: false,
    defaultExt: '.pdf',
    fileStems: ['cv'],
  },
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const CV_EXTS = ['.pdf'];

function extsForDocType(docType) {
  const meta = DOC_TYPES[docType];
  if (!meta) return IMAGE_EXTS;
  return meta.image ? IMAGE_EXTS : CV_EXTS;
}

function folderForUserId(userId) {
  if (userId == null || userId === '') {
    throw new Error('Cannot resolve upload folder without user id.');
  }
  return `id-${userId}`;
}

/**
 * Canonical on-disk folder is always id-{userId} (matches migration).
 * Legacy folders (employee_id, u{id}, user-username) are still searched on read.
 */
function userFolder(user) {
  if (user?.id != null) return folderForUserId(user.id);
  if (user?.username) return `user-${String(user.username).trim().toLowerCase()}`;
  throw new Error('Cannot resolve upload folder without user id or username.');
}

function legacyUserFolders(user, userId) {
  const folders = [];
  const add = (f) => {
    const cleaned = String(f || '')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    if (cleaned && !folders.includes(cleaned)) folders.push(cleaned);
  };
  const id = user?.id ?? userId;
  if (id != null) {
    add(folderForUserId(id));
    add(`u${id}`);
  }
  const emp = user?.employee_id != null ? String(user.employee_id).trim() : '';
  if (emp && emp !== '-' && emp.toLowerCase() !== 'n/a' && emp !== '.') {
    const safe = emp.replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (safe && safe !== '-' && safe !== '_') add(safe);
  }
  if (user?.username) add(`user-${String(user.username).trim().toLowerCase()}`);
  return folders;
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
  const original = file.originalname || '';

  if (isImage && mime !== 'application/pdf') {
    try {
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
    } catch (err) {
      // Hostinger/native sharp issues — still save the original bytes
      console.warn('sharp compress failed; saving original image:', err.message);
      const ext =
        path.extname(original).toLowerCase() ||
        (mime.includes('png')
          ? '.png'
          : mime.includes('webp')
            ? '.webp'
            : mime.includes('gif')
              ? '.gif'
              : '.jpg');
      return {
        buffer: file.buffer,
        ext,
        contentType: file.mimetype || 'image/jpeg',
      };
    }
  }

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

  const root = getUploadRoot();
  await ensureDir(root);

  const prepared = await prepareFileBuffer(file, { asImage: meta.image });
  const folder = userFolder(user);
  // Prefer migration-compatible stem (profile_picture, not profile)
  const stem = (meta.fileStems && meta.fileStems[0]) || docType;
  const relativePath = path.posix.join(folder, `${stem}${prepared.ext}`);
  const absPath = safeJoin(root, relativePath);

  await ensureDir(path.dirname(absPath));
  await fsp.writeFile(absPath, prepared.buffer);

  // Remove stale alternate extensions / legacy stem so resolve is unambiguous
  for (const altStem of meta.fileStems || [stem]) {
    for (const ext of extsForDocType(docType)) {
      const altRel = path.posix.join(folder, `${altStem}${ext}`);
      if (altRel === relativePath) continue;
      try {
        await fsp.unlink(safeJoin(root, altRel));
      } catch {
        /* ignore missing */
      }
    }
  }

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

function existsSyncSafe(absPath) {
  try {
    return Boolean(absPath) && fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve an on-disk file for GET /api/documents/:userId/:docType.
 *
 * Order:
 *  1. Exact relative path from DB (if present and readable)
 *  2. Same directory as DB path, trying known stems + common extensions
 *  3. id-{userId}/ and legacy folders (u{id}, employee_id, user-username)
 *  4. Directory scan for stem.* (handles .jpg vs .jpeg vs .png)
 *
 * @returns {string|null} absolute path or null
 */
function resolveDocumentFile({ userId, docType, storedPath, user } = {}) {
  const meta = DOC_TYPES[docType];
  if (!meta) return null;

  const stems = meta.fileStems || [docType];
  const exts = extsForDocType(docType);
  const root = getUploadRoot();
  const tried = new Set();

  const tryAbs = (abs) => {
    if (!abs || tried.has(abs)) return null;
    tried.add(abs);
    return existsSyncSafe(abs) ? abs : null;
  };

  const tryRel = (rel) => {
    if (!rel || /^https?:\/\//i.test(String(rel))) return null;
    try {
      return tryAbs(safeJoin(root, String(rel).replace(/^\/+/, '')));
    } catch {
      return null;
    }
  };

  // 1) Exact DB path
  if (storedPath) {
    const hit = tryRel(storedPath);
    if (hit) return hit;
  }

  const folders = [];
  const addFolder = (f) => {
    const cleaned = String(f || '')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    if (cleaned && !folders.includes(cleaned)) folders.push(cleaned);
  };

  if (storedPath && !/^https?:\/\//i.test(String(storedPath))) {
    const dir = path.posix.dirname(String(storedPath).replace(/\\/g, '/'));
    if (dir && dir !== '.') addFolder(dir);
  }

  if (userId != null) addFolder(`id-${userId}`);
  for (const f of legacyUserFolders(user, userId)) addFolder(f);

  // 2–3) Candidate stem+ext under each folder
  for (const folder of folders) {
    for (const stem of stems) {
      for (const ext of exts) {
        const hit = tryRel(path.posix.join(folder, `${stem}${ext}`));
        if (hit) return hit;
      }
    }
  }

  // 4) Scan directories for stem.* (any extension already on disk)
  for (const folder of folders) {
    let absDir;
    try {
      absDir = safeJoin(root, folder);
    } catch {
      continue;
    }
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;

    let entries;
    try {
      entries = fs.readdirSync(absDir);
    } catch {
      continue;
    }

    for (const stem of stems) {
      const match = entries.find((name) => {
        const base = name.toLowerCase();
        const stemL = stem.toLowerCase();
        if (!base.startsWith(stemL + '.') && base !== stemL) return false;
        return existsSyncSafe(path.join(absDir, name));
      });
      if (match) {
        const hit = tryAbs(path.join(absDir, match));
        if (hit) return hit;
      }
    }
  }

  return null;
}

async function ensureUploadsRoot() {
  await ensureDir(getUploadRoot());
  return getUploadRoot();
}

function getUploadsRoot() {
  return getUploadRoot();
}

function saveRawRelative(relativePath, buffer) {
  return writeRelativeFile(relativePath, buffer);
}

module.exports = {
  DOC_TYPES,
  getUploadRoot,
  getUploadsRoot,
  folderForUserId,
  userFolder,
  legacyUserFolders,
  saveUserFile,
  writeRelativeFile,
  saveRawRelative,
  absoluteFromRelative,
  deleteRelativeFile,
  fileExists,
  resolveDocumentFile,
  prepareFileBuffer,
  ensureDir,
  ensureUploadsRoot,
};
