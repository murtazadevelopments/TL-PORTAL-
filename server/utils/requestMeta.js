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

function ipMatchesOfficeEntries(ip, entries) {
  const got = stripIp(ip)?.toLowerCase();
  if (!got || !entries.length) return false;
  const exact = new Set(entries.filter((item) => !item.includes('/')));
  if (exact.has(got)) return true;
  return entries.filter((item) => item.includes('/')).some((cidr) => ipInCidr(got, cidr));
}

/**
 * Public internet IP of this device as seen by the office ISP / Hostinger.
 * Does not trust a client-supplied X-Forwarded-For chain (spoofable).
 */
function officeInternetIp(req) {
  const fromPinnedHeader = [
    req.headers['cf-connecting-ip'],
    req.headers['true-client-ip'],
    req.headers['x-real-ip'],
  ];
  for (const raw of fromPinnedHeader) {
    const ip = stripIp(ipsFromHeader(raw)[0]);
    if (ip && !isPrivateOrLocalIp(ip)) return ip;
  }

  const forwarded = ipsFromHeader(req.headers['x-forwarded-for']);
  for (let i = forwarded.length - 1; i >= 0; i -= 1) {
    if (!isPrivateOrLocalIp(forwarded[i])) return forwarded[i];
  }

  const expressIp = stripIp(req.ip);
  if (expressIp && !isPrivateOrLocalIp(expressIp)) return expressIp;

  const remote = stripIp(req.socket?.remoteAddress);
  if (remote && !isPrivateOrLocalIp(remote)) return remote;

  if (expressIp) return expressIp;
  return remote || null;
}

function requestMatchesConfiguredIp(req, configuredIp) {
  const client = officeInternetIp(req);
  if (!client) return false;
  const entries = parseOfficeIps(configuredIp).map((ip) => ip.toLowerCase());
  if (!entries.length) return false;

  const publicEntries = entries.filter((item) => item.includes('/') || !isPrivateOrLocalIp(item));
  const privateEntries = entries.filter((item) => !item.includes('/') && isPrivateOrLocalIp(item));

  if (ipMatchesOfficeEntries(client, publicEntries)) return true;
  if (isPrivateOrLocalIp(client) && ipMatchesOfficeEntries(client, privateEntries)) return true;
  return false;
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

function clipPlace(value, max = 120) {
  const s = String(value || '').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function toCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function geoResult({ city, area, country, latitude, longitude, local = false, label } = {}) {
  const computed = local
    ? 'This computer (local network)'
    : clipPlace(label, 180) || joinPlace([city, area, country]);
  return {
    label: computed || null,
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

function parseGpsHints(hints) {
  const lat = Number(hints?.latitude);
  const lng = Number(hints?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

function gpsRequiredPayload() {
  return {
    code: 'GPS_REQUIRED',
    message:
      'Location access is required to sign in. Allow GPS for this site and try again.',
  };
}

function englishPlace(value, max = 80) {
  const raw = clipPlace(value, max);
  if (!raw) return null;
  const arabic = (raw.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (raw.match(/[A-Za-z]/g) || []).length;
  if (arabic && arabic >= latin) return null;
  const cleaned = raw
    .replace(/[\u0600-\u06FF]+/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^,|,$/g, '')
    .trim();
  return cleaned || null;
}

async function reverseGeocode(latitude, longitude) {
  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&format=jsonv2&zoom=16&addressdetails=1&accept-language=en`,
    5000,
    { 'Accept-Language': 'en' }
  );
  if (!data || data.error) return geoResult({ latitude, longitude });
  const addr = data.address || {};
  const city = englishPlace(
    addr.city || addr.town || addr.village || addr.municipality
  );
  const area = englishPlace(
    addr.suburb || addr.neighbourhood || addr.city_district || addr.road
  );
  const country = englishPlace(addr.country);
  const label = joinPlace([area, city, country]);
  return geoResult({
    city,
    area,
    country,
    latitude,
    longitude,
    label,
    local: false,
  });
}

function hintedPublicIp(hints) {
  const ip = stripIp(hints?.publicIp);
  if (!ip || isPrivateOrLocalIp(ip) || !looksLikeRawIp(ip)) return null;
  return ip;
}

async function geoFromLoginHints(hints, fallbackIp) {
  const gps = parseGpsHints(hints);
  if (gps) {
    const place = await reverseGeocode(gps.latitude, gps.longitude);
    return {
      ...place,
      latitude: gps.latitude,
      longitude: gps.longitude,
      source: 'gps',
      label:
        place.label ||
        joinPlace([place.area, place.city, place.country]) ||
        `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`,
    };
  }
  const ipGeo = await lookupGeoFromIp(fallbackIp);
  return {
    ...ipGeo,
    latitude: null,
    longitude: null,
    source: 'ip',
  };
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
  geoFromLoginHints,
  hintedPublicIp,
  parseGpsHints,
  gpsRequiredPayload,
  isPrivateOrLocalIp,
  looksLikeRawIp,
  looksLikeOfficeNetworkEntry,
  normalizeOfficeNetworkEntry,
  stripIp,
};
