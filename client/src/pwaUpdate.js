/**
 * Force service-worker updates so mobile PWAs do not stay on a stale shell.
 * registerSW.js (vite-plugin-pwa autoUpdate) also runs; this adds a hard reload
 * when a new worker takes control, plus periodic update checks.
 *
 * Unregisters legacy /sw.js + /tl-sw.js and any older hashed /tl-sw-<build>.js
 * that is not the current build (phones were stuck on 0ee296b while server shipped newer).
 */
const LEGACY_SW_SUFFIXES = ['/sw.js', '/tl-sw.js', '/registerSW.js'];
const CURRENT_SW_BUILD_ID =
  typeof __APP_SW_BUILD_ID__ !== 'undefined' ? String(__APP_SW_BUILD_ID__ || '') : '';
const CACHE_CLEAR_MS = 30 * 60 * 1000;
const CACHE_CLEAR_KEY = 'tl-cache-cleared-at';

function isOutdatedServiceWorker(scriptURL) {
  if (!scriptURL) return false;
  if (LEGACY_SW_SUFFIXES.some((suffix) => scriptURL.endsWith(suffix))) return true;
  try {
    const path = new URL(scriptURL).pathname;
    const match = path.match(/\/tl-sw-([^/]+)\.js$/i);
    if (!match) return false;
    // Hashed worker from another build — drop it so only the current one controls.
    if (CURRENT_SW_BUILD_ID && match[1] !== CURRENT_SW_BUILD_ID) return true;
  } catch {
    return false;
  }
  return false;
}

function cacheClearDue() {
  try {
    const last = Number(localStorage.getItem(CACHE_CLEAR_KEY) || 0);
    return !last || Date.now() - last >= CACHE_CLEAR_MS;
  } catch {
    return false;
  }
}

function markCacheCleared() {
  try {
    localStorage.setItem(CACHE_CLEAR_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

/** Drop Cache Storage. Reload when asked so the open page is not left on stale files. */
export async function clearAppCache({ reload = false } = {}) {
  if (typeof window === 'undefined') return;
  markCacheCleared();
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* still reload if asked */
  }
  if (!reload) return;
  const url = new URL(window.location.href);
  url.searchParams.set('_nocache', String(Date.now()));
  window.location.replace(url.href);
}

function startAutoCacheClear() {
  try {
    if (!localStorage.getItem(CACHE_CLEAR_KEY)) markCacheCleared();
  } catch {
    return;
  }

  const tick = () => {
    if (document.visibilityState === 'hidden') return;
    if (!cacheClearDue()) return;
    clearAppCache({ reload: true });
  };

  setInterval(tick, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  tick();
}

export function startPwaUpdateWatcher() {
  if (typeof window === 'undefined') return;
  startAutoCacheClear();
  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.ready
    .then((reg) => {
      reg.update().catch(() => {});
      setInterval(() => {
        reg.update().catch(() => {});
      }, 60 * 1000);
    })
    .catch(() => {});

  // Drop legacy + outdated hashed SWs; wipe old Workbox caches that stored API 404s
  Promise.resolve()
    .then(() => navigator.serviceWorker.getRegistrations())
    .then((regs) =>
      Promise.all(
        regs.map((reg) => {
          const scriptURL =
            reg.active?.scriptURL ||
            reg.installing?.scriptURL ||
            reg.waiting?.scriptURL ||
            '';
          if (isOutdatedServiceWorker(scriptURL)) {
            console.info('[pwa] unregister outdated worker', scriptURL);
            return reg.unregister().catch(() => {});
          }
          return null;
        })
      )
    )
    .then(() => (window.caches ? caches.keys() : []))
    .then((keys) => {
      const keepPrefix = CURRENT_SW_BUILD_ID ? `tl-portal-${CURRENT_SW_BUILD_ID}` : null;
      const stale = (keys || []).filter((k) => {
        if (
          k.includes('tl-portal-images-v2') ||
          k.includes('tl-portal-pages-v2') ||
          k.includes('tl-portal-20260817') ||
          // older unversioned / v1 caches
          /^tl-portal-(images|pages)(-v1)?$/.test(k)
        ) {
          return true;
        }
        // Any prior build's Workbox / app caches
        if (k.startsWith('tl-portal-') || k.startsWith('workbox-precache')) {
          if (keepPrefix && k.includes(CURRENT_SW_BUILD_ID)) return false;
          return true;
        }
        return false;
      });
      return Promise.all(stale.map((k) => caches.delete(k)));
    })
    .catch(() => {});
}

/**
 * Wipe Cache Storage + service workers, then reload so a PWA picks up a new deploy.
 */
export async function hardEmptyCacheAndReload() {
  if (typeof window === 'undefined') return;
  markCacheCleared();
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => {})));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* still reload */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('_nocache', String(Date.now()));
  window.location.replace(url.href);
}
