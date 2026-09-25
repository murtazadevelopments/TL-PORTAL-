import logo from '../assets/logo.webp';
import './BirthdayCelebration.css';

function firstName(fullName) {
  const part = String(fullName || '')
    .trim()
    .split(/\s+/)[0];
  return part || 'there';
}

export default function ExamCelebration({ user, examLabel, onContinue }) {
  const name = firstName(user?.name || user?.username);
  const exam = String(examLabel || 'your exam').trim() || 'your exam';

  return (
    <div className="bday-overlay" role="dialog" aria-modal="true" aria-labelledby="exam-title">
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

      <div className="bday-card">
        <img src={logo} alt="" width={88} height={88} />
        <p className="bday-kicker">A note from Textured Lab</p>
        <h1 id="exam-title">Congratulations, {name}!</h1>
        <p className="bday-note">
          You cleared {exam}. That takes focus, patience, and a lot of late effort that most people
          never see. We are proud of you, and the whole lab is cheering with you.
        </p>
        <p className="bday-sign">With love — Textured Lab</p>
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          Continue to dashboard
        </button>
      </div>
    </div>
  );
}
