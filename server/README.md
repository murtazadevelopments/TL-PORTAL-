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
   - `SUPABASE_URL` (must be a full URL, e.g. `https://xxxx.supabase.co`)
   - `SUPABASE_SECRET_KEY`
   - `PORT` (if the platform requires a specific port)
3. Restart / redeploy the Node app after saving env vars.
4. If logs show `injected env (0) from .env`, that only means no local `.env` file was loaded — **that is normal on Hostinger**. Your vars must come from the Hostinger env panel.
5. If the process crashes with `SUPABASE_URL=INVALID`, the value in Hostinger is set but not a valid URL. Common mistakes:
   - Missing `https://` (use `https://xxxx.supabase.co`, not only `xxxx.supabase.co`)
   - Extra quotes saved into the value (`"https://..."` — remove the quotes in the panel)
   - Pasted the wrong value (e.g. `DATABASE_URL` / a secret key into `SUPABASE_URL`)
   - Trailing spaces or a line break in the value

## Scripts

- `npm run dev` — nodemon
- `npm start` — `node index.js`
