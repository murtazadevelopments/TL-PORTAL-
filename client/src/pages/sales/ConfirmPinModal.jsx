import { useEffect, useState } from 'react';

export default function ConfirmPinModal({ open, title, description, confirmLabel, busy, error, onCancel, onConfirm }) {
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) {
      setPin('');
      setLocalError('');
    }
  }, [open]);

  if (!open) return null;

  function submit(e) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin.trim())) {
      setLocalError('Enter your 4–8 digit sales PIN.');
      return;
    }
    onConfirm(pin.trim());
  }

  return (
    <div className="tl-modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="tl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title || 'Confirm with sales PIN'}</h2>
        <p className="muted">{description || 'Enter your PIN to save all changes.'}</p>
        <form className="form" onSubmit={submit}>
          <label>
            Sales PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={busy}
              autoFocus
            />
          </label>
          {(localError || error) && <p className="error">{localError || error}</p>}
          <div className="tl-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Please wait…' : confirmLabel || 'Confirm PIN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
