import { useEffect, useState } from 'react';
import logo from '../assets/logo.webp';
import {
  isIosDevice,
  isStandalonePwa,
  promptInstallApp,
  subscribeInstallPrompt,
} from '../pwaInstall';
import {
  enablePushNotificationsSafe,
  isMobileDevice,
} from '../utils/pushNotifications';
import './InstallAppModal.css';

const DISMISS_KEY = 'tl-install-dismissed';

export default function InstallAppModal() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalonePwa() || !isMobileDevice()) return undefined;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return undefined;

    const unsub = subscribeInstallPrompt(() => {});

    const timer = window.setTimeout(() => {
      if (!isStandalonePwa()) setOpen(true);
    }, 900);

    function onInstalled() {
      setOpen(false);
    }
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      unsub();
      window.clearTimeout(timer);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setOpen(false);
  }

  async function handleInstall() {
    setBusy(true);
    setIosHint(false);
    try {
      const choice = await promptInstallApp();
      if (choice?.outcome === 'accepted') {
        setOpen(false);
        await enablePushNotificationsSafe();
        return;
      }
      if (choice?.outcome === 'unavailable' && isIosDevice()) {
        setIosHint(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="install-modal-backdrop" role="presentation" onClick={dismiss}>
      <div
        className="install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={logo} alt="" className="install-modal-logo" width={56} height={56} />
        <h2 id="install-modal-title">Install Textured Lab Portal</h2>
        <p>Open it like an app on your phone for faster access and alerts.</p>
        {iosHint && (
          <p className="install-modal-ios">
            On iPhone, tap the Share icon, then <strong>Add to Home Screen</strong>.
          </p>
        )}
        <div className="install-modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={handleInstall}
          >
            {busy ? 'Opening…' : 'Install'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
