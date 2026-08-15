import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

const INACTIVITY_MS = 5 * 60 * 1000;
const WARN_AT_MS = 4.5 * 60 * 1000;
const COUNTDOWN_SEC = 30;

const InactivityContext = createContext({
  setBusy: () => {},
});

export function useInactivityGuard() {
  return useContext(InactivityContext);
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

/**
 * Logs the user out after 5 minutes of no interaction.
 * Warns at 4.5 minutes. Uploads/busy work can call setBusy(true) to pause the timer.
 */
export default function InactivityGuard({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [warnOpen, setWarnOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SEC);
  const busyCount = useRef(0);
  const lastActivity = useRef(Date.now());
  const warnShown = useRef(false);

  const isAuthedRoute =
    location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/admin');

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setWarnOpen(false);
    warnShown.current = false;
    navigate('/', {
      replace: true,
      state: { inactivityMessage: 'You were logged out due to inactivity.' },
    });
  }, [navigate]);

  const staySignedIn = useCallback(() => {
    lastActivity.current = Date.now();
    warnShown.current = false;
    setWarnOpen(false);
    setSecondsLeft(COUNTDOWN_SEC);
  }, []);

  const setBusy = useCallback((busy) => {
    if (busy) {
      busyCount.current += 1;
      lastActivity.current = Date.now();
    } else {
      busyCount.current = Math.max(0, busyCount.current - 1);
      lastActivity.current = Date.now();
    }
  }, []);

  useEffect(() => {
    if (!isAuthedRoute || !localStorage.getItem('token')) {
      setWarnOpen(false);
      return undefined;
    }

    lastActivity.current = Date.now();
    warnShown.current = false;

    const onActivity = () => {
      if (busyCount.current > 0) return;
      lastActivity.current = Date.now();
      if (warnShown.current) {
        warnShown.current = false;
        setWarnOpen(false);
        setSecondsLeft(COUNTDOWN_SEC);
      }
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    const tick = setInterval(() => {
      if (!localStorage.getItem('token')) return;
      if (busyCount.current > 0) {
        lastActivity.current = Date.now();
        return;
      }

      const idle = Date.now() - lastActivity.current;
      if (idle >= INACTIVITY_MS) {
        logout();
        return;
      }
      if (idle >= WARN_AT_MS) {
        if (!warnShown.current) {
          warnShown.current = true;
          setWarnOpen(true);
        }
        const left = Math.max(1, Math.ceil((INACTIVITY_MS - idle) / 1000));
        setSecondsLeft(left);
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, [isAuthedRoute, logout]);

  return (
    <InactivityContext.Provider value={{ setBusy }}>
      {children}
      {warnOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inactivity-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: '100%', margin: 0 }}
          >
            <h2 id="inactivity-title" style={{ marginTop: 0 }}>
              Still there?
            </h2>
            <p>
              You&apos;ll be logged out in <strong>{secondsLeft}</strong> second
              {secondsLeft === 1 ? '' : 's'} due to inactivity.
            </p>
            <button type="button" className="btn btn-primary" onClick={staySignedIn}>
              Stay signed in
            </button>
          </div>
        </div>
      )}
    </InactivityContext.Provider>
  );
}
