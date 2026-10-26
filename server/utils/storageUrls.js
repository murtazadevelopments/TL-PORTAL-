/**
 * Turn stored local paths (or legacy Supabase paths) into authenticated API URLs
 * the browser can load with ?token= from the client.
 */

const { resolveDocumentFile } = require('../services/localStorage');

const DOC_FIELD_MAP = [
  ['profile_picture_url', 'profile'],
  ['cnic_front_url', 'cnic_front'],
  ['cnic_back_url', 'cnic_back'],
  ['cv_url', 'cv'],
  ['employment_form_url', 'employment_form'],
  ['staff_extra_1_url', 'staff_extra_1'],
  ['staff_extra_2_url', 'staff_extra_2'],
];

function documentApiPath(userId, docType) {
  if (!userId || !docType) return null;
  return `/api/documents/${userId}/${docType}`;
}

function onFileKey(field) {
  return String(field || '').replace(/_url$/, '_on_file');
}

function localFileExists(user, docType, storedPath) {
  try {
    return Boolean(
      resolveDocumentFile({
        userId: user?.id,
        docType,
        storedPath,
        user,
      })
    );
  } catch {
    return false;
  }
}

/**
 * Attach browser-readable document URLs for a user row.
 * Leaves nulls as null. Legacy https URLs are left intact until migration.
 * Missing on-disk files are not turned into /api/documents URLs (avoids img 404s).
 */
async function attachReadableUrls(user) {
  if (!user) return null;
  const result = { ...user };
  const id = result.id;

  for (const [field, docType] of DOC_FIELD_MAP) {
    const value = result[field];
    const presence = onFileKey(field);
    if (!value) {
      result[field] = null;
      result[presence] = false;
      continue;
    }
    if (/^https?:\/\//i.test(String(value))) {
      result[presence] = true;
      continue;
    }
    const exists = localFileExists(result, docType, value);
    result[presence] = exists;
    result[field] = exists ? documentApiPath(id, docType) : null;
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
  const stored = next.profile_picture_url;
  if (!stored) {
    next.profile_picture_on_file = false;
    return next;
  }
  if (/^https?:\/\//i.test(String(stored))) {
    next.profile_picture_on_file = true;
    return next;
  }
  const exists = localFileExists(next, 'profile', stored);
  next.profile_picture_on_file = exists;
  next.profile_picture_url = exists ? documentApiPath(next.id, 'profile') : null;
  return next;
}

module.exports = {
  attachReadableUrls,
  resolveStorageUrl,
  documentApiPath,
  withProfileApiUrl,
  DOC_FIELD_MAP,
};
