import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, canViewTeamAttendance } from '../../utils/permissions';
import './AdminDashboard.css';

function karachiParts(iso) {
  if (!iso) return { date: '—', time: '—' };
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: '—', time: '—' };
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
  return { date, time };
}

export default function AttendanceDashboard() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/admin/zkteco-attendance', {
        params: { limit: 300 },
      });
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load biometric punches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!canAccessAdmin(data.role) || !canViewTeamAttendance(data.role, data.permissions)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setChecking(false);
      } catch {
        if (!active) return;
        localStorage.removeItem('token');
        navigate('/', { replace: true });
      }
    }
    verify();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (checking) return undefined;
    loadLogs();
    const timer = setInterval(loadLogs, 30000);
    return () => clearInterval(timer);
  }, [checking, loadLogs]);

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <p className="muted">Checking access…</p>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel">
      <h1>Biometric attendance</h1>
      <p className="muted">
        Punches from the office ZKTeco device. The LAN sync worker writes these every five minutes.
        This table refreshes automatically.
      </p>
      {error && <p className="error">{error}</p>}
      <p className="muted">{loading ? 'Refreshing…' : `${logs.length} latest punches`}</p>
      <div className="table-shell">
        {logs.length === 0 && !loading ? (
          <div className="admin-empty">No biometric punches yet.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Date</th>
                <th>Punch time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => {
                const parts = karachiParts(row.punch_time);
                return (
                  <tr key={row.id}>
                    <td>{row.employee_id || row.user_id}</td>
                    <td>{row.employee_name || '—'}</td>
                    <td>{parts.date}</td>
                    <td>{parts.time}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
