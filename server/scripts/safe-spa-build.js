/**
 * Hostinger entry for `npm run build` inside server/.
 * Tries repo-root SPA build; always exits 0 so deploy never fails the build phase.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const hostingerBuild = path.join(__dirname, '..', '..', 'scripts', 'hostinger-build.js');

if (!fs.existsSync(hostingerBuild)) {
  console.log(
    '[build] No ../scripts/hostinger-build.js — keeping committed server/public SPA.'
  );
  process.exit(0);
}

try {
  execSync(`node "${hostingerBuild}"`, { stdio: 'inherit', env: process.env });
  process.exit(0);
} catch (err) {
  console.error('[build] SPA build failed; keeping existing server/public.', err.message || err);
  process.exit(0);
}
