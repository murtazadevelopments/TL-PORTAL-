import { useEffect, useState } from 'react';
import InstallAppButton from './InstallAppButton';
import {
  enablePushNotifications,
  fetchPushStatus,
  isInstalledPwa,
} from '../utils/pushNotifications';
import './HeaderSetupActions.css';

/**
 * After login: if the account already has notifications enabled or this device
 * is the installed app, hide prompts. Otherwise show Install App + Enable
 * notifications in the header.
 */
export default function HeaderSetupActions() {
  const [ready, setReady] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(true);
  const [installed, setInstalled] = useState(() => isInstalledPwa());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchPushStatus();
        if (!active) return;
        setPushEnabled(Boolean(data?.enabled));
        setPushConfigured(data?.configured !== false);
      } catch {
        if (!active) return;
        setPushEnabled(false);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncInstalled = () => setInstalled(isInstalledPwa());
    window.addEventListener('appinstalled', syncInstalled);
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', syncInstalled);
    return () => {
      window.removeEventListener('appinstalled', syncInstalled);
      mq.removeEventListener?.('change', syncInstalled);
    };
  }, []);

  if (!ready) return null;
  if (pushEnabled || installed) return null;

  async function handleEnable() {
    setBusy(true);
    setError('');
    try {
      await enablePushNotifications();
      const data = await fetchPushStatus();
      setPushEnabled(Boolean(data?.enabled));
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell-setup-actions">
      <InstallAppButton compact alwaysShow />
      <button
        type="button"
        className="btn btn-ghost shell-notify-btn"
        disabled={busy || !pushConfigured}
        onClick={handleEnable}
      >
        {busy ? 'Enabling…' : 'Enable notifications'}
      </button>
      {error && (
        <p className="shell-setup-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
