import { useEffect, useState } from 'react';
import {
  dismissPushBannerForWeek,
  enablePushNotifications,
  fetchPushStatus,
  markPushEverEnabled,
  shouldShowIosInstallHint,
  shouldShowPushEnableBanner,
} from '../utils/pushNotifications';
import { showSuccess } from '../utils/successPopup';

export default function PushEnableBanner() {
  const [mode, setMode] = useState(null); // 'enable' | 'ios-install' | null
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // Account already has push on another/this device — never nag again here.
      try {
        const status = await fetchPushStatus();
        if (!active) return;
        if (status?.enabled || Number(status?.subscriptionCount) > 0) {
          markPushEverEnabled();
          setMode(null);
          return;
        }
      } catch {
        /* fall through to local checks */
      }
      if (!active) return;
      if (shouldShowPushEnableBanner()) setMode('enable');
      else if (shouldShowIosInstallHint()) setMode('ios-install');
      else setMode(null);
    })();
    return () => {
      active = false;
    };
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
      markPushEverEnabled();
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
