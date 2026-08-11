const path = require('path');
// Always load server/.env relative to this file (cwd may differ on Hostinger)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();

const defaultOrigins = [
  'https://portal.texturedlab.com',
  'https://www.portal.texturedlab.com',
  'https://mediumpurple-chicken-145151.hostingersite.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const origins = allowedOrigins.length ? allowedOrigins : defaultOrigins;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`CORS blocked origin: ${origin}`);
      return callback(null, false);
    },
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running',
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasJwtSecret: Boolean(process.env.JWT_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseKey: Boolean(process.env.SUPABASE_SECRET_KEY),
  });
});

let apiBootError = null;
try {
  app.use('/api/auth', require('./routes/authRoutes'));
  app.use('/api/users', require('./routes/userRoutes'));
  app.use('/api/admin', require('./routes/adminRoutes'));
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

// Serve Vite build from server/public (created by root `npm run build`)
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false }));

  // Express 5-safe SPA fallback (avoid RegExp routes — they can crash boot)
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(publicDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
  if (apiBootError) {
    console.error('API routes unavailable until env is fixed:', apiBootError.message);
  }
});
