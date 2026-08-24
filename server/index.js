const path = require('path');
// Always load server/.env relative to this file (cwd may differ on Hostinger)
// override: true so newly added keys (e.g. VAPID_*) win over stale process/injected env
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');

const app = express();
// Hostinger / proxies: so req.ip and x-forwarded-for are correct for login emails
app.set('trust proxy', 1);
app.use(compression());

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

const CLIENT_HINTS =
  'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Mobile, Sec-CH-UA-Arch, Sec-CH-UA-Form-Factors';
app.use((req, res, next) => {
  res.setHeader('Accept-CH', CLIENT_HINTS);
  res.setHeader('Critical-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Arch');
  res.setHeader(
    'Permissions-Policy',
    'ch-ua-model=*, ch-ua-platform=*, ch-ua-platform-version=*, ch-ua-arch=*, ch-ua-form-factors=*'
  );
  next();
});

// Vite build output is client/dist → copied to server/public by root `npm run build`.
// Optional when the frontend is deployed separately (FTP → public_html).
const publicDir = path.join(__dirname, 'public');
const spaIndex = path.join(publicDir, 'index.html');
const spaEnabled = fs.existsSync(spaIndex);
const apiOnlyMode =
  /^(1|true|yes)$/i.test(String(process.env.API_ONLY || '')) ||
  /^(0|false|no)$/i.test(String(process.env.SERVE_SPA || ''));

function healthPayload() {
  let uploadRootPath = null;
  let uploadRootExists = false;
  let uploadRootWritable = false;
  try {
    const { getUploadRoot } = require('./services/localStorage');
    uploadRootPath = getUploadRoot();
    uploadRootExists = fs.existsSync(uploadRootPath);
    if (uploadRootExists) {
      try {
        fs.accessSync(uploadRootPath, fs.constants.W_OK);
        uploadRootWritable = true;
      } catch {
        uploadRootWritable = false;
      }
    }
  } catch {
    /* storage module unavailable */
  }

  return {
    status: 'Server is running',
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasJwtSecret: Boolean(process.env.JWT_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
    hasResendFrom: Boolean(process.env.RESEND_FROM),
    hasUploadRoot: Boolean(process.env.UPLOAD_ROOT || process.env.UPLOADS_ROOT),
    uploadRootConfigured: Boolean(
      String(process.env.UPLOAD_ROOT || process.env.UPLOADS_ROOT || '').trim()
    ),
    // Safe diagnostics (absolute path is needed to verify Hostinger env)
    uploadRootPath,
    uploadRootExists,
    uploadRootWritable,
    spaEnabled,
    apiOnlyMode,
  };
}

/** Hostname only — never return user/password/query from DATABASE_URL. */
function databaseHostnameFromEnv() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  if (!raw) return null;
  try {
    // URL() needs a parseable scheme; postgres:// works
    const normalized = raw.replace(/^postgres(ql)?:/i, 'http:');
    const host = new URL(normalized).hostname;
    return host || null;
  } catch {
    const m = raw.match(/@([^/:?]+)/);
    return m ? m[1] : null;
  }
}

function isPoolerHost(hostname) {
  return /pooler\.supabase\.com$/i.test(String(hostname || ''));
}

function isDirectDbHost(hostname) {
  return /^db\.[a-z0-9-]+\.supabase\.co$/i.test(String(hostname || ''));
}

app.get('/api/health', (req, res) => {
  res.json(healthPayload());
});

/**
 * GET /api/health/db-check?secret=...
 * Safe DB probe: runs SELECT 1 and returns only the DATABASE_URL hostname.
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
      error:
        'HEALTH_CHECK_SECRET is not set. Add it in Hostinger env vars, then restart Node.',
    });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const hostname = databaseHostnameFromEnv();
  const started = Date.now();

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      ok: false,
      connected: false,
      hostname: null,
      connectionKind: 'missing',
      error: 'DATABASE_URL is not set',
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
    error = err.message || String(err);
    // Never echo connection string fragments that might include credentials
    if (/postgresql:\/\//i.test(error) || /postgres:\/\//i.test(error)) {
      error = err.code || 'database_connection_failed';
    }
  }

  const connectionKind = !hostname
    ? 'unknown'
    : isPoolerHost(hostname)
      ? 'pooler'
      : isDirectDbHost(hostname)
        ? 'direct_db_ipv6'
        : 'other';

  return res.status(connected ? 200 : 503).json({
    ok: connected,
    connected,
    hostname,
    connectionKind,
    looksLikePooler: isPoolerHost(hostname),
    looksLikeDirectDbHost: isDirectDbHost(hostname),
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
  app.use('/api/messages', require('./routes/messagesRoutes'));
  app.use('/api/push', require('./routes/pushRoutes'));
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
    /^sw-.+\.js$/.test(base);

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

if (spaEnabled && !apiOnlyMode) {
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
  // API-only: frontend is deployed separately (FTP → public_html) or SERVE_SPA=false
  app.get('/', (req, res) => {
    res.json({ ...healthPayload(), health: '/api/health', spa: false });
  });
  if (apiOnlyMode) {
    console.log(
      'API-only mode (API_ONLY/SERVE_SPA). Frontend is expected on a separate host (e.g. FTP public_html).'
    );
  } else if (!spaEnabled) {
    console.log(
      'SPA not bundled (no server/public/index.html). Safe to ignore if the frontend is deployed separately via FTP; for unified Node+SPA run root `npm run build`, or set API_ONLY=true to silence this.'
    );
  }
}

const PORT = Number(process.env.PORT) || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
  console.log('CORS origins:', allowedOrigins.join(', '));
  if (spaEnabled && !apiOnlyMode) {
    console.log(`SPA enabled from ${publicDir}`);
  } else {
    console.log('SPA not served by this process (API-only / separate frontend deploy)');
  }
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
