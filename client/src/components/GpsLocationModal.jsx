import { useCallback, useEffect, useState } from 'react';
import { requireLoginGps } from '../utils/deviceHints';
import './GpsLocationModal.css';

export default function GpsLocationModal({
  isOpen,
  onSuccess,
  title = 'Enable GPS Location',
  description = 'Location access is required to use Textured Lab Portal.',
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const requestGps = useCallback(async () => {
    setBusy(true);
    setError('');
    setSuccess(false);

    try {
      const gps = await requireLoginGps();
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.(gps);
      }, 500);
    } catch (err) {
      setError(err?.message || 'Location permission is required.');
    } finally {
      setBusy(false);
    }
  }, [onSuccess]);

  useEffect(() => {
    if (!isOpen) {
      setBusy(false);
      setError('');
      setSuccess(false);
      return undefined;
    }

    // Immediately trigger browser location prompt
    requestGps();

    // Auto-detect when user grants permission in browser
    const timer = setInterval(() => {
      if (!success) {
        requireLoginGps()
          .then((gps) => {
            setSuccess(true);
            setTimeout(() => onSuccess?.(gps), 400);
          })
          .catch(() => {});
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [isOpen, requestGps, success, onSuccess]);

  if (!isOpen) return null;

  return (
    <div className="gps-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="gps-modal-title">
      <div className={`gps-modal-card${error ? ' has-error-state' : ''}`}>
        <div className="gps-beacon-wrap">
          {!error && !success && (
            <>
              <div className="gps-beacon-pulse" />
              <div className="gps-beacon-pulse second" />
            </>
          )}
          <div
            className={`gps-beacon-icon-box${error ? ' has-error' : ''}${
              success ? ' is-success' : ''
            }`}
          >
            {success ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : error ? (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            ) : (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            )}
          </div>
        </div>

        <h2 id="gps-modal-title" className="gps-modal-title">
          {success ? 'Location Enabled!' : title}
        </h2>

        <p className="gps-modal-desc">
          {success ? 'Location verified. Opening portal…' : description}
        </p>

        {error && !success ? (
          <p className="gps-simple-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="gps-modal-actions">
          <button
            type="button"
            className="gps-primary-btn"
            disabled={busy || success}
            onClick={() => requestGps()}
          >
            {busy ? (
              <>
                <span className="gps-spinner" />
                Allowing Location…
              </>
            ) : success ? (
              'Location Enabled ✓'
            ) : error ? (
              '📍 Allow Location'
            ) : (
              '📍 Allow Location'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
