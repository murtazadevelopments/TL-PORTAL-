/**
 * Force service-worker updates so mobile PWAs do not stay on a stale shell.
 * registerSW.js (vite-plugin-pwa autoUpdate) also runs; this adds a hard reload
 * when a new worker takes control, plus periodic update checks.
 *
 * Also clears legacy workers (/sw.js, /tl-sw.js) and any cache that may hold
 * stale /api/document 404 responses from the old image CacheFirst rule.
 */
const LEGACY_SW_SUFFIXES = ['/sw.js', '/tl-sw.js'];

export function startPwaUpdateWatcher() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

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

  // Drop legacy SW registrations + wipe old Workbox caches that stored API 404s
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
          const isLegacy = LEGACY_SW_SUFFIXES.some((suffix) =>
            scriptURL.endsWith(suffix)
          );
          // Also drop any worker whose URL still looks like pre-build-id tl-sw.js
          // without the dated filename (handled above). Keep dated tl-sw-*.js.
          if (isLegacy) return reg.unregister().catch(() => {});
          return null;
        })
      )
    )
    .then(() => (window.caches ? caches.keys() : []))
    .then((keys) => {
      const stale = (keys || []).filter(
        (k) =>
          k.includes('tl-portal-images-v2') ||
          k.includes('tl-portal-pages-v2') ||
          k.includes('tl-portal-20260817') ||
          k.includes('workbox-precache') ||
          // older unversioned / v1 caches
          /^tl-portal-(images|pages)(-v1)?$/.test(k)
      );
      return Promise.all(stale.map((k) => caches.delete(k)));
    })
    .catch(() => {});
}
