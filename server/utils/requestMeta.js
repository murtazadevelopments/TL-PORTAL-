/**
 * Client IP, User-Agent, and approximate geo for login logs / emails.
 */

const ipaddr = require('ipaddr.js');

const PRIVATE_V4 =
  /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0)$/;

function stripIp(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  // "[IPv6]:port" or "IPv4:port"
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end > 0) s = s.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) {
    s = s.replace(/:\d+$/, '');
  }
  if (s.toLowerCase().startsWith('::ffff:')) s = s.slice(7);
  return s || null;
}

function isPrivateOrLocalIp(ip) {
  const s = stripIp(ip);
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower === '::1' || lower === 'localhost' || lower === '::') return true;
  if (PRIVATE_V4.test(s)) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) return true;
  return false;
}

function ipsFromHeader(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map(stripIp)
    .filter(Boolean);
}

/**
 * Real client IP behind Hostinger / nginx / Vite, skipping private hop addresses.
 */
function collectRequestIps(req) {
  const headerCandidates = [
    req.headers['cf-connecting-ip'],
    req.headers['true-client-ip'],
    req.headers['x-real-ip'],
    req.headers['x-client-ip'],
    req.headers['fastly-client-ip'],
    req.headers['x-forwarded-for'],
    req.headers['forwarded'],
  ];

  const collected = [];
  for (const raw of headerCandidates) {
    if (!raw) continue;
    if (String(raw).toLowerCase().includes('for=')) {
      // RFC 7239 Forwarded: for=1.2.3.4;proto=https
      for (const part of String(raw).split(',')) {
        const m = part.match(/for=\s*"?([^;,"]+)"?/i);
        if (m) collected.push(stripIp(m[1]));
      }
    } else {
      collected.push(...ipsFromHeader(raw));
    }
  }

  collected.push(stripIp(req.ip), stripIp(req.socket?.remoteAddress));
  return [...new Set(collected.filter(Boolean))];
}

function clientIp(req) {
  const ips = collectRequestIps(req);
  const publicIp = ips.find((ip) => !isPrivateOrLocalIp(ip));
  return publicIp || ips[0] || null;
}

function parseOfficeIps(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;]+/);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const ip = normalizeOfficeNetworkEntry(part);
    if (!ip) continue;
    const key = ip.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ip);
  }
  return out;
}

function formatOfficeIps(ips) {
  const list = parseOfficeIps(ips);
  return list.length ? list.join(', ') : null;
}

function ipInCidr(ip, cidr) {
  try {
    const addr = ipaddr.process(ip);
    const range = ipaddr.parseCIDR(cidr);
    if (addr.kind() !== range[0].kind()) return false;
    return addr.match(range);
  } catch {
    return false;
  }
}

function requestMatchesConfiguredIp(req, configuredIp) {
  const entries = parseOfficeIps(configuredIp).map((ip) => ip.toLowerCase());
  if (!entries.length) return false;
  const exact = new Set(entries.filter((ip) => !ip.includes('/')));
  const cidrs = entries.filter((ip) => ip.includes('/'));
  // DEBUG - remove after
  console.log('[onsite-ip-debug]', {
    reqIp: req.ip,
    remoteAddress: req.socket?.remoteAddress,
    xForwardedFor: req.headers['x-forwarded-for'],
    xRealIp: req.headers['x-real-ip'],
    cfConnectingIp: req.headers['cf-connecting-ip'],
    forwarded: req.headers['forwarded'],
    collected: collectRequestIps(req),
    whitelist: entries,
  });
  return collectRequestIps(req).some((ip) => {
    const got = stripIp(ip)?.toLowerCase();
    if (!got) return false;
    if (exact.has(got)) return true;
    return cidrs.some((cidr) => ipInCidr(got, cidr));
  });
}

function clientUserAgent(req) {
  const ua = req.headers['user-agent'];
  return ua ? String(ua).slice(0, 512) : null;
}

function parseUserAgent(ua, hints) {
  const { describeDevice } = require('./deviceLabel');
  return describeDevice(ua, hints);
}

