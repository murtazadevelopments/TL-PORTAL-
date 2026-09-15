const NETWORK_ERROR_MESSAGE = 'Check your internet connection.';

const INFRA_LEAK =
  /hostinger|resend|supabase|vapid|database_url|jwt_secret|supabase_url|supabase_secret|upload_root|health_check_secret|\.env\b|postgres(ql)?:\/\/|pooler\.|web-push|migration\s*\d+|injected env|node deploy|postgresql/i;

const NETWORK_OR_ADMIN_FALLBACK =
  /unexpected (end of )?form|unexpected form error|network error|failed to fetch|load failed|server unavailable|please contact your admin/i;

export function sanitizePublicError(value) {
  if (typeof value !== 'string' || !value) return value;
  if (INFRA_LEAK.test(value) || NETWORK_OR_ADMIN_FALLBACK.test(value)) {
    return NETWORK_ERROR_MESSAGE;
  }
  return value;
}

export function isNetworkFailure(error) {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const code = String(error.code || '');
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  if (!error.response && error.request) return true;
  const msg = String(error.message || '');
  return /network error|failed to fetch|load failed/i.test(msg);
}

export function attachNetworkErrorMessage(error) {
  if (!isNetworkFailure(error)) return error;
  if (!error.response) {
    error.response = { status: 0, data: { message: NETWORK_ERROR_MESSAGE } };
  } else if (error.response.data && typeof error.response.data === 'object') {
    error.response.data.message = NETWORK_ERROR_MESSAGE;
  } else {
    error.response.data = { message: NETWORK_ERROR_MESSAGE };
  }
  error.message = NETWORK_ERROR_MESSAGE;
  return error;
}

export function sanitizePublicPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (typeof data.message === 'string') data.message = sanitizePublicError(data.message);
  if (typeof data.error === 'string') data.error = sanitizePublicError(data.error);
  if (typeof data.detail === 'string') data.detail = sanitizePublicError(data.detail);
  return data;
}

export { NETWORK_ERROR_MESSAGE };
