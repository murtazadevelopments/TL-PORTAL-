import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import '../admin/AdminDashboard.css';
import './SalesTargetsDashboard.css';
import { ProgressRing, formatAmount, formatPeriod, statusLabel } from './salesUi';

export default function SalesAgentDashboard() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [period, setPeriod] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const me = await api.get('/api/users/me');
        if (!active) return;
        if (!me.data?.id) {
          navigate('/', { replace: true });
          return;
        }
        if (!me.data.sales_agent_dashboard) {
          navigate('/dashboard', { replace: true });
          return;
        }
        const { data } = await api.get('/api/sales-targets/me');
        if (!active) return;
        setPeriod(data.period || '');
        setCurrent(data.current || null);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setChecking(false);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/', { replace: true });
          return;
        }
        setError(err.response?.data?.message || 'Could not load your sales target.');
        setChecking(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [navigate]);

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <p className="muted">Loading your target…</p>
      </div>
    );
  }

  const assigned = current?.target_amount != null && current.target_amount > 0;

  return (
    <div className="admin-page page-panel sales-dash">
      <div className="sales-dash-head">
        <div>
          <h1>My sales target</h1>
          <p className="muted" style={{ margin: 0 }}>
            {formatPeriod(period)} · your supervisor assigns the target and updates achieved sales.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {!assigned ? (
        <div className="sales-empty-hero">
          <h2>No target assigned yet</h2>
          <p className="muted">When your supervisor sets a target, your progress will appear here.</p>
        </div>
      ) : (
        <section className="sales-hero">
          <ProgressRing percent={current.percent || 0} size={160} label="complete" />
          <div>
            <p className="muted" style={{ margin: 0 }}>
              {current.name} · {current.employee_id || ''}
            </p>
            <h2>{statusLabel(current.status)}</h2>
            <div className="sales-hero-metrics">
              <p>
                <span>Target</span>
                <strong>{formatAmount(current.target_amount)}</strong>
              </p>
              <p>
                <span>Achieved</span>
                <strong>{formatAmount(current.achieved_amount)}</strong>
              </p>
              <p>
                <span>Remaining</span>
                <strong>{formatAmount(current.remaining)}</strong>
              </p>
            </div>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <>
          <h2>Recent months</h2>
          <div className="sales-history">
            {history.map((row) => (
              <div key={row.period} className="sales-history-row">
                <strong>{formatPeriod(row.period)}</strong>
                <span>{formatAmount(row.target_amount)}</span>
                <span>{formatAmount(row.achieved_amount)}</span>
                <span
                  className={`sales-status${
                    row.status === 'completed'
                      ? ' is-done'
                      : row.status === 'in_progress'
                        ? ' is-progress'
                        : ''
                  }`}
                >
                  {statusLabel(row.status)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
