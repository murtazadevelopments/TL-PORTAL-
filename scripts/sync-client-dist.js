/**
 * Copy client/dist → server/public for unified Hostinger deploy
 * (Express serves API + SPA from one process).
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'client', 'dist');
const dest = path.join(__dirname, '..', 'server', 'public');

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

if (!fs.existsSync(src)) {
  console.error(`Missing ${src}. Run the client build first.`);
  process.exit(1);
}

rmrf(dest);
copyDir(src, dest);
console.log(`Synced ${src} → ${dest}`);
