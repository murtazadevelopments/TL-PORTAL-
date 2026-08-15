/* Migration kill-switch for phones stuck on the old "Portal TL" PWA.
 * Old clients still register /sw.js; this worker clears caches, unregisters, and reloads.
 * Current app registers /tl-sw.js instead — leave this file in place until all clients migrate.
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      await Promise.all(
        clients.map((client) => {
          if ('navigate' in client) {
            return client.navigate(client.url.includes('pwa-reset') ? '/' : client.url);
          }
          return null;
        })
      );
    })()
  );
});