function looksLikeRawIp(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true;
  if (/^[0-9a-f:]+$/i.test(s) && s.includes(':')) return true;
  return false;
}

function normalizeCidrToken(value) {
  let s = String(value || '').trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  const bracketed = s.match(/^\[([^\]]+)\]\/(\d+)$/);
  if (bracketed) s = `${bracketed[1]}/${bracketed[2]}`;
  return s.toLowerCase();
}

function looksLikeOfficeNetworkEntry(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.includes('/')) {
    try {
      ipaddr.parseCIDR(normalizeCidrToken(s));
      return true;
    } catch {
      return false;
    }
  }
  const ip = stripIp(s);
  return Boolean(ip && looksLikeRawIp(ip));
}

function normalizeOfficeNetworkEntry(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (s.includes('/')) {
    const cidr = normalizeCidrToken(s);
    try {
      ipaddr.parseCIDR(cidr);
      return cidr;
    } catch {
      return null;
    }
  }
  const ip = stripIp(s);
  return ip && looksLikeRawIp(ip) ? ip : null;
}

async function fetchJson(url, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TexturedLabPortal/1.0 (login-geo)',
        ...extraHeaders,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function joinPlace(parts) {
  const cleaned = parts.map((p) => String(p || '').trim()).filter(Boolean);
  const unique = [];
  for (const p of cleaned) {
    if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) unique.push(p);
  }
  return unique.length ? unique.join(', ') : null;
}

function toCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function geoResult({ city, area, country, latitude, longitude, local = false } = {}) {
  const label = local
    ? 'This computer (local network)'
    : joinPlace([city, area, country]);
  return {
    label: label || null,
    city: city || null,
    area: area || null,
    country: country || null,
    latitude: toCoord(latitude),
    longitude: toCoord(longitude),
  };
}

/**
 * Structured geo from IP: city, area (state/district), country, lat/lng.
 * Never throws. IP-based location is approximate (ISP city, not GPS).
 */
const geoCache = new Map();

async function lookupGeoFromIp(ip) {
  const clean = stripIp(ip);
  if (!clean) return geoResult();
  if (isPrivateOrLocalIp(clean)) return geoResult({ local: true, area: 'Local network' });
  if (geoCache.has(clean)) return geoCache.get(clean);

  const providers = [
    async () => {
      const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(clean)}`, 5000);
      if (!data || data.success === false) return null;
      return geoResult({
        city: data.city,
        area: data.region || data.postal,
        country: data.country,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    },
    async () => {
      const data = await fetchJson(
        `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,country,regionName,city,district,lat,lon,message`,
        5000
      );
      if (!data || data.status !== 'success') return null;
      return geoResult({
        city: data.city,
        area: data.district || data.regionName,
        country: data.country,
        latitude: data.lat,
        longitude: data.lon,
      });
    },
    async () => {
      const data = await fetchJson(`https://ipapi.co/${encodeURIComponent(clean)}/json/`, 5000);
      if (!data || data.error) return null;
      return geoResult({
        city: data.city,
        area: data.region || data.postal,
        country: data.country_name,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    },
  ];

  for (const lookup of providers) {
    try {
      const geo = await lookup();
      if (geo && (geo.city || geo.country || geo.latitude != null)) {
        geoCache.set(clean, geo);
        return geo;
      }
    } catch {
      /* next provider */
    }
  }

  const empty = geoResult();
  geoCache.set(clean, empty);
  return empty;
}

async function approxLocationFromIp(ip) {
  const geo = await lookupGeoFromIp(ip);
  return geo.label;
}

module.exports = {
  clientIp,
  collectRequestIps,
  parseOfficeIps,
  formatOfficeIps,
  requestMatchesConfiguredIp,
  clientUserAgent,
  parseUserAgent,
  approxLocationFromIp,
  lookupGeoFromIp,
  isPrivateOrLocalIp,
  looksLikeRawIp,
  looksLikeOfficeNetworkEntry,
  normalizeOfficeNetworkEntry,
  stripIp,
};
