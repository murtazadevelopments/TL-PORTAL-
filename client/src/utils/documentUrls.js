import api from '../api/client';

/**
 * Turn API document paths into browser-loadable URLs (img/a tags need ?token=).
 * Absolute http(s) URLs (legacy signed) are returned unchanged.
 */
export function withAuthDocumentUrl(url) {
  if (!url) return null;
  const raw = String(url);
  if (/^https?:\/\//i.test(raw)) return raw;

  const token = localStorage.getItem('token');
  if (!token) return raw;

  const base = String(api.defaults.baseURL || '').replace(/\/+$/, '');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${path}${sep}token=${encodeURIComponent(token)}`;
}
