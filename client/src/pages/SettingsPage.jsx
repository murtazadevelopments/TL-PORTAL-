import { useEffect, useState } from 'react';
import InstallAppButton from '../components/InstallAppButton';
import {
  canUseMobilePushUi,
  disablePushNotifications,
  enablePushNotifications,
  fetchPushStatus,
  isInstalledPwa,
} from '../utils/pushNotifications';

export default function SettingsPage() {
  const [pushStatus, setPushStatus] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushSuccess, setPushSuccess] = useState('');
  const showPush = canUseMobilePushUi();

  useEffect(() => {
    if (!showPush) return undefined;
    let active = true;
    (async () => {
      try {
        const data = await fetchPushStatus();
        if (active) setPushStatus(data);
      } catch {
        if (active) setPushStatus({ configured: false, enabled: false });
      }
    })();
    return () => {
      active = false;
    };
  }, [showPush]);

  async function handleEnablePush() {
    setPushBusy(true);
    setPushError('');
    setPushSuccess('');
    try {
      await enablePushNotifications();
      const data = await fetchPushStatus();
      setPushStatus(data);
      setPushSuccess('Notifications enabled on this device.');
    } catch (err) {
      setPushError(err.response?.data?.message || err.message || 'Could not enable notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    setPushBusy(true);
    setPushError('');
    setPushSuccess('');
    try {
      await disablePushNotifications();
      const data = await fetchPushStatus();
      setPushStatus(data);
      setPushSuccess('Notifications turned off on this device.');
    } catch (err) {
      setPushError(err.response?.data?.message || err.message || 'Could not disable notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="card wide page-panel">
      <h1>Settings</h1>
      <p className="muted">App preferences for this device</p>

      <section style={{ marginTop: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>Install App</h2>
        <p className="muted">
          Add Textured Lab Portal to your home screen for faster access (PWA).
        </p>
        <InstallAppButton />
      </section>

      {showPush && (
        <section style={{ marginTop: '1.75rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>Mobile notifications</h2>
          <p className="muted">
            Get a phone alert when you receive a portal message. Only works after you install the
            app on your phone (Add to Home Screen).
          </p>

          {!isInstalledPwa() && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Tip: install the app first, open it from your home screen, then enable notifications.
            </p>
          )}

          {pushStatus && !pushStatus.configured && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              Push is not configured on the server yet (missing VAPID keys).
            </p>
          )}

          {pushError && <p className="error">{pushError}</p>}
          {pushSuccess && <p className="success">{pushSuccess}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
            {pushStatus?.enabled ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pushBusy}
                onClick={handleDisablePush}
              >
                {pushBusy ? 'Updating…' : 'Turn off notifications'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={pushBusy || pushStatus?.configured === false}
                onClick={handleEnablePush}
              >
                {pushBusy ? 'Enabling…' : 'Enable notifications'}
              </button>
            )}
          </div>

          {pushStatus?.enabled && (
            <p className="muted" style={{ marginTop: '0.65rem', fontSize: '0.9rem' }}>
              On · {pushStatus.subscriptionCount || 1} device subscription
              {pushStatus.subscriptionCount === 1 ? '' : 's'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
