/**
 * One-time migration: Supabase Storage → Hostinger private_uploads.
 *
 * Does NOT delete anything from Supabase Storage (safety backup).
 *
 * Usage (from server/):
 *   node scripts/migrate-storage-to-local.js --inventory   # count/size only
 *   node scripts/migrate-storage-to-local.js --dry-run     # download plan, no writes
 *   node scripts/migrate-storage-to-local.js               # download + update DB paths
 *
 * Requires SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL, and optional UPLOAD_ROOT.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const pool = require('../config/db');
const { supabase, BUCKETS } = require('../config/supabaseClient');
const {
  userFolder,
  writeRelativeFile,
  getUploadRoot,
  fileExists,
} = require('../services/localStorage');

const FIELDS = [
  { column: 'profile_picture_url', bucket: BUCKETS.profile, docType: 'profile' },
  { column: 'cnic_front_url', bucket: BUCKETS.cnic, docType: 'cnic_front' },
  { column: 'cnic_back_url', bucket: BUCKETS.cnic, docType: 'cnic_back' },
  { column: 'cv_url', bucket: BUCKETS.cv, docType: 'cv' },
];

/**
 * Resolve a DB value into a Supabase object path (never treat relative paths as
 * "already local" — historical rows store bucket-relative object keys).
 */
function toObjectPath(value, bucket) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;

  if (!/^https?:\/\//i.test(v)) {
    return v.replace(/^\/+/, '');
  }

  const patterns = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
  ];

  for (const marker of patterns) {
    const idx = v.indexOf(marker);
    if (idx !== -1) {
      return decodeURIComponent(v.slice(idx + marker.length).split('?')[0]);
    }
  }

  return null;
}

function extFromObjectPath(objectPath, docType) {
  const ext = path.extname(objectPath || '').toLowerCase();
  if (ext) return ext;
  return docType === 'cv' ? '.pdf' : '.jpg';
}

async function listBucketRecursive(bucket, prefix = '') {
  const out = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    offset: 0,
  });
  if (error) {
    console.warn(`[inventory] list ${bucket}/${prefix}:`, error.message);
    return out;
  }

  for (const item of data || []) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    const isFolder =
      item.id == null ||
      (item.metadata == null && !/\.[a-z0-9]+$/i.test(item.name));
    if (isFolder && item.metadata == null) {
      const nested = await listBucketRecursive(bucket, full);
      if (nested.length) {
        out.push(...nested);
        continue;
      }
    }
    out.push({
      path: full,
      size: item.metadata?.size ?? item.metadata?.contentLength ?? 0,
    });
  }
  return out;
}

async function inventoryBuckets() {
  const summary = [];
  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of Object.values(BUCKETS)) {
    const files = await listBucketRecursive(bucket);
    const bytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
    totalFiles += files.length;
    totalBytes += bytes;
    summary.push({ bucket, files: files.length, bytes });
    console.log(
      `[inventory] ${bucket}: ${files.length} files, ${(bytes / (1024 * 1024)).toFixed(2)} MB`
    );
  }

  console.log(
    `[inventory] TOTAL: ${totalFiles} files, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
  );
  return { totalFiles, totalBytes, summary };
}

async function downloadObject(bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error) throw new Error(error.message);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

async function migrateUsers({ dryRun = false } = {}) {
  const { rows } = await pool.query(`
    SELECT id, employee_id, username,
           profile_picture_url, cnic_front_url, cnic_back_url, cv_url
    FROM users
    ORDER BY id
  `);

  const stats = {
    users: rows.length,
    migrated: 0,
    skippedAlready: 0,
    failed: 0,
    bytes: 0,
  };

  console.log(`[migrate] UPLOAD_ROOT=${getUploadRoot()}`);
  console.log(`[migrate] users=${rows.length} dryRun=${dryRun}`);

  for (const user of rows) {
    const updates = {};
    let userChanged = false;
    const folder = userFolder(user);

    for (const field of FIELDS) {
      const raw = user[field.column];
      if (!raw) continue;

      const objectPath = toObjectPath(raw, field.bucket);
      if (!objectPath) {
        console.warn(`[migrate] user ${user.id} ${field.column}: unparseable value`);
        stats.failed += 1;
        continue;
      }

      const ext = extFromObjectPath(objectPath, field.docType);
      const relativePath = path.posix.join(folder, `${field.docType}${ext}`);

      // Already migrated to the canonical local path
      if (String(raw) === relativePath && (await fileExists(relativePath))) {
        stats.skippedAlready += 1;
        continue;
      }

      // Destination already on disk (e.g. partial prior run) — just fix DB pointer
      if (await fileExists(relativePath)) {
        if (String(raw) !== relativePath) {
          updates[field.column] = relativePath;
          userChanged = true;
        }
        stats.skippedAlready += 1;
        continue;
      }

      try {
        if (dryRun) {
          console.log(
            `[dry-run] user ${user.id} ${field.docType}: ${field.bucket}/${objectPath} → ${relativePath}`
          );
          stats.migrated += 1;
          continue;
        }

        const buffer = await downloadObject(field.bucket, objectPath);
        await writeRelativeFile(relativePath, buffer);
        updates[field.column] = relativePath;
        userChanged = true;
        stats.migrated += 1;
        stats.bytes += buffer.length;
        console.log(
          `[migrate] user ${user.id} ${field.docType}: ${objectPath} → ${relativePath} (${buffer.length} bytes)`
        );
      } catch (err) {
        stats.failed += 1;
        console.error(
          `[migrate] FAIL user ${user.id} ${field.docType} (${field.bucket}/${objectPath}):`,
          err.message
        );
      }
    }

    if (!dryRun && userChanged && Object.keys(updates).length) {
      const sets = [];
      const vals = [];
      let i = 1;
      for (const [col, val] of Object.entries(updates)) {
        sets.push(`${col} = $${i++}`);
        vals.push(val);
      }
      vals.push(user.id);
      await pool.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
        vals
      );
    }
  }

  console.log('[migrate] done:', stats);
  return stats;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const inventoryOnly = args.has('--inventory');
  const dryRun = args.has('--dry-run');

  try {
    const inventory = await inventoryBuckets();

    if (inventoryOnly) {
      return;
    }

    const stats = await migrateUsers({ dryRun });
    console.log(
      JSON.stringify(
        {
          inventory,
          migration: stats,
          note: 'Supabase Storage objects were NOT deleted.',
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
