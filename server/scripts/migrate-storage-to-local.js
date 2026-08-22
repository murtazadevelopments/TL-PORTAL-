#!/usr/bin/env node
/**
 * One-time migration: Supabase Storage → Hostinger private_uploads
 *
 * Resolves the REAL Storage object key for each DB column value (DB paths are
 * often stale/wrong, e.g. u16/cv.pdf vs user-haider_rizvi71/cv.pdf).
 *
 * - Downloads CNIC / CV / profile files from Supabase Storage
 * - Writes them under private_uploads/id-{userId}/
 * - Updates users.*_url columns to the new relative paths
 * - Does NOT delete anything from Supabase (safety backup)
 *
 * Usage (from server/):
 *   node scripts/migrate-storage-to-local.js
 *   node scripts/migrate-storage-to-local.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../config/db');
const { supabase, BUCKETS } = require('../config/supabaseClient');
const {
  DOC_TYPES,
  folderForUserId,
  saveRawRelative,
  ensureUploadsRoot,
  getUploadsRoot,
  absoluteFromRelative,
} = require('../services/localStorage');
const fs = require('fs');

const dryRun = process.argv.includes('--dry-run');
const filesOnly = process.argv.includes('--files-only');

const FIELD_BUCKET = {
  cnic_front_url: BUCKETS.cnic,
  cnic_back_url: BUCKETS.cnic,
  cv_url: BUCKETS.cv,
  profile_picture_url: BUCKETS.profile,
};

const FIELD_DOC = {
  cnic_front_url: 'cnic_front',
  cnic_back_url: 'cnic_back',
  cv_url: 'cv',
  profile_picture_url: 'profile_picture',
};

/** Filename patterns per logical doc type (actual Storage names vary). */
const DOC_FILE_RE = {
  cnic_front: /^cnic_front\./i,
  cnic_back: /^cnic_back\./i,
  cv: /^cv\.pdf$/i,
  profile_picture: /^(profile|profile_picture)\./i,
};

function toObjectPath(value, bucket) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');

  const patterns = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
  ];
  for (const marker of patterns) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) {
      return decodeURIComponent(raw.slice(idx + marker.length).split('?')[0]);
    }
  }
  // Generic /object/{bucket}/...
  const generic = raw.match(
    new RegExp(`/storage/v1/object/(?:public|sign|authenticated)/${bucket}/([^?]+)`)
  );
  if (generic) return decodeURIComponent(generic[1]);
  return null;
}

function alreadyLocal(value) {
  if (!value || /^https?:\/\//i.test(value)) return false;
  return String(value).startsWith('id-');
}

function extFromObjectPath(objectPath, docType) {
  const ext = path.extname(objectPath || '').toLowerCase();
  if (ext) return ext;
  return DOC_TYPES[docType]?.defaultExt || '.bin';
}

async function listAllObjects(bucket, prefix = '') {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix || '', {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        out.push(...(await listAllObjects(bucket, full)));
      } else {
        out.push(full);
      }
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return out;
}

function normalizeFolderToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '');
}

function candidateFolders(user, storedPath) {
  const folders = new Set();
  const add = (f) => {
    if (f && String(f).trim()) folders.add(String(f).trim());
  };

  if (storedPath && storedPath.includes('/')) add(storedPath.split('/')[0]);

  if (user.username) {
    add(`user-${user.username}`);
    add(user.username);
  }

  if (user.employee_id) {
    const emp = String(user.employee_id).trim();
    add(emp);
    add(emp.replace(/\s+/g, '_'));
    add(emp.replace(/\s+/g, '-'));
    add(emp.replace(/\s+/g, ''));
    // Emp 2 → Emp_2 already covered; also EMP- style
    if (!/^emp-/i.test(emp)) add(`EMP-${emp}`);
  }

  add(`u${user.id}`);
  add(`id-${user.id}`);
  add(`user-${user.id}`);

  return [...folders];
}

/**
 * Resolve DB path → real Storage object key using the live bucket listing.
 * @returns {{ path: string|null, strategy: string, tried: string[] }}
 */
