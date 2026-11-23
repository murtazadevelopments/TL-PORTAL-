import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthUser } from '../../context/AuthUserContext';
import { canUseHardwareLedger } from '../../utils/permissions';

export function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** YYYY-MM in Asia/Karachi (same month basis as petty cash). */
export function currentMonthKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Value for <input type="datetime-local"> in the user's local time. */
export function toDateTimeLocalValue(value) {
  let d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert the datetime-local value (browser local time) to an exact ISO
 * timestamp so the server stores the correct moment regardless of its timezone.
 */
export function localInputToIso(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Redirects away unless the signed-in user is assigned the Hardware ledger. */
export function useHardwareLedgerGuard() {
  const navigate = useNavigate();
  const { user, role, permissions, loading } = useAuthUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    if (!canUseHardwareLedger(role, permissions)) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setReady(true);
  }, [loading, user, role, permissions, navigate]);

  return ready;
}
