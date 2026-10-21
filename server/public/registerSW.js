/* Stale clients still load /registerSW.js from CDN — force a full PWA reset once. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    Promise.resolve()
      .then(() => navigator.serviceWorker.getRegistrations())
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => (window.caches ? caches.keys() : []))
      .then((keys) => Promise.all((keys || []).map((k) => caches.delete(k))))
      .then(() => {
        location.replace('/?pwa=fresh');
      })
      .catch(() => {
        location.replace('/?pwa=fresh');
      });
  });
}
