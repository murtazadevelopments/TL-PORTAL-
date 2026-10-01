import axios from 'axios';
import { sanitizePublicError, sanitizePublicPayload, attachNetworkErrorMessage } from '../utils/sanitizePublicError';
import { showSuccess } from '../utils/successPopup';

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

const SUCCESS_SKIP =
  /\/api\/auth\/(login|signin)|\/api\/users\/me$|unread-count|\/api\/push\//;

function maybeShowSuccessPopup(response) {
  const method = String(response.config?.method || '').toLowerCase();
  if (!['post', 'put', 'patch', 'delete'].includes(method)) return;
  const url = String(response.config?.url || '');
  if (SUCCESS_SKIP.test(url)) return;
  if (response.config?.skipSuccessPopup) return;
  const message = response.data?.message;
  if (typeof message !== 'string' || !message.trim()) return;
  const status = response.status;
  if (status < 200 || status >= 300) return;
  showSuccess(message.trim());
}

api.interceptors.response.use(
  (response) => {
    if (response.data) sanitizePublicPayload(response.data);
    maybeShowSuccessPopup(response);
    return response;
  },
  (error) => {
    attachNetworkErrorMessage(error);
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const url = String(error.config?.url || '');
    const isPublicAuth = /\/api\/auth\//.test(url);
    const isAttendanceCheckIn = /\/api\/attendance\/check-in/.test(url);

    if (error.response?.data) {
      error.response.data = sanitizePublicPayload(error.response.data);
    }
    if (typeof error.message === 'string') {
      error.message = sanitizePublicError(error.message);
    }

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
