import { useEffect } from 'react';
import './SignupWelcomeModal.css';

function firstName(fullName) {
  const part = String(fullName || '')
    .trim()
    .split(/\s+/)[0];
  return part || 'there';
}

function SignupWelcomeModal({ name, onContinue }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) {
      if (e.key === 'Enter' || e.key === 'Escape') onContinue();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onContinue]);

  return (
    <div className="signup-welcome-backdrop" role="presentation">
      <div
        className="signup-welcome-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-welcome-title"
      >
        <span className="signup-welcome-spark" aria-hidden="true" />
        <span className="signup-welcome-spark" aria-hidden="true" />
        <span className="signup-welcome-spark" aria-hidden="true" />
        <span className="signup-welcome-spark" aria-hidden="true" />
        <span className="signup-welcome-spark" aria-hidden="true" />
        <span className="signup-welcome-spark" aria-hidden="true" />

        <div className="signup-welcome-seal" aria-hidden="true">
          <span className="signup-welcome-ring" />
          <div className="signup-welcome-check">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M5 12.5l4.2 4.2L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <p className="signup-welcome-eyebrow">You are in</p>
        <h2 id="signup-welcome-title">
          Welcome to the lab, <span>{firstName(name)}</span>
        </h2>
        <p className="signup-welcome-copy">
          Thank you for joining Textured Lab. Your account is ready, and we are glad to have you
          with us.
        </p>
        <p className="signup-welcome-note">
          An administrator will review and activate your profile. After that, you can sign in and
          get started.
        </p>
        <div className="signup-welcome-actions">
          <button type="button" className="btn btn-primary" onClick={onContinue}>
            Continue to sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export default SignupWelcomeModal;
