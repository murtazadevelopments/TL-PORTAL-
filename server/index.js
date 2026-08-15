const path = require('path');
// Always load server/.env relative to this file (cwd may differ on Hostinger)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
// Hostinger / proxies: so req.ip and x-forwarded-for are correct for login emails
app.set('trust proxy', 1);

// JWT is sent as Authorization: Bearer; credentials enabled for cookie-ready CORS.
const defaultOrigins = [
  'https://texturedlab.org',
  'https://www.texturedlab.org',
  'https://portal.texturedlab.com',
  'https://www.portal.texturedlab.com',
  'https://seagreen-weasel-875788.hostingersite.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// Merge env + defaults so Hostinger ALLOWED_ORIGINS cannot drop known frontends
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
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '2mb' }));

function healthPayload() {
  return {
    status: 'Server is running',
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasJwtSecret: Boolean(process.env.JWT_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
    hasResendFrom: Boolean(process.env.RESEND_FROM),
  };
}

app.get('/api/health', (req, res) => {
  res.json(healthPayload());
});

let apiBootError = null;
try {
  app.use('/api/auth', require('./routes/authRoutes'));
  app.use('/api/users', require('./routes/userRoutes'));
  app.use('/api/admin', require('./routes/adminRoutes'));
  app.use('/api/roles', require('./routes/rolesRoutes'));
} catch (err) {
  apiBootError = err;
  console.error('API failed to load (check Hostinger env vars):', err.message);
  app.use('/api', (req, res) => {
    res.status(503).json({
      message:
        apiBootError?.message ||
        'API is not configured. Set DATABASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY in Hostinger.',
    });
  });
}

// Vite build output is client/dist → copied to server/public by root `npm run build`
const publicDir = path.join(__dirname, 'public');
const spaIndex = path.join(publicDir, 'index.html');
const spaEnabled = fs.existsSync(spaIndex);

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
    /^sw-.+\.js$/.test(base);

  if (isAppShell || res.req?.get?.('Service-Worker') === 'script') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    return;
  }

  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
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
    express.static(publicDir, {
      index: false,
      setHeaders: setSpaCacheHeaders,
    })
  );

  // Express 5: bare "*" is invalid — use a named splat. Registered LAST so /api/* stays intact.
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (req.path === '/pwa-reset') return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    return res.sendFile(spaIndex);
  });
} else {
  // API-only mode (local without sync, or Hostinger build skipped the client step)
  app.get('/', (req, res) => {
    res.json({ ...healthPayload(), health: '/api/health', spa: false });
  });
  console.warn(
    'SPA disabled: missing server/public/index.html. Run root `npm run build` so client/dist is synced to server/public.'
  );
}

const PORT = Number(process.env.PORT) || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
  console.log('CORS origins:', allowedOrigins.join(', '));
  console.log(spaEnabled ? `SPA enabled from ${publicDir}` : 'SPA not enabled');
  if (apiBootError) {
    console.error('API routes unavailable until env is fixed:', apiBootError.message);
  }

  try {
    const { startScheduledJobs } = require('./jobs');
    startScheduledJobs();
  } catch (err) {
    console.error('Failed to start scheduled jobs:', err.message || err);
  }
});
