import { useEffect, useState } from 'react';
import { promptInstallApp, subscribeInstallPrompt } from '../pwaInstall';
import { enablePushNotificationsSafe, requestPushPermission } from '../utils/pushNotifications';
import './InstallAppButton.css';

function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notOther = !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua);
  return iOS && webkit && (notOther || /Safari/.test(ua));
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/**
 * Opens the native install prompt on click (Chrome/Edge/Android).
 * iOS has no install API, so those devices still need Share → Add to Home Screen.
 */
function InstallAppButton({ compact = false, alwaysShow = false }) {
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [ios, setIos] = useState(false);
  const [iosDismissed, setIosDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return undefined;
    }
    setIos(isIosSafari());
    setIosDismissed(sessionStorage.getItem('pwaIosHintDismissed') === '1');
    const unsub = subscribeInstallPrompt((event) => setCanPrompt(Boolean(event)));
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
    await requestPushPermission();
    const choice = await promptInstallApp();
    if (choice?.outcome === 'accepted') {
      setInstalled(true);
      await enablePushNotificationsSafe();
    }
  }

  if (installed) return null;

  const wrapClass = `install-app ${compact ? 'install-app-compact' : ''}`;

  if (ios) {
    if (!alwaysShow && iosDismissed) return null;
    return (
      <div className={wrapClass} role="note">
        <p className="install-app-ios">
          On iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>
        </p>
        {!alwaysShow && (
          <button
            type="button"
            className="install-app-dismiss"
            onClick={() => {
              sessionStorage.setItem('pwaIosHintDismissed', '1');
              setIosDismissed(true);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  if (!alwaysShow && !canPrompt) return null;

  return (
    <div className={wrapClass}>
      <button type="button" className="btn btn-primary install-app-btn" onClick={handleInstall}>
        Install App
      </button>
    </div>
  );
}

export default InstallAppButton;
