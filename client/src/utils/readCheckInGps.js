function invalidCoords(lat, lng) {
  return !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);
}

function fromPosition(pos) {
  const latitude = pos?.coords?.latitude;
  const longitude = pos?.coords?.longitude;
  if (invalidCoords(latitude, longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
  };
}

function gpsFailMessage(err) {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'Location only works on HTTPS. Open the portal on https://texturedlab.org.';
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'This app cannot read GPS. Install the portal from Chrome or Safari, then allow location.';
  }
  const code = err?.code;
  if (code === 1) {
    return 'Location is required to check in. In the phone app: allow Location for Textured Lab Portal (not only the system GPS toggle), then try again.';
  }
  if (code === 3) {
    return 'GPS timed out. Keep the app open, stand near a window, and try again.';
  }
  return 'Could not read GPS. Allow location for this app and try again.';
}

function getPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = fromPosition(pos);
        if (!coords) {
          reject({ code: 2 });
          return;
        }
        resolve(coords);
      },
      reject,
      options
    );
  });
}

function watchPosition(waitMs, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastErr = null;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = fromPosition(pos);
        if (!coords || settled) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(timer);
        resolve(coords);
      },
      (err) => {
        lastErr = err;
      },
      options
    );
    const timer = window.setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
      if (!settled) reject(lastErr || { code: 3 });
    }, waitMs);
  });
}

/**
 * Mobile PWAs often fail a single high-accuracy getCurrentPosition (false
 * PERMISSION_DENIED / timeout) even when system GPS is on. Retry coarse,
 * then watch for a fix.
 */
export async function readCheckInGps() {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error(gpsFailMessage({ code: 0 }));
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error(gpsFailMessage({ code: 0 }));
  }

  const attempts = [
    { enableHighAccuracy: true, timeout: 25000, maximumAge: 30000 },
    { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  ];

  let lastErr = null;
  for (const options of attempts) {
    try {
      return await getPosition(options);
    } catch (err) {
      lastErr = err;
    }
  }

  try {
    return await watchPosition(28000, {
      enableHighAccuracy: true,
      timeout: 27000,
      maximumAge: 15000,
    });
  } catch (err) {
    lastErr = err;
  }

  throw new Error(gpsFailMessage(lastErr));
}
