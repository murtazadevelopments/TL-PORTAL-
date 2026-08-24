import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Bump when SW routing/caching rules change — forces clients onto a new worker URL. */
const SW_BUILD_ID = '20260818b';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Inline into index.html so CDN cannot serve a stale registerSW.js
      injectRegister: 'inline',
      // New filename each SW_BUILD_ID bypasses Hostinger CDN cache of old workers
      filename: `tl-sw-${SW_BUILD_ID}.js`,
      // Use public/manifest.json (linked from index.html)
      manifest: false,
      includeAssets: [
        'favicon.png',
        'favicon-32.png',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-512-maskable.png',
        'manifest.json',
        'push-handlers.js',
      ],
      workbox: {
        // Prefix all Workbox cache names (forces drop of old cached 404s)
        cacheId: `tl-portal-${SW_BUILD_ID}`,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Web Push handlers (mobile installed PWA)
        importScripts: ['push-handlers.js'],
        // App-shell caching for offline shell support (static only)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest,json}'],
        // Brand logo asset is huge (~3MB) — don't precache the full file
        globIgnores: ['**/logo-*.png', '**/favicon.png', '**/models/**'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Never SPA-fallback API or reset routes
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/pwa-reset(?:\.html)?$/],
        runtimeCaching: [
          // CRITICAL: /api/* must never be cached (documents, auth, profile).
          // Put first so it wins over the image CacheFirst rule — <img src="/api/documents/...">
          // has destination "image" and was previously caching stale 404s.
          // Matcher body must be fully self-contained (Workbox serializes the function only).
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api' || url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api' || url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api' || url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'PUT',
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api' || url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'PATCH',
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api' || url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'DELETE',
          },
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              !(url.pathname === '/api' || url.pathname.startsWith('/api/')),
            handler: 'NetworkFirst',
            options: {
              cacheName: `tl-portal-pages-${SW_BUILD_ID}`,
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Static images only — never /api/document streams
            urlPattern: ({ request, url }) =>
              request.destination === 'image' &&
              !(url.pathname === '/api' || url.pathname.startsWith('/api/')),
            handler: 'CacheFirst',
            options: {
              cacheName: `tl-portal-images-${SW_BUILD_ID}`,
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              (request.destination === 'style' ||
                request.destination === 'script' ||
                request.destination === 'font') &&
              !(url.pathname === '/api' || url.pathname.startsWith('/api/')),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: `tl-portal-assets-${SW_BUILD_ID}`,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 14,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/face-api.js') || id.includes('node_modules/@tensorflow')) {
            return 'face-api';
          }
        },
      },
    },
  },
  server: {
    headers: {
      'Accept-CH':
        'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Mobile, Sec-CH-UA-Arch, Sec-CH-UA-Form-Factors',
      'Permissions-Policy':
        'ch-ua-model=*, ch-ua-platform=*, ch-ua-platform-version=*, ch-ua-arch=*, ch-ua-form-factors=*',
    },
    proxy: {
      // Forward /api/* to the Express backend during local development
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
});
