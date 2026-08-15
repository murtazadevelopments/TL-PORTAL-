/**
 * Force service-worker updates so mobile PWAs do not stay on a stale shell.
 * registerSW.js (vite-plugin-pwa autoUpdate) also runs; this adds a hard reload
 * when a new worker takes control, plus periodic update checks.
 */
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

  // One-time migration: drop legacy /sw.js registrations after tl-sw.js ships
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => {
      const scriptURL = reg.active?.scriptURL || reg.installing?.scriptURL || '';
      if (scriptURL.endsWith('/sw.js')) {
        reg.unregister().catch(() => {});
      }
    });
  });
}
