const path = require('path');
// Always load server/.env relative to this file (cwd may differ on Hostinger)
// override: true so newly added keys (e.g. VAPID_*) win over stale process/injected env
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const { sanitizePublicJson } = require('./utils/sanitizePublicJson');

const app = express();
// Hostinger sits in front of Node — first hop only, for req.ip and HTTPS.
app.set('trust proxy', 1);
app.use(compression());

// JWT is Authorization: Bearer (not cookies). CORS for local Vite and the public site.
const defaultOrigins = [
  'https://texturedlab.org',
  'https://www.texturedlab.org',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// Extra origins from env (local Vite is already in defaults). Same-origin production needs no CORS.
const originsFromEnv = parseOrigins(
  process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS
);
const allowedOrigins = [...new Set([...defaultOrigins, ...originsFromEnv])];

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (curl, health checks) send no Origin
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`CORS blocked origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Sales-Pin', 'X-Tl-View-Pin'],
    exposedHeaders: ['Content-Disposition', 'X-Export-Filename'],
  })
);
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(sanitizePublicJson(body));
  next();
});

const CLIENT_HINTS =
  'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Mobile, Sec-CH-UA-Arch, Sec-CH-UA-Form-Factors';
app.use((req, res, next) => {
  res.setHeader('Accept-CH', CLIENT_HINTS);
  res.setHeader('Critical-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Arch');
  res.setHeader(
    'Permissions-Policy',
    'ch-ua-model=*, ch-ua-platform=*, ch-ua-platform-version=*, ch-ua-arch=*, ch-ua-form-factors=*, geolocation=(self "https://texturedlab.org" "https://www.texturedlab.org")'
  );
  next();
});

// Built SPA: client/dist from root `npm run build`. Fallback: server/public (legacy copy).
const clientDistDir = path.join(__dirname, '..', 'client', 'dist');
const publicDir = path.join(__dirname, 'public');
const spaDir = fs.existsSync(path.join(clientDistDir, 'index.html'))
  ? clientDistDir
  : publicDir;
const spaIndex = path.join(spaDir, 'index.html');
const spaEnabled = fs.existsSync(spaIndex);

function readBuildInfo() {
  const candidates = [
    path.join(spaDir, 'build-info.json'),
    path.join(__dirname, 'build-info.json'),
    path.join(publicDir, 'build-info.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        commit: String(raw.commit || 'unknown'),
        builtAt: String(raw.builtAt || ''),
        clientBundle: raw.clientBundle ? String(raw.clientBundle) : null,
        swBuildId: raw.swBuildId ? String(raw.swBuildId) : null,
      };
    } catch {
      /* try next */
    }
  }
  return {
    commit: process.env.GIT_COMMIT || process.env.COMMIT_SHA || 'unknown',
    builtAt: '',
    clientBundle: null,
    swBuildId: null,
  };
}

function healthPayload() {
  return {
    status: 'ok',
  };
}

app.get('/api/health', (req, res) => {
  res.json(healthPayload());
});

/** Public deploy marker — no auth, no secrets. */
app.get('/api/version', (req, res) => {
  const info = readBuildInfo();
  res.json({
    commit: info.commit,
    builtAt: info.builtAt,
    clientBundle: info.clientBundle,
  });
});

/**
 * GET /api/health/db-check?secret=...
 * Safe DB probe: runs SELECT 1. Does not expose hostnames or env details.
 * Requires HEALTH_CHECK_SECRET (or DB_CHECK_SECRET) to match ?secret=
 */
app.get('/api/health/db-check', async (req, res) => {
  const expected = String(
    process.env.HEALTH_CHECK_SECRET || process.env.DB_CHECK_SECRET || ''
  ).trim();
  const provided = String(req.query.secret || '').trim();

  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'Health check is not available.',
    });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const started = Date.now();

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      ok: false,
      connected: false,
      error: 'Service unavailable.',
      ms: Date.now() - started,
    });
  }

  let connected = false;
  let error = null;
  try {
    // Lazy-require so a missing/broken db module does not crash boot of /api/health
    const pool = require('./config/db');
    await pool.query('SELECT 1 AS ok');
    connected = true;
  } catch (err) {
    connected = false;
    error = 'Service unavailable.';
  }

  return res.status(connected ? 200 : 503).json({
    ok: connected,
    connected,
    error,
    ms: Date.now() - started,
  });
});

let apiBootError = null;
try {
  app.use('/api/auth', require('./routes/authRoutes'));
  app.use('/api/users', require('./routes/userRoutes'));
  app.use('/api/admin', require('./routes/adminRoutes'));
  app.use('/api/attendance', require('./routes/attendanceRoutes'));
  app.use('/api/roles', require('./routes/rolesRoutes'));
  app.use('/api/documents', require('./routes/documentsRoutes'));
  app.use('/api/tl-dashboard', require('./routes/tlDashboardRoutes'));
  app.use('/api/sales-targets', require('./routes/salesTargetsRoutes'));
  app.use('/api/messages', require('./routes/messagesRoutes'));
  app.use('/api/push', require('./routes/pushRoutes'));
} catch (err) {
  apiBootError = err;
  console.error('API failed to load (check Hostinger env vars):', err.message);
  app.use('/api', (req, res) => {
    res.status(503).json({
      message: 'Check your internet connection.',
    });
  });
}

if (!apiBootError) {
  app.use('/api', (req, res) => {
    res.status(404).json({ message: 'Not found.' });
  });
}

// Vite build may already be defined above for healthPayload — reuse those consts.
/** Never let CDNs cache the service worker / app shell for a week (stuck mobile PWAs). */
function setSpaCacheHeaders(res, filePath) {
  const base = path.basename(filePath);
  const isAppShell =
    base === 'index.html' ||
    base === 'sw.js' ||
    base === 'tl-sw.js' ||
    base === 'registerSW.js' ||
    base === 'manifest.json' ||
    base.endsWith('.webmanifest') ||
    /^sw-.+\.js$/.test(base) ||
    /^tl-sw-/.test(base);

  if (isAppShell || res.req?.get?.('Service-Worker') === 'script') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    return;
  }

  if (
    filePath.includes(`${path.sep}assets${path.sep}`) ||
    /\.(?:woff2|webp)$/i.test(base)
  ) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

if (spaEnabled) {
  // One-visit PWA reset page (also reachable if SW is stuck on an old shell).
  app.get('/pwa-reset', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Clear-Site-Data', '"cache", "storage"');
    res.type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Refreshing Textured Lab Portal…</title>
<style>
  body{font-family:system-ui,sans-serif;background:#05060b;color:#e8eaef;display:grid;place-items:center;min-height:100vh;margin:0}
  p{opacity:.8;max-width:28rem;text-align:center;line-height:1.5}
</style>
</head><body>
<p>Clearing old app cache… You will be redirected automatically.</p>
<script>
(async function () {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {}
  location.replace('/?pwa=fresh');
})();
</script>
</body></html>`);
  });

  app.use(
    express.static(spaDir, {
      index: false,
      setHeaders: setSpaCacheHeaders,
    })
  );

  // Express 5: named splat. /api already returned JSON 404 above.
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (req.path === '/pwa-reset') return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    return res.sendFile(spaIndex);
  });
} else {
  app.get('/', (req, res) => {
    res.json({ ...healthPayload(), health: '/api/health', spa: false });
  });
  console.log(
    'SPA missing (no client/dist/index.html). Run repo-root `npm run build` so Node can serve the UI.'
  );
}

