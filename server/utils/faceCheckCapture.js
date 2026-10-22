const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pool = require('../config/db');
const {
  writeRelativeFile,
  absoluteFromRelative,
  fileExists,
  deleteRelativeFile,
} = require('../services/localStorage');

let ensured = false;
let ensurePromise = null;

async function ensureFaceCheckCapture() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS face_check_capture BOOLEAN NOT NULL DEFAULT false
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS face_check_captures (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          attendance_log_id BIGINT REFERENCES attendance_logs(id) ON DELETE SET NULL,
          hour_key TEXT,
          status TEXT,
          match_score DOUBLE PRECISION,
          image_path TEXT NOT NULL,
          captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS face_check_captures_captured_idx
          ON face_check_captures (captured_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS face_check_captures_user_idx
          ON face_check_captures (user_id, captured_at DESC)
      `);
      await pool.query(`
        ALTER TABLE face_check_captures
          ADD COLUMN IF NOT EXISTS image_bytes BYTEA
      `);
      ensured = true;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

function userFaceCheckCapture(user) {
  return user?.face_check_capture === true;
}

async function setUserFaceCheckCapture(userId, enabled) {
  await ensureFaceCheckCapture();
  const { rows } = await pool.query(
    `
      UPDATE users
      SET face_check_capture = $2
      WHERE id = $1
      RETURNING id, face_check_capture
    `,
    [userId, Boolean(enabled)]
  );
  return rows[0] || null;
}

function parseSnapshot(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i);
  const b64 = match ? match[1] : /^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 400 ? text : null;
  if (!b64) return null;
  try {
    const buffer = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    if (buffer.length < 400 || buffer.length > 1_200_000) return null;
    return buffer;
  } catch {
    return null;
  }
}

async function saveCheckInSnapshot(userId, log, snapshotRaw) {
  if (!log?.id) return null;
  const input = parseSnapshot(snapshotRaw);
  if (!input) return null;
  let jpeg;
  try {
    jpeg = await sharp(input)
      .rotate()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
  const relativePath = path.posix.join(`id-${userId}`, 'face-checks', `${log.id}.jpg`);
  try {
    await writeRelativeFile(relativePath, jpeg);
  } catch (err) {
    console.error('face check file write:', err.message || err);
  }
  const { rows } = await pool.query(
    `
      INSERT INTO face_check_captures (
        user_id, attendance_log_id, hour_key, status, match_score, image_path, image_bytes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [userId, log.id, log.hour_key || null, log.status || null, log.match_score ?? null, relativePath, jpeg]
  );
  return rows[0]?.id || null;
}

function captureFilePath(imagePath) {
  return absoluteFromRelative(imagePath);
}

async function streamCaptureImage(row, res) {
  const bytes = row?.image_bytes;
  if (bytes && bytes.length) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('Content-Disposition', 'inline; filename="face-check.jpg"');
    res.end(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    return true;
  }
  const imagePath = row?.image_path;
  const abs = captureFilePath(imagePath);
  if (!abs || !(await fileExists(imagePath))) return false;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('Content-Disposition', 'inline; filename="face-check.jpg"');
  fs.createReadStream(abs).pipe(res);
  return true;
}

async function deleteAllFaceCheckCaptures() {
  await ensureFaceCheckCapture();
  const { rows } = await pool.query(`SELECT image_path FROM face_check_captures`);
  for (const row of rows) {
    if (row.image_path) await deleteRelativeFile(row.image_path);
  }
  const deleted = await pool.query(`DELETE FROM face_check_captures`);
  return deleted.rowCount || 0;
}

module.exports = {
  ensureFaceCheckCapture,
  userFaceCheckCapture,
  setUserFaceCheckCapture,
  saveCheckInSnapshot,
  captureFilePath,
  streamCaptureImage,
  deleteAllFaceCheckCaptures,
};
