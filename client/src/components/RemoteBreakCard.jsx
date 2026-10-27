import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useAuthUser } from '../context/AuthUserContext';
import FaceVerifyModal from './FaceVerifyModal';
import ShiftHoursDetail from './ShiftHoursDetail';
import './RemoteBreakCard.css';
import './ShiftHoursDetail.css';

export default function RemoteBreakCard({
  showHours = true,
  onUpdated,
  variant = 'card',
  poll = true,
  att: attProp,
  onVerifyChange,
}) {
  const { user } = useAuthUser();
  const isRemote = String(user?.employment_type || '').trim().toLowerCase() === 'remote';
  const [att, setAtt] = useState(attProp || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verifyOpen, setVerifyOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get('/api/attendance/me');
    setAtt(data);
    return data;
  }, []);

  useEffect(() => {
    if (attProp) setAtt(attProp);
  }, [attProp]);

  useEffect(() => {
    if (!poll) return undefined;
    let active = true;
    load().catch(() => {
      if (active && !attProp) setAtt(null);
    });
    const id = setInterval(() => {
      load().catch(() => {});
    }, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [load, poll, attProp]);

  if (!isRemote || !att?.breaks_enabled) return null;

  async function startBreak() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/api/attendance/break/start', {}, { skipSuccessPopup: true });
      setAtt((prev) => ({ ...prev, ...data, on_break: true }));
      setNotice(data.message || 'Break started.');
      if (poll) await load();
      await onUpdated?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not start break.');
    } finally {
      setBusy(false);
    }
  }

  async function finishBreak(embedding) {
    const { data } = await api.post(
      '/api/attendance/break/end',
      { embedding },
      { skipSuccessPopup: true }
    );
    setVerifyOpen(false);
    onVerifyChange?.(false);
    setAtt((prev) => ({ ...prev, ...data, on_break: false }));
    setNotice(data.message || 'Break is off.');
    if (poll) await load();
    await onUpdated?.();
  }

  const on = Boolean(att.on_break);
  const switchControl = (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="attendance-switch"
        disabled={busy || (!on && !att.can_break)}
        onClick={() => {
          if (on) {
            setVerifyOpen(true);
            onVerifyChange?.(true);
          } else startBreak();
        }}
      />
      <strong>{busy ? '…' : on ? 'On' : 'Off'}</strong>
    </>
  );
  const modal = (
    <FaceVerifyModal
      open={verifyOpen}
      title="End break"
      detail="Verify your face to start working again. If it does not match, you stay on break."
      onCancel={() => {
        setVerifyOpen(false);
        onVerifyChange?.(false);
      }}
      onCapture={finishBreak}
    />
  );

  if (variant === 'faceid') {
    return (
      <>
        <div className={`faceid-break-row ${on ? 'is-on' : ''}`}>
          <span>Break</span>
          <div className="faceid-break-switch">
            {switchControl}
          </div>
        </div>
        {error ? <p className="faceid-break-msg error">{error}</p> : null}
        {modal}
      </>
    );
  }

  return (
    <section className={`remote-break-card ${on ? 'is-on' : ''}`}>
      <div className="remote-break-head">
        <div>
          <h2>Break</h2>
          <p className="muted">
            {on
              ? 'You are on break. Tap Off and verify your face to start work again.'
              : att.can_break
                ? 'Tap On when you need a break during working hours.'
                : 'Check in first during working hours, then you can take a break.'}
          </p>
        </div>
        <div className={`attendance-power ${on ? '' : 'is-off'}`}>
          <span>Break</span>
          {switchControl}
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      {showHours ? (
        <ShiftHoursDetail
          workLabel={att.work_label}
          breakLabel={att.break_label}
          firstCheckIn={att.first_check_in}
          checkedOutAt={att.checked_out_at}
          breaks={att.breaks}
          onBreak={on}
          showBreak
        />
      ) : null}
      {modal}
    </section>
  );
}
