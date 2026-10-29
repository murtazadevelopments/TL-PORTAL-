/**
 * Resolve git short SHA + ISO build time for Vite define and build-info.json.
 * Safe when .git is missing (Hostinger / shallow copies).
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');

function readGitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function resolveCommit() {
  const fromEnv =
    process.env.VITE_APP_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    '';
  const trimmed = String(fromEnv).trim();
  if (trimmed) return trimmed.slice(0, 12);
  return readGitShortSha() || 'unknown';
}

function resolveBuiltAt() {
  const fromEnv = process.env.VITE_APP_BUILT_AT || process.env.BUILD_TIME || '';
  if (String(fromEnv).trim()) return String(fromEnv).trim();
  return new Date().toISOString();
}

function resolveSwBuildId(commit, builtAt) {
  const fromEnv = process.env.SW_BUILD_ID || process.env.VITE_SW_BUILD_ID || '';
  if (String(fromEnv).trim()) return String(fromEnv).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const stamp = String(builtAt).replace(/[-:TZ.]/g, '').slice(0, 14);
  const short = String(commit || 'local').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `${short || 'local'}-${stamp || Date.now()}`;
}

function getBuildMeta() {
  const commit = resolveCommit();
  const builtAt = resolveBuiltAt();
  const swBuildId = resolveSwBuildId(commit, builtAt);
  return { commit, builtAt, swBuildId };
}

function writeBuildInfo(destDir, meta, clientBundle) {
  const payload = {
    commit: meta.commit,
    builtAt: meta.builtAt,
    swBuildId: meta.swBuildId,
    clientBundle: clientBundle || null,
  };
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'build-info.json'), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

module.exports = { getBuildMeta, writeBuildInfo, root };
