const NETWORK_ERROR_MESSAGE = 'Check your internet connection.';

const INFRA_LEAK =
  /hostinger|resend|supabase|vapid|database_url|jwt_secret|supabase_url|supabase_secret|upload_root|health_check_secret|db_check_secret|\.env\b|postgres(ql)?:\/\/|pooler\.|web-push|migration\s*\d+|injected env|node deploy|allowed_origins|postgresql/i;

const NETWORK_OR_ADMIN_FALLBACK =
  /unexpected (end of )?form|unexpected form error|network error|failed to fetch|load failed|server unavailable|please contact your admin/i;

function sanitizePublicString(value) {
  if (typeof value !== 'string' || !value) return value;
  if (INFRA_LEAK.test(value) || NETWORK_OR_ADMIN_FALLBACK.test(value)) {
    return NETWORK_ERROR_MESSAGE;
  }
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
  GENERIC_PUBLIC_ERROR: NETWORK_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  sanitizePublicString,
  sanitizePublicJson,
};
