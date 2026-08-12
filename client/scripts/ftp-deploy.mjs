/**
 * Local FTP deploy for Vite dist/ → Hostinger.
 *
 * Required env (put in client/.env.ftp.local — gitignored, or export in shell):
 *   FTP_HOST, FTP_USER, FTP_PASSWORD
 * Optional:
 *   FTP_REMOTE_DIR  (default: /public_html/)
 *   FTP_PORT        (default: 21)
 *   FTP_SECURE      (true/false — FTPS; default false)
 *
 * Usage (from client/):
 *   npm run build && npm run deploy:ftp
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'basic-ftp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(path.join(clientRoot, '.env.ftp.local'));

const host = process.env.FTP_HOST || process.env.FTP_SERVER;
const user = process.env.FTP_USER || process.env.FTP_USERNAME;
const password = process.env.FTP_PASSWORD;
const remoteDir = process.env.FTP_REMOTE_DIR || process.env.FTP_SERVER_DIR || '/public_html/';
const port = Number(process.env.FTP_PORT || 21);
const secure = String(process.env.FTP_SECURE || 'false').toLowerCase() === 'true';
const localDir = path.join(clientRoot, 'dist');

if (!host || !user || !password) {
  console.error(
    'Missing FTP credentials. Set FTP_HOST, FTP_USER, FTP_PASSWORD (e.g. in client/.env.ftp.local).'
  );
  process.exit(1);
}

if (!existsSync(localDir)) {
  console.error(`Missing ${localDir}. Run "npm run build" first.`);
  process.exit(1);
}

const client = new Client(60_000);
client.ftp.verbose = true;

try {
  console.log(`Connecting to ${host}:${port}…`);
  await client.access({ host, user, password, port, secure });
  console.log(`Uploading ${localDir} → ${remoteDir}`);
  await client.ensureDir(remoteDir);
  await client.uploadFromDir(localDir);
  console.log('FTP deploy finished.');
} catch (err) {
  console.error('FTP deploy failed:', err.message || err);
  process.exitCode = 1;
} finally {
  client.close();
}
