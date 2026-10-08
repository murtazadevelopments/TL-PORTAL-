const EARTH_RADIUS_METERS = 6371000;

function dmsToDecimal(hemisphere, degrees, minutes, seconds) {
  let n = Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600;
  const h = String(hemisphere || '').toUpperCase();
  if (h === 'S' || h === 'W') n = -Math.abs(n);
  else if (h === 'N' || h === 'E') n = Math.abs(n);
  return n;
}

/**
 * Accept decimal, DMS, or a pasted GPS block that includes both lat and lng.
 * kind: 'lat' | 'lng'
 */
function parseCoordinate(value, kind) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  const latLabel = raw.match(/lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
  const lngLabel = raw.match(/long(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
  if (kind === 'lat' && latLabel) return Number(latLabel[1]);
  if (kind === 'lng' && lngLabel) return Number(lngLabel[1]);

  const dmsRe = /([NSWE])\s*(\d{1,3})\s*(?:°|deg)?\s*(\d{1,2})\s*(?:'|′)?\s*([\d.]+)/gi;
  const parts = [];
  let match;
  while ((match = dmsRe.exec(raw))) {
    parts.push({
      hem: match[1].toUpperCase(),
      value: dmsToDecimal(match[1], match[2], match[3], match[4]),
    });
  }
  if (kind === 'lat') {
    const hit = parts.find((p) => p.hem === 'N' || p.hem === 'S');
    if (hit) return hit.value;
  }
  if (kind === 'lng') {
    const hit = parts.find((p) => p.hem === 'E' || p.hem === 'W');
    if (hit) return hit.value;
  }

  const decimals = [...raw.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
  if (kind === 'lat' && Number.isFinite(decimals[0])) return decimals[0];
  if (kind === 'lng' && Number.isFinite(decimals[1])) return decimals[1];
  if (kind === 'lng' && decimals.length === 1 && Number.isFinite(decimals[0])) return decimals[0];
  return null;
}

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

/**
 * Great-circle distance in meters (Haversine).
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);
  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const a = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_METERS * c;
}

module.exports = { haversineDistanceMeters, parseCoordinate };
