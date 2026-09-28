import { useEffect, useState } from 'react';
import { subscribeSuccessPopup } from '../utils/successPopup';
import './SuccessPopup.css';

const SHOW_MS = 3500;

export default function SuccessPopup() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let hideTimer;
    const unsubscribe = subscribeSuccessPopup((next) => {
      if (!next) return;
      setMessage(next);
      setVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setVisible(false), SHOW_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!visible || !message) return null;

  return (
    <div className="portal-success-popup" role="status" aria-live="polite">
      <span className="portal-success-popup-icon" aria-hidden="true">
        ✓
      </span>
      <p>{message}</p>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  );
}
