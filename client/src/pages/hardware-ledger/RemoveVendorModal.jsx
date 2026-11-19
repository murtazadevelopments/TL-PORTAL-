import { useState } from 'react';
import { createPortal } from 'react-dom';
import PasswordInput from '../../components/PasswordInput';
import '../petty-cash/PettyCashDashboard.css';

/**
 * CEO/manager-only confirm: account password required to remove a vendor.
 */
export default function RemoveVendorModal({ vendor, busy, error, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');

  if (!vendor || typeof document === 'undefined') return null;

  function handleSubmit(e) {
    e.preventDefault();
    const value = String(password || '');
    if (!value.trim()) return;
    onConfirm(value);
  }

  return createPortal(
    <div className="petty-modal-backdrop" onClick={onCancel} role="presentation">
      <form
        className="petty-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hw-remove-vendor-title"
      >
        <div className="petty-modal-header">
          <h2 id="hw-remove-vendor-title">Remove vendor</h2>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Close
          </button>
        </div>
        <p className="petty-sub" style={{ marginBottom: '0.85rem' }}>
          Remove “{vendor.name}”? All of their items and paid records will be deleted. Enter your
          account password to confirm.
        </p>
        {error ? <p className="error">{error}</p> : null}
        <div className="petty-form petty-form-modal">
          <PasswordInput
            name="hardware_remove_vendor_password"
            label="Account password"
            requiredMark
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
          />
          <div className="petty-form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !password.trim()}>
              {busy ? 'Removing…' : 'Remove vendor'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}
