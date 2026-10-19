import { useEffect, useState } from 'react';
import {
  isIosDevice,
  isStandalonePwa,
  promptInstallApp,
  subscribeInstallPrompt,
} from '../pwaInstall';
import { enablePushNotificationsSafe } from '../utils/pushNotifications';
import './InstallAppButton.css';

function InstallAppButton() {
  const [installed, setInstalled] = useState(() => isStandalonePwa());
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (isStandalonePwa()) {
      setInstalled(true);
      return undefined;
    }
    const unsub = subscribeInstallPrompt(() => {});
    function onInstalled() {
      setInstalled(true);
      setHint('');
    }
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      unsub();
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    setHint('');
    setBusy(true);
    try {
      const choice = await promptInstallApp();
      if (choice?.outcome === 'accepted') {
        setInstalled(true);
        await enablePushNotificationsSafe();
        return;
      }
      if (choice?.outcome === 'unavailable') {
        setHint(
          isIosDevice()
            ? 'Tap Share, then Add to Home Screen.'
            : 'Tap the browser menu ⋮, then Install app.'
        );
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
        {busy ? 'Installing…' : 'Install app'}
      </button>
      {hint ? <p className="install-app-hint">{hint}</p> : null}
    </div>
  );
}

export default InstallAppButton;
