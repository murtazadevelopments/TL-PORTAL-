import { useMemo } from 'react';
import logo from '../assets/logo.webp';
import './BirthdayCelebration.css';

function firstName(fullName) {
  const part = String(fullName || '')
    .trim()
    .split(/\s+/)[0];
  return part || 'there';
}

function Balloon({ className, delay, left, color }) {
  return (
    <span
      className={`bday-balloon ${className || ''}`}
      style={{ animationDelay: delay, left, '--balloon': color }}
      aria-hidden="true"
    >
      <span className="bday-balloon-body" />
      <span className="bday-balloon-knot" />
      <span className="bday-balloon-string" />
    </span>
  );
}

export default function BirthdayCelebration({ user, onContinue }) {
  const name = firstName(user?.name || user?.username);
  const balloons = useMemo(
    () => [
      { left: '6%', delay: '0s', color: '#3dff7a' },
      { left: '16%', delay: '0.8s', color: '#7ecbff' },
      { left: '28%', delay: '1.6s', color: '#a78bfa' },
      { left: '42%', delay: '0.4s', color: '#ff6b9d' },
      { left: '55%', delay: '1.2s', color: '#fff27a' },
      { left: '68%', delay: '2s', color: '#3dff7a' },
      { left: '78%', delay: '0.6s', color: '#7ecbff' },
      { left: '88%', delay: '1.4s', color: '#ff8a5b' },
    ],
    []
  );

  return (
    <div className="bday-overlay" role="dialog" aria-modal="true" aria-labelledby="bday-title">
      <div className="bday-ribbons" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="bday-confetti" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} style={{ '--i': i }} />
        ))}
      </div>
      {balloons.map((item) => (
        <Balloon key={item.left} {...item} />
      ))}

      <div className="bday-card">
        <img src={logo} alt="" width={88} height={88} />
        <p className="bday-kicker">A note from Textured Lab</p>
        <h1 id="bday-title">Happy Birthday, {name}!</h1>
        <p className="bday-note">
          Today the lab is brighter because you are in it. Thank you for the craft, the care, and
          the people you lift along the way. We are proud to work with you, and we hope this year
          brings you joy, rest, and work that feels like you.
        </p>
        <p className="bday-sign">With love — Textured Lab</p>
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          Continue to dashboard
        </button>
      </div>
    </div>
  );
}
