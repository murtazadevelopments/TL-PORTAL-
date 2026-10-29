/**
 * Copy client/dist → server/public for unified Hostinger deploy
 * (Express serves API + SPA from one process).
 * Also writes build-info.json (commit / builtAt / clientBundle).
 */
const fs = require('fs');
const path = require('path');
const { getBuildMeta, writeBuildInfo } = require('./build-meta');

const src = path.join(__dirname, '..', 'client', 'dist');
const dest = path.join(__dirname, '..', 'server', 'public');
const serverMetaDir = path.join(__dirname, '..', 'server');

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function detectClientBundle(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  const html = fs.readFileSync(indexPath, 'utf8');
  const match = html.match(/\/assets\/(index-[^"'>\s]+\.js)/);
  return match ? match[1] : null;
}

if (!fs.existsSync(src)) {
  console.error(`Missing ${src}. Run the client build first.`);
  process.exit(1);
}

rmrf(dest);
copyDir(src, dest);

const meta = getBuildMeta();
const clientBundle = detectClientBundle(dest);
const info = writeBuildInfo(dest, meta, clientBundle);
writeBuildInfo(serverMetaDir, meta, clientBundle);

console.log(`Synced ${src} → ${dest}`);
console.log(
  `Build marker: commit=${info.commit} builtAt=${info.builtAt} bundle=${info.clientBundle || 'n/a'} sw=${info.swBuildId}`
);
