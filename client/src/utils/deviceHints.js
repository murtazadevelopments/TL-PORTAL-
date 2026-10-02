/**
 * Collect browser Client Hints, public IP, and GPS for login logs.
 * MacBook Pro vs Air is never exposed; Android model often is.
 */

export const GPS_REQUIRED_MESSAGE =
  'Location is required to use the portal. Allow GPS for this site, then try again.';

function gpsErrorMessage(err) {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'Location only works on HTTPS. Open the portal on https://texturedlab.org.';
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'This browser cannot share location. Use Chrome or Safari with Location Services on.';
  }
  const code = err?.code;
  if (code === 1) return GPS_REQUIRED_MESSAGE;
  if (code === 2) {
    return 'Could not read your GPS position. Turn on Location Services and try again.';
  }
  if (code === 3) return 'Location request timed out. Turn on GPS and try again.';
  return GPS_REQUIRED_MESSAGE;
}

function onceGps(options) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ gps: null, error: { code: 0 } });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
          resolve({ gps: null, error: { code: 2 } });
          return;
        }
        resolve({
          gps: {
            latitude: lat,
            longitude: lng,
            accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          },
          error: null,
        });
      },
      (error) => resolve({ gps: null, error }),
      options
    );
  });
}

async function readGps() {
  const precise = await onceGps({
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0,
  });
  if (precise.gps) return precise;
  const coarse = await onceGps({
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 15000,
  });
  if (coarse.gps) return coarse;
  return precise.error ? precise : coarse;
}

let gpsWarmup = null;

export function resetLoginLocation() {
  gpsWarmup = null;
}

export function startLoginLocation() {
  if (!gpsWarmup) {
    gpsWarmup = readGps().then((result) => {
      if (!result.gps) gpsWarmup = null;
      return result.gps;
    });
  }
  return gpsWarmup;
}

export async function requireLoginGps() {
  resetLoginLocation();
  const result = await readGps();
  if (result.gps) {
    gpsWarmup = Promise.resolve(result.gps);
    return result.gps;
  }
  const err = new Error(gpsErrorMessage(result.error));
  err.code = 'GPS_REQUIRED';
  throw err;
}

export async function ensurePortalGps() {
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      if (status.state === 'denied') {
        const err = new Error(GPS_REQUIRED_MESSAGE);
        err.code = 'GPS_REQUIRED';
        throw err;
      }
      if (status.state === 'granted') return true;
    } catch (err) {
      if (err?.code === 'GPS_REQUIRED') throw err;
    }
  }
  await requireLoginGps();
  return true;
}

async function readPublicIp() {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2500);
    const res = await fetch('https://ipwho.is/', { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return {};
    const data = await res.json();
    if (!data || data.success === false || !data.ip) return {};
    return { publicIp: String(data.ip).slice(0, 64) };
  } catch {
    return {};
  }
}

export async function collectDeviceHints({ requireGps = false } = {}) {
  const hints = {
    mobile: Boolean(navigator.userAgentData?.mobile),
    platform: navigator.userAgentData?.platform || navigator.platform || '',
  };

  try {
    const uaData = navigator.userAgentData;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      const high = await uaData.getHighEntropyValues([
        'model',
        'platform',
        'platformVersion',
        'architecture',
        'bitness',
        'formFactor',
      ]);
      hints.model = high.model || '';
      hints.platform = high.platform || hints.platform;
      hints.platformVersion = high.platformVersion || '';
      hints.architecture = high.architecture || '';
      hints.formFactor = Array.isArray(high.formFactor)
        ? high.formFactor[0]
        : high.formFactor || '';
      hints.mobile = Boolean(high.mobile ?? uaData.mobile);
    }
  } catch {
    /* private mode / unsupported */
  }

  const gpsPromise = requireGps ? requireLoginGps() : startLoginLocation();
  const [ipMeta, gps] = await Promise.all([readPublicIp(), gpsPromise]);
  if (ipMeta.publicIp) hints.publicIp = ipMeta.publicIp;
  if (gps) {
    hints.latitude = gps.latitude;
    hints.longitude = gps.longitude;
    if (gps.accuracy != null) hints.accuracy = gps.accuracy;
  }
  if (requireGps && (hints.latitude == null || hints.longitude == null)) {
    const err = new Error(GPS_REQUIRED_MESSAGE);
    err.code = 'GPS_REQUIRED';
    throw err;
  }

  return hints;
}
