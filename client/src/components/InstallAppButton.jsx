import { useEffect, useState } from 'react';
import { isStandalonePwa, promptInstallApp, subscribeInstallPrompt } from '../pwaInstall';
import { enablePushNotificationsSafe } from '../utils/pushNotifications';
import './InstallAppButton.css';

/**
 * One-tap native install (Chrome / Edge / Android).
 * Does not show Add to Home Screen instructions unless Install cannot run.
 */
function InstallAppButton() {
  const [installed, setInstalled] = useState(() => isStandalonePwa());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isStandalonePwa()) {
      setInstalled(true);
      return undefined;
    }
    const unsub = subscribeInstallPrompt(() => {});
    function onInstalled() {
      setInstalled(true);
    }
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      unsub();
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    const pending = promptInstallApp();
    setBusy(true);
    try {
      const choice = await pending;
      if (choice?.outcome === 'accepted') {
        setInstalled(true);
        await enablePushNotificationsSafe();
      }
    } finally {
      setBusy(false);
    }
  }

  if (installed) return null;

  return (
    <div className="install-app">
      <button
        type="button"
        className="btn btn-primary install-app-btn"
        disabled={busy}
        onClick={handleInstall}
      >
        {busy ? 'Opening…' : 'Install'}
      </button>
    </div>
  );
}

export default InstallAppButton;
