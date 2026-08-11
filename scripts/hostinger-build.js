/**
 * Hostinger build: install + build client, install server deps, sync SPA into server/public.
 * Uses child_process so each step is logged clearly in deploy logs.
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
  run('2/4 Build Vite client', 'npm run build --prefix client');
  run('3/4 Install server deps', 'npm install --prefix server');
  run('4/4 Sync client dist → server/public', 'node scripts/sync-client-dist.js');
  console.log('\n=== Build finished OK ===');
} catch (err) {
  console.error('\n=== Build FAILED ===');
  console.error(err.message);
  process.exit(1);
}
