import { useEffect, useState } from 'react';
import './InstallAppButton.css';

function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notOther = !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua);
  return iOS && webkit && (notOther || /Safari/.test(ua));
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    window.navigator.standalone === true
  );
}

/**
 * Shows a native install prompt when available (Chrome/Edge/Android).
 * On iOS Safari, shows Add to Home Screen instructions instead.
 */
function InstallAppButton({ compact = false }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [dismissedIos, setDismissedIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return undefined;
    }

    if (isIosSafari()) {
      const dismissed = sessionStorage.getItem('pwaIosHintDismissed') === '1';
      setDismissedIos(dismissed);
      setIosHint(true);
      return undefined;
    }

    function onBeforeInstall(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }

    function onInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice?.outcome === 'accepted') {
      setInstalled(true);
    }
  }

  function dismissIos() {
    sessionStorage.setItem('pwaIosHintDismissed', '1');
    setDismissedIos(true);
  }

  if (installed) return null;

  if (iosHint && !dismissedIos) {
    return (
      <div className={`install-app ${compact ? 'install-app-compact' : ''}`} role="note">
        <p className="install-app-ios">
          On iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>
        </p>
        <button type="button" className="install-app-dismiss" onClick={dismissIos} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  if (!deferredPrompt) return null;

  return (
    <div className={`install-app ${compact ? 'install-app-compact' : ''}`}>
      <button type="button" className="btn btn-primary install-app-btn" onClick={handleInstall}>
        Install App
      </button>
    </div>
  );
}

export default InstallAppButton;
