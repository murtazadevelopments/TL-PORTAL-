const { supabase, BUCKETS } = require('../config/supabaseClient');

/**
 * Extract a storage object path from a full Supabase URL, or return the path as-is.
 */
function toObjectPath(value, bucket) {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;

  const patterns = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
  ];

  for (const marker of patterns) {
    const idx = value.indexOf(marker);
    if (idx !== -1) {
      return decodeURIComponent(value.slice(idx + marker.length).split('?')[0]);
    }
  }

  return null;
}

/**
 * Always return a usable browser URL.
 * Profile bucket may be "public" but still blocked by policies — signed URLs work either way.
 */
async function resolveStorageUrl(value, bucket, expiresIn = 60 * 60 * 24) {
  if (!value) return null;

  const objectPath = toObjectPath(value, bucket) || (!/^https?:\/\//i.test(value) ? value : null);

  if (objectPath) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, expiresIn);

    if (!error && data?.signedUrl) return data.signedUrl;
    console.error(`signed URL error (${bucket}/${objectPath}):`, error?.message);
  }

  // Fallback: return original value (may work for true public URLs)
  return value;
}

async function attachReadableUrls(user) {
  if (!user) return null;

  const result = { ...user };

  result.profile_picture_url = await resolveStorageUrl(
    result.profile_picture_url,
    BUCKETS.profile
  );
  result.cnic_front_url = await resolveStorageUrl(result.cnic_front_url, BUCKETS.cnic);
  result.cnic_back_url = await resolveStorageUrl(result.cnic_back_url, BUCKETS.cnic);
  result.cv_url = await resolveStorageUrl(result.cv_url, BUCKETS.cv);

  return result;
}

module.exports = {
  toObjectPath,
  resolveStorageUrl,
  attachReadableUrls,
  BUCKETS,
};
