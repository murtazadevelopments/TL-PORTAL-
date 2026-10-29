/**
 * Hostinger / root build: install + build the Vite client into server/public,
 * then install server deps.
 *
 * No-op safety: if the client tree is missing or the Vite build fails, exit 0
 * so Hostinger still deploys with the last committed server/public SPA.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const clientPkg = path.join(root, 'client', 'package.json');

function run(label, cmd) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

if (!fs.existsSync(clientPkg)) {
  console.log(
    '\n=== SPA build skipped (no client/) — serving committed server/public ==='
  );
  process.exit(0);
}

try {
  run('1/4 Install client deps', 'npm install --prefix client');
  run('2/4 Build Vite client → client/dist', 'npm run build --prefix client');
  run('3/4 Copy SPA into server/public', 'node scripts/sync-client-dist.js');
  run('4/4 Install server deps', 'npm install --prefix server');
  console.log('\n=== Build finished OK (SPA at client/dist and server/public) ===');
  process.exit(0);
} catch (err) {
  console.error('\n=== SPA build FAILED — deploy continues with existing server/public ===');
  console.error(err.message || err);
  process.exit(0);
}
