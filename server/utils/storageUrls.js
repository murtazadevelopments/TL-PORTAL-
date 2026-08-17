/**
 * Turn stored local paths (or legacy Supabase paths) into authenticated API URLs
 * the browser can load with ?token= from the client.
 */

const DOC_FIELD_MAP = [
  ['profile_picture_url', 'profile'],
  ['cnic_front_url', 'cnic_front'],
  ['cnic_back_url', 'cnic_back'],
  ['cv_url', 'cv'],
];

function documentApiPath(userId, docType) {
  if (!userId || !docType) return null;
  return `/api/documents/${userId}/${docType}`;
}

/**
 * Attach browser-readable document URLs for a user row.
 * Leaves nulls as null. Legacy https URLs are left intact until migration.
 */
async function attachReadableUrls(user) {
  if (!user) return null;
  const result = { ...user };
  const id = result.id;

  for (const [field, docType] of DOC_FIELD_MAP) {
    const value = result[field];
    if (!value) {
      result[field] = null;
      continue;
    }
    if (/^https?:\/\//i.test(String(value))) {
      // Still a remote signed/public URL (pre-migration) — keep as-is
      continue;
    }
    // Local relative path → authenticated API route
    result[field] = documentApiPath(id, docType);
  }

  return result;
}

/** List endpoints only need profile thumbs. */
async function resolveStorageUrl(value, _bucket) {
  // Kept for call-site compatibility; prefer attachReadableUrls with user id.
  if (!value) return null;
  if (/^https?:\/\//i.test(String(value))) return value;
  return value;
}

function withProfileApiUrl(row) {
  if (!row) return null;
  const next = { ...row };
  if (next.profile_picture_url && !/^https?:\/\//i.test(String(next.profile_picture_url))) {
    next.profile_picture_url = documentApiPath(next.id, 'profile');
  }
  return next;
}

module.exports = {
  attachReadableUrls,
  resolveStorageUrl,
  documentApiPath,
  withProfileApiUrl,
  DOC_FIELD_MAP,
};
