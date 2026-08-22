import api from '../api/client';

function apiBase() {
  return String(api.defaults.baseURL || '').replace(/\/+$/, '');
}

function isOurDocumentsUrl(raw, base) {
  if (/^\/api\/documents\//i.test(raw)) return true;
  if (!base || !/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    const b = new URL(base);
    return u.origin === b.origin && /^\/api\/documents\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Turn API document paths into browser-loadable URLs (img/a tags need ?token=).
 *
 * @param {string|null|undefined} url
 * @param {string|number} [cacheKey] optional bust key (e.g. updated_at) so browsers
 *   don't keep a stale 404 after a new upload
 */
export function withAuthDocumentUrl(url, cacheKey) {
  if (!url) return null;
  const raw = String(url).trim();
  const token = localStorage.getItem('token');
  const base = apiBase();

  // Legacy Supabase / external https — leave alone (no portal token)
  if (/^https?:\/\//i.test(raw) && !isOurDocumentsUrl(raw, base)) {
    return raw;
  }

  let path;
  if (isOurDocumentsUrl(raw, base) && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      path = `${u.pathname}${u.search || ''}`;
    } catch {
      path = raw;
    }
  } else {
    path = raw.startsWith('/') ? raw : `/${raw}`;
  }

  // Relative storage paths should never hit <img> directly
  if (!path.startsWith('/api/')) {
    return null;
  }

  const params = new URLSearchParams();
  // Preserve existing query (except we rebuild token/cache)
  try {
    const existing = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
    const pathname = path.includes('?') ? path.slice(0, path.indexOf('?')) : path;
    const old = new URLSearchParams(existing);
    old.forEach((v, k) => {
      if (k !== 'token' && k !== '_cb') params.set(k, v);
    });
    path = pathname;
  } catch {
    /* ignore */
  }

  if (token) params.set('token', token);
  if (cacheKey != null && String(cacheKey)) {
    params.set('_cb', String(cacheKey).replace(/\W/g, '').slice(-16));
  }

  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}
