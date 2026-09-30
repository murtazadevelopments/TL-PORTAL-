/**
 * Collect browser Client Hints, public IP, and GPS for login logs.
 * MacBook Pro vs Air is never exposed; Android model often is.
 */

function onceGps(options) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
          resolve(null);
          return;
        }
        resolve({
          latitude: lat,
          longitude: lng,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        });
      },
      () => resolve(null),
      options
    );
  });
}

async function readGps() {
  const precise = await onceGps({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });
  if (precise) return precise;
  return onceGps({
    enableHighAccuracy: false,
    timeout: 6000,
    maximumAge: 60000,
  });
}

let gpsWarmup = null;

export function startLoginLocation() {
  if (!gpsWarmup) gpsWarmup = readGps();
  return gpsWarmup;
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

export async function collectDeviceHints() {
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

  const [ipMeta, gps] = await Promise.all([readPublicIp(), startLoginLocation()]);
  if (ipMeta.publicIp) hints.publicIp = ipMeta.publicIp;
  if (gps) {
    hints.latitude = gps.latitude;
    hints.longitude = gps.longitude;
    if (gps.accuracy != null) hints.accuracy = gps.accuracy;
  }

  return hints;
}
