/* Push / notification handlers imported into the Workbox service worker.
 * Kept in /public so generateSW can importScripts it without a rebuild of Workbox. */

self.addEventListener('push', (event) => {
  let data = {
    title: 'Textured Lab Portal',
    body: 'You have a new update.',
    url: '/account/messages',
    tag: 'portal-update',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Textured Lab Portal', {
        body: data.body || '',
        icon: '/pwa-192.png',
        badge: '/pwa-192.png',
        tag: data.tag || 'portal-update',
        renotify: true,
        data: { url: data.url || '/account/messages' },
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          try {
            client.postMessage({ type: 'PORTAL_PUSH', url: data.url || '/account' });
          } catch {
            /* ignore */
          }
        }
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/account/messages';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
