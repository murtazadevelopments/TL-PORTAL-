import axios from 'axios';

/**
 * Backend origin from Vite env (no trailing slash).
 * Supports VITE_API_BASE_URL (preferred) and legacy VITE_API_URL.
 * Paths in the app are always `/api/...` so we never get `//api`.
 */
function normalizeBaseUrl(value) {
  if (value === undefined || value === null) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

const baseURL = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL
);

const api = axios.create({
  baseURL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Ensure request path starts with a single leading slash when joining baseURL
  if (typeof config.url === 'string' && config.url.length > 0 && !config.url.startsWith('http')) {
    config.url = `/${config.url.replace(/^\/+/, '')}`;
  }
  return config;
});

const SESSION_ENDED_CODES = new Set([
  'ACCOUNT_BLOCKED',
  'ACCOUNT_DEACTIVATED',
  'ACCOUNT_LOCKED',
]);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const url = String(error.config?.url || '');
    const isPublicAuth = /\/api\/auth\//.test(url);
    const isAttendanceCheckIn = /\/api\/attendance\/check-in/.test(url);

    if (
      !isPublicAuth &&
      !isAttendanceCheckIn &&
      (status === 401 || (status === 403 && SESSION_ENDED_CODES.has(code)))
    ) {
      localStorage.removeItem('token');
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.assign('/');
      }
    }

    return Promise.reject(error);
  }
);

export default api;