function resolveObjectPath({ user, column, stored, bucketPaths }) {
  const docType = FIELD_DOC[column];
  const fileRe = DOC_FILE_RE[docType];
  const tried = [];
  const exactStored = toObjectPath(stored, FIELD_BUCKET[column]) || String(stored || '').trim();

  const pathSet = new Set(bucketPaths);

  // 1) Exact DB value (after URL parse)
  if (exactStored) {
    tried.push(exactStored);
    if (pathSet.has(exactStored)) {
      return { path: exactStored, strategy: 'exact-db', tried };
    }
  }

  const folders = candidateFolders(user, exactStored);
  const basename = exactStored ? path.basename(exactStored) : null;

  // 2) Same basename under candidate folders
  if (basename) {
    for (const folder of folders) {
      const cand = `${folder}/${basename}`;
      tried.push(cand);
      if (pathSet.has(cand)) {
        return { path: cand, strategy: `folder+basename:${folder}`, tried };
      }
    }
  }

  // 3) Doc-type filename pattern under candidate folders
  for (const folder of folders) {
    const matches = bucketPaths.filter((p) => {
      if (!p.startsWith(`${folder}/`)) return false;
      const name = p.slice(folder.length + 1);
      return !name.includes('/') && fileRe.test(name);
    });
    if (matches.length === 1) {
      tried.push(...matches);
      return { path: matches[0], strategy: `folder+pattern:${folder}`, tried };
    }
    if (matches.length > 1) {
      // Prefer basename match, else first alphabetically stable
      const preferred =
        (basename && matches.find((m) => path.basename(m) === basename)) ||
        matches.sort()[0];
      tried.push(...matches);
      return { path: preferred, strategy: `folder+pattern-multi:${folder}`, tried };
    }
  }

  // 4) Fuzzy: any path under user-{username}/ matching doc pattern
  if (user.username) {
    const prefix = `user-${user.username}/`;
    const matches = bucketPaths.filter(
      (p) => p.startsWith(prefix) && fileRe.test(path.basename(p))
    );
    if (matches.length) {
      tried.push(...matches);
      return {
        path: matches.sort()[0],
        strategy: 'user-prefix',
        tried,
      };
    }
  }

  // 5) Fuzzy folder token match (normalized) against all folders in bucket
  const tokens = new Set(
    candidateFolders(user, exactStored).map(normalizeFolderToken).filter(Boolean)
  );
  if (user.username) tokens.add(normalizeFolderToken(user.username));

  const fuzzy = bucketPaths.filter((p) => {
    const folder = p.split('/')[0];
    const name = path.basename(p);
    if (!fileRe.test(name)) return false;
    const norm = normalizeFolderToken(folder);
    if (tokens.has(norm)) return true;
    // username contained in folder (user-haider_rizvi71)
    if (user.username && norm.includes(normalizeFolderToken(user.username))) return true;
    return false;
  });

  if (fuzzy.length === 1) {
    tried.push(...fuzzy);
    return { path: fuzzy[0], strategy: 'fuzzy-token', tried };
  }
  if (fuzzy.length > 1) {
    tried.push(...fuzzy);
    return { path: fuzzy.sort()[0], strategy: 'fuzzy-token-multi', tried };
  }

  return { path: null, strategy: 'unresolved', tried };
}

async function downloadObject(bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error) throw new Error(error.message || 'download failed');
  return Buffer.from(await data.arrayBuffer());
}

