const GENERIC_PUBLIC_ERROR = 'Something went wrong. Please contact your admin.';

const INFRA_LEAK =
  /hostinger|resend|supabase|vapid|database_url|jwt_secret|supabase_url|supabase_secret|upload_root|health_check_secret|\.env\b|postgres(ql)?:\/\/|pooler\.|web-push|migration\s*\d+|injected env|node deploy|postgresql/i;

export function sanitizePublicError(value) {
  if (typeof value !== 'string' || !value) return value;
  if (INFRA_LEAK.test(value)) return GENERIC_PUBLIC_ERROR;
  return value;
}

export function sanitizePublicPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (typeof data.message === 'string') data.message = sanitizePublicError(data.message);
  if (typeof data.error === 'string') data.error = sanitizePublicError(data.error);
  if (typeof data.detail === 'string') data.detail = sanitizePublicError(data.detail);
  return data;
}
