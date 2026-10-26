import { useEffect } from 'react';
import './AttendanceGuideModal.css';

const STORAGE_PREFIX = 'portal.attendanceGuide.seen.';

export function attendanceGuideSeenKey(mode) {
  return `${STORAGE_PREFIX}${mode === 'onsite' ? 'onsite' : 'remote'}`;
}

export function hasSeenAttendanceGuide(mode) {
  try {
    return localStorage.getItem(attendanceGuideSeenKey(mode)) === '1';
  } catch {
    return true;
  }
}

export function markAttendanceGuideSeen(mode) {
  try {
    localStorage.setItem(attendanceGuideSeenKey(mode), '1');
  } catch {
    /* ignore */
  }
}

function remoteSteps(checksPerShift, flexibleHours) {
  const n = Number(checksPerShift) > 0 ? Number(checksPerShift) : flexibleHours ? 3 : 5;
  const timing = flexibleHours
    ? {
        title: `${n} checks, no fixed start time`,
        body: 'Check in when you start. Then one random check-in during assigned hours. Check out when you finish. After 15 minutes a check is late. After 40 minutes it is absent.',
      }
    : {
        title: `${n} checks each shift`,
        body: 'The first check is at shift start. The others appear at random during your hours. After 15 minutes a check is late. After 40 minutes it is absent.',
      };
  const action = flexibleHours
    ? {
        title: 'Tap Check in now, then Check out',
        body: 'When a check opens, tap the button. After check-out, your total time for the day is saved.',
      }
    : {
        title: 'Tap Check in now',
        body: 'When a check opens, tap the button. Blink or turn a little if asked, then hold still.',
      };
  return [
    {
      title: 'Enroll your face once',
      body: 'Allow the camera. Sit in good light, look into the circle, then tap Enroll face.',
    },
    timing,
    action,
    {
      title: 'Feasible time vs missed window',
      body: 'You can only check in while a check is open (feasible time). After that window closes, check-in is not possible and the missed check is absent.',
    },
    {
      title: '15 minutes late, 40 minutes absent',
      body: 'From the moment a check opens: within 15 minutes is on time, after 15 minutes is late, and after 40 minutes that check is absent.',
    },
    {
      title: 'Miss a random check and you are absent',
      body: 'If you miss any random availability check, it is counted as absent. Complete every open check. Sunday is a holiday.',
    },
  ];
}

function onsiteSteps() {
  return [
    {
      title: 'Use office Wi‑Fi',
      body: 'Be at your assigned office and connect to that office Wi‑Fi. GPS is not required.',
    },
    {
      title: 'Check in once',
      body: 'Open My attendance and tap Check in at the start of your shift. One check-in covers the day.',
    },
    {
      title: 'Shift times decide status',
      body: 'On time until your shift’s late time. After that you are late. After the absent time you are absent.',
    },
    {
      title: 'Night shift window',
      body: 'Night shift self check-in is open from 9:00 PM to 11:59 PM. After that, ask an admin.',
    },
    {
      title: 'Sunday is off',
      body: 'Sunday is a holiday. Your office is saved as the branch name, never as a raw IP.',
    },
  ];
}

export default function AttendanceGuideModal({
  open,
  mode = 'remote',
  checksPerShift = 5,
  flexibleHours = false,
  onClose,
}) {
  const isOnsite = mode === 'onsite';
  const steps = isOnsite ? onsiteSteps() : remoteSteps(checksPerShift, flexibleHours);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="att-guide-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="att-guide-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="att-guide-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="att-guide-glow" aria-hidden="true" />
        <button type="button" className="att-guide-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="att-guide-eyebrow">{isOnsite ? 'Office attendance' : 'Remote attendance'}</p>
        <h2 id="att-guide-title">How check-in works</h2>
        <p className="att-guide-lead">
          {isOnsite
            ? 'Short steps for checking in from the office.'
            : flexibleHours
              ? 'Short steps for flexible remote hours: start, random check, then check-out.'
              : 'Short steps for face check-in during your shift.'}
        </p>
        <ol className="att-guide-steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="att-guide-num" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-primary att-guide-done" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