async function main() {
  console.log(`Uploads root: ${getUploadsRoot()}`);
  console.log(
    dryRun
      ? 'DRY RUN — no writes'
      : filesOnly
        ? 'FILES ONLY — write local files, leave DB paths unchanged'
        : 'LIVE RUN — will write files + update DB'
  );
  await ensureUploadsRoot();

  console.log('\nListing live Supabase Storage objects…');
  const bucketIndex = {};
  for (const bucket of Object.values(BUCKETS)) {
    bucketIndex[bucket] = await listAllObjects(bucket);
    console.log(`  ${bucket}: ${bucketIndex[bucket].length} objects`);
  }

  const { rows } = await pool.query(`
    SELECT id, username, employee_id,
           cnic_front_url, cnic_back_url, cv_url, profile_picture_url
    FROM users
    ORDER BY id ASC
  `);

  let migrated = 0;
  let skippedEmpty = 0;
  let skippedLocal = 0;
  let failed = 0;
  let bytes = 0;
  const failures = [];
  const resolutions = [];

  for (const user of rows) {
    const updates = {};

    for (const [column, bucket] of Object.entries(FIELD_BUCKET)) {
      const stored = user[column];
      if (!stored) {
        skippedEmpty += 1;
        continue;
      }
      if (alreadyLocal(stored)) {
        const abs = absoluteFromRelative(stored);
        if (abs && fs.existsSync(abs)) {
          skippedLocal += 1;
          continue;
        }
      }

      const docType = FIELD_DOC[column];
      const resolved = resolveObjectPath({
        user,
        column,
        stored,
        bucketPaths: bucketIndex[bucket] || [],
      });

      resolutions.push({
        userId: user.id,
        username: user.username,
        column,
        dbValue: stored,
        resolvedPath: resolved.path,
        strategy: resolved.strategy,
      });

      if (!resolved.path) {
        failed += 1;
        failures.push({
          userId: user.id,
          username: user.username,
          column,
          dbValue: stored,
          error: 'Object not found after resolution',
          tried: resolved.tried.slice(0, 12),
        });
        console.error(
          `FAIL user=${user.id} (${user.username || '—'}) ${column} db=${stored} → unresolved`
        );
        continue;
      }

      try {
        // Dry-run: verify object exists via download HEAD-equivalent (download)
        // without writing to disk / updating DB.
        const buf = await downloadObject(bucket, resolved.path);
        const ext = extFromObjectPath(resolved.path, docType);
        const rel = `${folderForUserId(user.id)}/${docType}${ext}`;

        if (!dryRun) {
          await saveRawRelative(rel, buf);
          // Also place a copy at the existing DB relative path so Hostinger/local
          // resolveDocumentFile finds the exact stored path.
          const storedRel = String(stored || '').replace(/\\/g, '/');
          if (storedRel && !/^https?:\/\//i.test(storedRel) && storedRel !== rel) {
            try {
              await saveRawRelative(storedRel, buf);
            } catch (copyErr) {
              console.warn(`Could not copy to stored path ${storedRel}:`, copyErr.message);
            }
          }
          if (!filesOnly) updates[column] = rel;
        }

        migrated += 1;
        bytes += buf.length;
        const note =
          resolved.path === String(stored).replace(/^\/+/, '')
            ? ''
            : ` [resolved via ${resolved.strategy}]`;
        console.log(
          `OK user=${user.id} ${column} db=${stored} ← ${resolved.path} (${buf.length} bytes) → ${rel}${note}`
        );
      } catch (err) {
        failed += 1;
        failures.push({
          userId: user.id,
          username: user.username,
          column,
          dbValue: stored,
          path: resolved.path,
          error: err.message,
        });
        console.error(
          `FAIL user=${user.id} ${column} resolved=${resolved.path}: ${err.message}`
        );
      }
    }

    if (!dryRun && Object.keys(updates).length) {
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

  console.log('\n=== Path resolution map (db → storage) ===');
  for (const r of resolutions) {
    console.log(
      `user ${r.userId} ${r.column}: ${r.dbValue} → ${r.resolvedPath || 'MISSING'} (${r.strategy})`
    );
  }

  console.log('\n=== Migration summary ===');
  console.log(`Users scanned: ${rows.length}`);
  console.log(`Files resolved & downloadable: ${migrated}`);
  console.log(`Skipped (empty column): ${skippedEmpty}`);
  console.log(`Skipped (already local on disk): ${skippedLocal}`);
  console.log(`Failed: ${failed}`);
  console.log(`Bytes ${dryRun ? 'verified' : 'written'}: ${bytes} (~${(bytes / (1024 * 1024)).toFixed(2)} MB)`);
  if (failures.length) {
    console.log('Failures:', JSON.stringify(failures, null, 2));
  }
  console.log(
    dryRun
      ? 'Dry run complete — re-run without --dry-run to apply.'
      : 'Done. Supabase originals were NOT deleted.'
  );

  await pool.end();
  if (failed > 0) process.exitCode = 2;
}

main().catch(async (err) => {
  console.error('Migration aborted:', err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
