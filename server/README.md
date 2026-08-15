# Textured Lab Portal — Server

Node/Express API for the Textured Lab employee portal. Uses PostgreSQL (`pg`) for data and Supabase Storage for document uploads.

In production, this process also serves the Vite client from `server/public` (copied during root `npm run build`).

## Required environment variables

Set these in **Hostinger’s environment variable panel** (or a local `server/.env` for development).  
`.env` is gitignored and must **not** be relied on for production deploys.

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No (default `5001`) | HTTP listen port |
| `DATABASE_URL` | **Yes** | Supabase Postgres connection string (pooler URL is fine) |
| `JWT_SECRET` | **Yes** | Secret used to sign/verify auth JWTs |
| `SUPABASE_URL` | **Yes** | Project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SECRET_KEY` | **Yes** | Server secret key (`sb_secret_...`) for Storage uploads & signed URLs |
| `ALLOWED_ORIGINS` | No | Comma-separated frontend origins (defaults include portal + Hostinger URL + localhost) |
| `RESEND_API_KEY` | **Yes** (for email) | Resend API key — required on Hostinger or all emails fail |
| `RESEND_FROM` | **Yes** (for email) | Must use verified domain, e.g. `Textured Lab Portal <noreply@texturedlab.org>` |
| `FRONTEND_URL` | Yes (for password reset links) | Production frontend origin, e.g. `https://texturedlab.org` |
| `ADMIN_NOTIFY_EMAILS` | No | Extra admin emails for notifications (comma-separated) |

## Local setup

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

## Hostinger deployment (unified API + UI)

The Hostinger URL was previously serving **only the React static build**. `/api/*` returned **503** because Express was not the process handling the site.

Deploy the **repo root** as a **Node.js** app (not a static-only site):

1. Repository root = project root (contains `package.json`, `client/`, `server/`).
2. Build command: `npm run build`
3. Start command: `npm start` (runs `node server/index.js`)
4. Set env vars: `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
5. After deploy, open `https://YOUR-HOST/api/health` — must return JSON `{ "status": "Server is running", ... }`. If you still see HTML 503, Node is not running.

Client calls use same-origin `/api/...` (empty `VITE_API_URL`), so the SPA and API share one Hostinger URL with no CORS pain.

## Scripts

- From repo root: `npm run build`, `npm start`
- From `server/`: `npm run dev`, `npm start`
