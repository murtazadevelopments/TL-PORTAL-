import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import './ApplyLeaveModal.css';

export default function ApplyLeaveModal({ open, onClose, onSubmitted }) {
  const fileRef = useRef(null);
  const [leaveType, setLeaveType] = useState('sick');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLeaveType('sick');
    setStartDate('');
    setEndDate('');
    setFile(null);
    setFileName('');
    setError('');
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [open]);

  if (!open) return null;

  const needsPrescription = leaveType === 'sick';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (leaveType !== 'sick' && leaveType !== 'annual') {
      setError('Select Sick leave or Annual leave.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Select from and to dates.');
      return;
    }
    if (endDate < startDate) {
      setError('To date must be on or after from date.');
      return;
    }
    if (needsPrescription && !file) {
      setError('Upload a doctor prescription (image or PDF).');
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append('leave_type', leaveType);
      body.append('start_date', startDate);
      body.append('end_date', endDate);
      if (needsPrescription && file) body.append('prescription', file);
      const { data } = await api.post('/api/leave-requests', body);
      onSubmitted?.(data?.leave || null);
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit leave request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="apply-leave-backdrop" onClick={() => !busy && onClose?.()} role="presentation">
      <div
        className="apply-leave-panel"
        role="dialog"
        aria-labelledby="apply-leave-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="apply-leave-title">Apply for leave</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={() => !busy && onClose?.()}
            aria-label="Close"
            disabled={busy}
          >
            ×
          </button>
        </div>
        <form className="form edit-box" onSubmit={handleSubmit} style={{ padding: '0 1.25rem 1.25rem' }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Choose leave type and dates. Sick leave needs a doctor prescription. HR will review your
            request.
          </p>
          <label>
            Leave type <span className="req-star" aria-hidden="true">*</span>
            <select
              value={leaveType}
              onChange={(e) => {
                const next = e.target.value === 'annual' ? 'annual' : 'sick';
                setLeaveType(next);
                if (next === 'annual') {
                  setFile(null);
                  setFileName('');
                  if (fileRef.current) fileRef.current.value = '';
                }
              }}
              required
              disabled={busy}
            >
              <option value="sick">Sick leave</option>
              <option value="annual">Annual leave</option>
            </select>
          </label>
          <label>
            From date <span className="req-star" aria-hidden="true">*</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            To date <span className="req-star" aria-hidden="true">*</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          {needsPrescription && (
            <label>
              Doctor prescription <span className="req-star" aria-hidden="true">*</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                hidden
                onChange={(e) => {
                  const next = e.target.files?.[0] || null;
                  setFile(next);
                  setFileName(next ? next.name : '');
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                style={{ marginTop: '0.35rem' }}
              >
                {fileName ? 'Change file' : 'Upload prescription'}
              </button>
              {fileName ? (
                <span className="muted" style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.85rem' }}>
                  {fileName}
                </span>
              ) : (
                <span className="muted" style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.85rem' }}>
                  Image or PDF, required for sick leave.
                </span>
              )}
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => onClose?.()} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit leave request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
