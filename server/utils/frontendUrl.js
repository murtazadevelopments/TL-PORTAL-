const PUBLIC_FRONTEND_URL = 'https://texturedlab.org';

/**
 * Base URL for links in emails (password reset, account approval, etc.).
 * Never emit localhost unless ALLOW_LOCAL_RESET_LINKS=1.
 */
function frontendBaseUrl() {
  let base = String(process.env.FRONTEND_URL || PUBLIC_FRONTEND_URL)
    .trim()
    .replace(/\/$/, '');
  if (base && !/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  const allowLocal = process.env.ALLOW_LOCAL_RESET_LINKS === '1';
  if (!allowLocal && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) {
    console.warn(
      `[email-links] FRONTEND_URL=${base} is local; using ${PUBLIC_FRONTEND_URL} for email links`
    );
    base = PUBLIC_FRONTEND_URL;
  }
  return base || PUBLIC_FRONTEND_URL;
}

module.exports = { frontendBaseUrl, PUBLIC_FRONTEND_URL };
