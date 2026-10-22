/**
 * Hostinger build: install + build the Vite client, then install server deps.
 * Express serves client/dist and /api from one origin (texturedlab.org).
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(label, cmd) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

try {
  run('1/4 Install client deps', 'npm install --prefix client');
  run('2/4 Build Vite client → client/dist', 'npm run build --prefix client');
  run('3/4 Copy SPA into server/public', 'node scripts/sync-client-dist.js');
  run('4/4 Install server deps', 'npm install --prefix server');
  console.log('\n=== Build finished OK (SPA at client/dist and server/public) ===');
} catch (err) {
  console.error('\n=== Build FAILED ===');
  console.error(err.message);
  process.exit(1);
}
