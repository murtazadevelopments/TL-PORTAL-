import { useCallback, useEffect, useState } from 'react';
import { ensurePortalGps } from '../utils/deviceHints';
import GpsLocationModal from './GpsLocationModal';

export default function GlobalGpsGate({ children }) {
  const [gpsReady, setGpsReady] = useState(false);
  const [checking, setChecking] = useState(true);

  const verifyGps = useCallback(async () => {
    try {
      await ensurePortalGps();
      setGpsReady(true);
      setChecking(false);
    } catch {
      setGpsReady(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Check and trigger native browser prompt on mount
    verifyGps();

    // Listen for browser permission changes (e.g., if user allows/blocks in browser menu)
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      let sub;
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((perm) => {
          sub = perm;
          sub.onchange = () => {
            if (sub.state === 'granted') {
              verifyGps();
            } else {
              setGpsReady(false);
            }
          };
        })
        .catch(() => {});
      return () => {
        if (sub) sub.onchange = null;
      };
    }
  }, [verifyGps]);

  // If GPS is not ready, keep prompting and completely block the portal & login screen
  return (
    <>
      {!gpsReady && (
        <GpsLocationModal
          isOpen={true}
          canClose={false}
          onSuccess={() => {
            setGpsReady(true);
            setChecking(false);
          }}
          title="Turn On GPS Location"
          description="Portal access is blocked until device location is enabled. Please allow location access to continue to login."
        />
      )}
      {gpsReady ? children : null}
    </>
  );
}
