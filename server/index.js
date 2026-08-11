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
      // Never throw — throwing breaks OPTIONS preflight with a 500
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

// Mount API routes; if env/config is broken, keep process alive and return JSON 503
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

// Serve Vite build (copied to server/public during `npm run build`)
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false }));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (apiBootError) {
    console.error('API routes unavailable until env is fixed:', apiBootError.message);
  }
});
