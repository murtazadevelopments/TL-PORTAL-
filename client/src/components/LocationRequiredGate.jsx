import { useEffect, useState } from 'react';
import { ensurePortalGps, GPS_REQUIRED_MESSAGE } from '../utils/deviceHints';
import './ProfileIncompleteLock.css';

export default function LocationRequiredGate({ onReady }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function check(fromButton = false) {
    setBusy(true);
    setError('');
    try {
      await ensurePortalGps();
      onReady?.();
    } catch (err) {
      setError(err?.message || GPS_REQUIRED_MESSAGE);
      if (!fromButton) setBusy(false);
      else setBusy(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    check(false);
    // First check on enter; retry is user-driven so iOS can show the prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only GPS gate
  }, []);

  return (
    <div className="profile-lock" role="alertdialog" aria-modal="true" aria-labelledby="gps-lock-title">
      <div className="profile-lock-card location-lock-card">
        <p className="profile-lock-kicker location-lock-kicker">Location required</p>
        <h2 id="gps-lock-title">Allow GPS to use the portal</h2>
        <p>
          Login logs need your exact location. Turn on Location Services, allow this site, then
          continue.
        </p>
        {error ? <p className="error" style={{ marginTop: '0.85rem' }}>{error}</p> : null}
        <div className="profile-lock-actions" style={{ marginTop: '1.1rem' }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => check(true)}>
            {busy ? 'Checking location…' : 'Allow location'}
          </button>
        </div>
      </div>
    </div>
  );
}
