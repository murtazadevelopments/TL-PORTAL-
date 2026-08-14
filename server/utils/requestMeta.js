/**
 * Best-effort client hints for login notification emails.
 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function clientUserAgent(req) {
  return req.headers['user-agent'] || null;
}

/**
 * Approximate location from IP (best-effort, 2s timeout). Never throws.
 */
async function approxLocationFromIp(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.')) {
    return 'Local / development';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return ip;
    const data = await res.json();
    if (data.error) return ip;
    const parts = [data.city, data.region, data.country_name].filter(Boolean);
    return parts.length ? `${parts.join(', ')} (${ip})` : ip;
  } catch {
    return ip;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  clientIp,
  clientUserAgent,
  approxLocationFromIp,
};
