import { useEffect, useState } from 'react';
import InstallAppButton from '../components/InstallAppButton';
import HardRefreshButton from '../components/HardRefreshButton';
import api from '../api/client';
import { getClientAppVersion } from '../utils/appVersion';
import {
  canUseMobilePushUi,
  currentNotificationPermission,
  disablePushNotifications,
  enablePushNotifications,
  fetchPushStatus,
  isInstalledPwa,
  notificationBlockedHelp,
} from '../utils/pushNotifications';

export default function SettingsPage() {
  const clientVersion = getClientAppVersion();
  const [serverVersion, setServerVersion] = useState(null);
  const [pushStatus, setPushStatus] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushSuccess, setPushSuccess] = useState('');
  const showPush = canUseMobilePushUi();
  const [browserPermission, setBrowserPermission] = useState(() =>
    canUseMobilePushUi() ? currentNotificationPermission() : 'default'
  );

  useEffect(() => {
    let active = true;
    api
      .get('/api/version')
      .then(({ data }) => {
        if (active) setServerVersion(data || null);
      })
      .catch(() => {
        if (active) setServerVersion(null);
      });
    return () => {
      active = false;
    };
  }, []);

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
    function syncPermission() {
      const next = currentNotificationPermission();
      setBrowserPermission(next);
    }
    syncPermission();
    window.addEventListener('focus', syncPermission);
    document.addEventListener('visibilitychange', syncPermission);
    return () => {
      active = false;
      window.removeEventListener('focus', syncPermission);
      document.removeEventListener('visibilitychange', syncPermission);
    };
  }, [showPush]);

  useEffect(() => {
    if (!showPush || browserPermission !== 'granted' || pushStatus?.enabled) return undefined;
    let active = true;
    enablePushNotifications({ silent: true })
      .then(async () => {
        if (!active) return;
        const data = await fetchPushStatus();
        setPushStatus(data);
        setPushError('');
        setPushSuccess('Notifications enabled on this device.');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [showPush, browserPermission, pushStatus?.enabled]);

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
        <p className="muted">Tap once to install the app on this phone.</p>
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
            Get a phone alert for messages, profile alerts, photo alerts, and attendance check-in
            requests. Notifications turn on when you allow them in this browser or the installed app.
          </p>

          {!isInstalledPwa() && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              On iPhone, install the app and open it from the home screen so notifications can be delivered.
            </p>
          )}

          {pushStatus && !pushStatus.configured && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              {pushStatus.message ||
                'Notifications are unavailable. Check your internet connection and try again.'}
            </p>
          )}

          {browserPermission === 'denied' && !pushStatus?.enabled && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              {notificationBlockedHelp()}
            </p>
          )}
          {pushError && pushError !== notificationBlockedHelp() && (
            <p className="error">{pushError}</p>
          )}
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

      <footer
        className="muted"
        style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)', fontSize: '0.8rem' }}
      >
        Build {serverVersion?.commit || clientVersion.commit}
        {serverVersion?.builtAt
          ? ` · ${new Date(serverVersion.builtAt).toLocaleString()}`
          : clientVersion.builtAt
            ? ` · ${new Date(clientVersion.builtAt).toLocaleString()}`
            : ''}
      </footer>
    </div>
  );
}
