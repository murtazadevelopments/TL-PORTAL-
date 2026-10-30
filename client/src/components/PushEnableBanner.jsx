import { useEffect, useState } from 'react';
import {
  dismissPushBannerForWeek,
  enablePushNotifications,
  shouldShowIosInstallHint,
  shouldShowPushEnableBanner,
} from '../utils/pushNotifications';
import { showSuccess } from '../utils/successPopup';

export default function PushEnableBanner() {
  const [mode, setMode] = useState(null); // 'enable' | 'ios-install' | null
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (shouldShowPushEnableBanner()) setMode('enable');
    else if (shouldShowIosInstallHint()) setMode('ios-install');
    else setMode(null);
  }, []);

  if (!mode) return null;

  function dismiss() {
    dismissPushBannerForWeek();
    setMode(null);
  }

  async function handleEnable() {
    setBusy(true);
    try {
      await enablePushNotifications();
      showSuccess('Notifications enabled on this device.');
      setMode(null);
    } catch {
      /* enablePushNotifications / ensurePushSubscription already toast errors */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-profile-alert" role="status">
      <div>
        <strong>{mode === 'enable' ? 'Enable notifications' : 'Install the app for alerts'}</strong>
        <p>
          {mode === 'enable'
            ? 'Get phone alerts for messages, profile alerts, and attendance check-in requests.'
            : 'Install the app from Safari → Share → Add to Home Screen first, then open it from the home screen to enable notifications.'}
        </p>
      </div>
      <div className="portal-profile-alert-actions">
        {mode === 'enable' ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleEnable}>
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