const PORT = Number(process.env.PORT) || 5001;

function startHttpServer() {
  if (global.__tlPortalListening) {
    console.warn('[boot] HTTP server already started in this process — skip duplicate listen');
    return;
  }
  global.__tlPortalListening = true;

  app.listen(PORT, '0.0.0.0', () => {
    const buildInfo = readBuildInfo();
    console.log(
      `Server running on 0.0.0.0:${PORT} (commit ${buildInfo.commit}${
        buildInfo.builtAt ? `, built ${buildInfo.builtAt}` : ''
      })`
    );
    console.log('CORS origins:', allowedOrigins.join(', '));
    try {
      require('./lib/mailer').logMailerStatus();
    } catch (err) {
      console.error('[mailer] status check failed:', err.message || err);
    }
    try {
      const {
        configureVapid,
        isPushConfigured,
        getPushConfigError,
      } = require('./services/pushNotifications');
      configureVapid();
      if (isPushConfigured()) {
        console.log('[push] Web Push configured (VAPID ready)');
      } else {
        const why = getPushConfigError() || 'missing_or_invalid_vapid';
        console.log(
          `[push] Web Push OFF (${why}). Set full VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in Hostinger env (no quotes).`
        );
      }
    } catch (err) {
      console.error('[push] status check failed:', err.message || err);
    }
    if (spaEnabled) {
      console.log(`SPA enabled from ${spaDir}`);
    } else {
      console.log('SPA not served (client/dist missing)');
    }
    if (apiBootError) {
      console.error('API routes unavailable until env is fixed:', apiBootError.message);
    }

    try {
      require('./utils/accountStatus')
        .ensureBlockedColumn()
        .catch((err) => {
          console.error('[account-status] schema ensure failed:', err.message || err);
        });
    } catch (err) {
      console.error('[account-status] schema ensure failed:', err.message || err);
    }

    try {
      const { startScheduledJobsIfLeader } = require('./jobs');
      startScheduledJobsIfLeader();
    } catch (err) {
      console.error('Failed to start scheduled jobs:', err.message || err);
    }
  });
}

startHttpServer();
module.exports = { app, startHttpServer };
