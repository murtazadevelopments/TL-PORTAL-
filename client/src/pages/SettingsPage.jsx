import { useEffect, useState } from 'react';
import InstallAppButton from '../components/InstallAppButton';
import HardRefreshButton from '../components/HardRefreshButton';
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
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>Install</h2>
        <p className="muted">Install Textured Lab Portal on this device.</p>
        {isInstalledPwa() ? (
          <p className="success" style={{ marginTop: '0.65rem' }}>
            App is installed on this device.
          </p>
        ) : (
          <div style={{ marginTop: '0.75rem' }}>
            <InstallAppButton />
          </div>
        )}
      </section>

      {showPush && (
        <section style={{ marginTop: '1.75rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>Mobile notifications</h2>
          <p className="muted">
            Get a phone alert for new portal messages and when someone signs in to your account
            (backup if login email does not arrive). Notifications turn on automatically when you
            open the installed app. You can turn them off here if you do not want alerts.
          </p>

          {!isInstalledPwa() && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Install the app first. Notifications turn on when you open it.
            </p>
          )}

          {pushStatus && !pushStatus.configured && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              {pushStatus.message ||
                'Push is not configured on the server yet (missing VAPID keys).'}
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

      <section style={{ marginTop: '1.75rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>Updates</h2>
        <p className="muted">
          If this device still shows an old version, empty the app cache and reload.
        </p>
        <div style={{ marginTop: '0.75rem' }}>
          <HardRefreshButton />
        </div>
      </section>
    </div>
  );
}
