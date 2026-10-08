import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import api from '../../api/client';
import { useAuthUser } from '../../context/AuthUserContext';
import { canAccessAdmin, canViewTeamAttendance } from '../../utils/permissions';
import { formatTimeAmPm } from '../../utils/timeAmPm';
import './AttendancePage.css';

function statusLabel(status) {
  if (status === 'on_time') return 'On time';
  if (status === 'late') return 'Late';
  if (status === 'absent') return 'Absent';
  if (status === 'holiday') return 'Holiday';
  return status || '—';
}

function formatKarachiTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

function readCheckInCoords() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('This browser cannot share location. Use Chrome or Safari with Location Services on.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
          reject(new Error('Could not read a valid GPS position. Turn on Location Services and try again.'));
          return;
        }
        resolve({ latitude, longitude });
      },
      (err) => {
        if (err?.code === 1) {
          reject(new Error('Location is required to check in. Allow GPS for this site, then try again.'));
          return;
        }
        if (err?.code === 3) {
          reject(new Error('Location request timed out. Turn on GPS and try again.'));
          return;
        }
        reject(new Error('Could not read your GPS position. Turn on Location Services and try again.'));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export default function OnsiteAttendancePage() {
  const { user, permissions } = useAuthUser();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);

  const canSeeAdmin =
    canAccessAdmin(user?.role) && canViewTeamAttendance(user?.role, permissions);

  const load = useCallback(async () => {
    const { data: payload } = await api.get('/api/attendance/onsite-me', {
      params: { _: Date.now() },
    });
    setData(payload);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch((err) => {
        if (!active) return;
        setError(err.response?.data?.message || 'Could not load attendance.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function handleCheckIn() {
    setCheckingIn(true);
    setError('');
    setStatus('');
    try {
      const coords = await readCheckInCoords();
      const { data: payload } = await api.post('/api/attendance/onsite-check-in', {
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      setStatus(
        payload.status === 'on_time'
          ? 'Checked in on time.'
          : payload.status === 'late'
            ? 'Checked in — marked late.'
            : 'Checked in — marked absent.'
      );
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Check-in failed.');
    } finally {
      setCheckingIn(false);
    }
  }

  const totals = data?.totals || { on_time: 0, late: 0, absent: 0 };
  const today = data?.today;
  const shift = data?.shift;

  return (
    <div className="card wide page-panel attendance-page">
      <div className="attendance-hero">
        <div>
          <h1>My attendance</h1>
          <p className="muted">
            Check in only when you are on the assigned office Wi‑Fi and at the office GPS location.
            Status follows your shift (on time / late / absent). Your office is recorded as{' '}
            {data?.branch_name || user?.branch || 'your assigned branch'} — never as a raw IP.
          </p>
        </div>
        {canSeeAdmin && (
          <Link className="btn btn-ghost" to="/admin/attendance">
            Team dashboard
          </Link>
        )}
      </div>

      <div className="attendance-summary">
        <div className="attendance-stat">
          <span>On time</span>
          <strong>{totals.on_time || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Late</span>
          <strong>{totals.late || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Absent</span>
          <strong>{totals.absent || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Holiday</span>
          <strong>{totals.holiday || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Today</span>
          <strong>{today ? statusLabel(today.status) : '—'}</strong>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {status && <p className="success">{status}</p>}
      {loading && <p className="muted">Loading…</p>}

      <section className="onsite-checkin-card">
        <h2>Today</h2>
        {shift ? (
          <p className="muted">
            {shift.name}
            {shift.start_time ? ` · starts ${formatTimeAmPm(shift.start_time)}` : ''}
            {shift.late_after ? ` · late after ${formatTimeAmPm(shift.late_after)}` : ''}
            {shift.absent_after ? ` · absent after ${formatTimeAmPm(shift.absent_after)}` : ''}
          </p>
        ) : (
          <p className="muted">No shift assigned yet. Ask HR to assign one.</p>
        )}
        {data?.holiday && !today?.checked_in_at ? (
          <p className="muted">Sunday is a holiday. Office check-in is not required.</p>
        ) : today ? (
          <p>
            Checked in at{' '}
            <strong>
              {formatKarachiTime(today.checked_in_at)}
            </strong>{' '}
            · {statusLabel(today.status)}
            {today.branch_name ? ` · ${today.branch_name}` : ''}
          </p>
        ) : data?.night_shift && !data?.self_check_in_open ? (
          <p className="muted">
            Night shift self check-in is open from 9:00 PM to 11:59 PM.
            After that, only an admin can mark attendance.
          </p>
        ) : (
          <p className="muted">Not checked in yet.</p>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={checkingIn || Boolean(today) || !data?.can_check_in}
          onClick={handleCheckIn}
        >
          {checkingIn
            ? 'Checking in…'
            : today?.checked_in_at
              ? 'Already checked in'
              : data?.holiday
                ? 'Sunday holiday'
                : data?.night_shift && !data?.self_check_in_open
                  ? 'Check-in closed'
                  : 'Check in'}
        </button>
        {data?.night_shift && !today && data?.self_check_in_open && (
          <p className="muted">Self check-in closes at 11:59 PM. After that, ask an admin.</p>
        )}
        {!data?.network_configured && !today && (
          <p className="muted">
            Office Wi‑Fi IP and GPS location must both be saved for{' '}
            {data?.branch_name || user?.branch || 'your branch'}. Set them on Manage Branches for that
            same branch.
          </p>
        )}
      </section>

      <section>
        <h2>This month</h2>
        <ol className="attendance-day-list">
          {(data?.days || []).map((day) => (
            <li key={day.work_date} className={`attendance-day ${day.status}`}>
              <span className="attendance-day-date">{day.work_date}</span>
              <span className="attendance-day-status">{statusLabel(day.status)}</span>
            </li>
          ))}
          {!loading && (data?.days || []).length === 0 && (
            <li className="muted">No check-ins yet this month.</li>
          )}
        </ol>
      </section>
    </div>
  );
}
