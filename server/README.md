# Portal TL — Server

Node/Express API for the Textured Lab employee portal. Uses PostgreSQL (`pg`) for data and Supabase Storage for document uploads.

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

### Optional / unused by current runtime code

These may appear in a local `.env` from earlier setup, but are **not** read by the running Express app today:

| Variable | Notes |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | Publishable/anon-style key — not used by `supabaseClient.js` |
| `SUPABASE_JWKS_URL` | JWKS URL — not used by current JWT middleware (`JWT_SECRET` is used instead) |

## Local setup

```bash
cd server
cp .env.example .env   # if you maintain an example file; otherwise create .env manually
npm install
npm run dev
```

## Hostinger deployment checklist

1. Do **not** expect `.env` from git — it is ignored.
2. In the Hostinger dashboard, add at least:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `SUPABASE_URL` (must start with `https://`)
   - `SUPABASE_SECRET_KEY`
   - `PORT` (if the platform requires a specific port)
3. Restart the Node app after saving env vars.
4. If the process crashes with `Missing or invalid Supabase config`, the log will say which of `SUPABASE_URL` / `SUPABASE_SECRET_KEY` is missing or malformed.

## Scripts

- `npm run dev` — nodemon
- `npm start` — `node index.js`
