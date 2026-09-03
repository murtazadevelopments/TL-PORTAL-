const GENERIC_PUBLIC_ERROR = 'Something went wrong. Please contact your admin.';

const INFRA_LEAK =
  /hostinger|resend|supabase|vapid|database_url|jwt_secret|supabase_url|supabase_secret|upload_root|health_check_secret|db_check_secret|\.env\b|postgres(ql)?:\/\/|pooler\.|web-push|migration\s*\d+|injected env|node deploy|allowed_origins|postgresql/i;

function sanitizePublicString(value) {
  if (typeof value !== 'string' || !value) return value;
  if (INFRA_LEAK.test(value)) return GENERIC_PUBLIC_ERROR;
  return value;
}

function sanitizePublicJson(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...body };
  for (const key of ['message', 'error', 'detail']) {
    if (typeof out[key] === 'string') out[key] = sanitizePublicString(out[key]);
  }
  return out;
}

module.exports = {
  GENERIC_PUBLIC_ERROR,
  sanitizePublicString,
  sanitizePublicJson,
};
