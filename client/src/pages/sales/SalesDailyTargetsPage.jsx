import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import api from '../../api/client';
import { useAuthUser } from '../../context/AuthUserContext';
import { useRegisterSalesLeaveLock } from '../../context/SalesLeaveGuard';
import ConfirmPinModal from './ConfirmPinModal';
import { readStoredSalesPin, storeSalesPin } from './salesPinStorage';
import { showSuccess } from '../../utils/successPopup';
import '../admin/AdminDashboard.css';
import '../team-leader/TeamLeaderDashboard.css';
import './SalesTargetsDashboard.css';
import { formatAmount, formatPeriod, daysInPeriod } from './salesUi';

function formatDayDate(isoDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDay || ''))) return isoDay || '—';
  const d = new Date(`${isoDay}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

function dayStatusLabel(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'missed') return 'Not completed';
  if (status === 'today') return 'Today';
  return 'Upcoming';
}

function statusClass(status) {
  if (status === 'completed') return ' is-done';
  if (status === 'missed') return ' is-missed';
  if (status === 'today') return ' is-progress';
  return '';
}

export default function SalesDailyTargetsPage({ agentView = false }) {
  const navigate = useNavigate();
  const { agentId } = useParams();
  const [searchParams] = useSearchParams();
  const { logout } = useAuthUser();
  const [pin] = useState(() => (agentView ? '' : readStoredSalesPin()));
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(searchParams.get('period') || '');
  const [agent, setAgent] = useState(null);
  const [days, setDays] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [leavePrompt, setLeavePrompt] = useState(null);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinError, setPinError] = useState('');

  const { release } = useRegisterSalesLeaveLock(!agentView && Boolean(pin), (action) => {
    setLeavePrompt(action);
    setPinPrompt(true);
    setPinError('');
  });

  const load = useCallback(async () => {
    setError('');
    const month = searchParams.get('period') || period || undefined;
    if (agentView) {
      const { data } = await api.get('/api/sales-targets/me/days', {
        params: month ? { period: month } : undefined,
      });
      return data;
    }
    const { data } = await api.get(`/api/sales-targets/agents/${agentId}/days`, {
      params: month ? { period: month } : undefined,
      headers: { 'X-Sales-Pin': pin },
    });
    return data;
  }, [agentView, agentId, pin, period, searchParams]);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        if (!agentView && !pin) {
          navigate('/sales-targets', { replace: true });
          return;
        }
        const me = await api.get('/api/users/me');
        if (!active) return;
        if (agentView && !me.data?.sales_agent_dashboard) {
          navigate('/dashboard', { replace: true });
          return;
        }
        const data = await load();
        if (!active) return;
        setPeriod(data.period || '');
        setAgent(data.agent || null);
        const list = Array.isArray(data.days) ? data.days : [];
        setDays(list);
        setDrafts(
          Object.fromEntries(
            list.map((row) => [
              String(row.day),
              {
                target: row.target_amount == null ? '' : String(row.target_amount),
                achieved: row.achieved_amount == null ? '' : String(row.achieved_amount),
              },
            ])
          )
        );
        setChecking(false);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/', { replace: true });
          return;
        }
        if (!agentView && (err.response?.data?.code || '').startsWith('SALES_PIN')) {
          storeSalesPin('');
          navigate('/sales-targets', { replace: true });
          return;
        }
        setError(err.response?.data?.message || 'Could not load daily targets.');
        setChecking(false);
      }
    }
    start();
    return () => {
      active = false;
    };
  }, [agentView, load, navigate, pin]);

  const dirty = useMemo(() => {
    if (agentView) return false;
    return days.some((row) => {
      const draft = drafts[String(row.day)] || { target: '', achieved: '' };
      return (
        String(draft.target) !== String(row.target_amount ?? '') ||
        String(draft.achieved) !== String(row.achieved_amount ?? '')
      );
    });
  }, [agentView, days, drafts]);

  function finishLeave(action) {
    setLeavePrompt(null);
    setPinPrompt(false);
    setPinError('');
    release();
    storeSalesPin('');
    if (action?.type === 'logout') {
      logout();
      return;
    }
    navigate('/dashboard', { replace: true });
  }

  async function verifyLeavePin(value) {
    try {
      await api.get('/api/sales-targets', {
        params: period ? { period } : undefined,
        headers: { 'X-Sales-Pin': value },
        skipSuccessPopup: true,
      });
      return true;
    } catch (err) {
      setPinError(err.response?.data?.message || 'Invalid sales PIN.');
      return false;
    }
  }

  async function handleLeaveSave(value) {
    const pinOk = await verifyLeavePin(value);
    if (!pinOk) return;
    if (dirty) {
      const ok = await saveDays(true);
      if (!ok) return;
    }
    finishLeave(leavePrompt);
  }

  async function saveDays(silent = false) {
    setSaving(true);
    setError('');
    try {
      const payload = days.map((row) => {
        const draft = drafts[String(row.day)] || {};
        return {
          day: row.day,
          target_amount: draft.target,
          achieved_amount: draft.achieved,
        };
      });
      const { data } = await api.put(
        `/api/sales-targets/agents/${agentId}/days`,
        { period, days: payload },
        { headers: { 'X-Sales-Pin': pin } }
      );
      const list = Array.isArray(data.days) ? data.days : [];
      setDays(list);
      setAgent(data.agent || agent);
      setDrafts(
        Object.fromEntries(
          list.map((row) => [
            String(row.day),
            {
              target: row.target_amount == null ? '' : String(row.target_amount),
              achieved: row.achieved_amount == null ? '' : String(row.achieved_amount),
            },
          ])
        )
      );
      if (!silent) showSuccess('Daily targets saved.');
      return true;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save daily targets.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <p className="muted">Loading daily targets…</p>
      </div>
    );
  }

  const monthDays = daysInPeriod(period) || days.length;

  return (
    <div className="admin-page page-panel sales-dash">
      <div className="sales-dash-head">
        <div>
          <h1>{agentView ? 'My daily targets' : 'Daily targets'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {agent?.name || 'Sales agent'} · {formatPeriod(period)} · {monthDays} days
            {agentView
              ? ' · completed when achieved meets that day’s target'
              : ' · edit each day’s target and achieved amount'}
          </p>
        </div>
        <div className="sales-period-nav">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(agentView ? '/account/my-target' : '/sales-targets')}
          >
            Back
          </button>
          {!agentView ? (
            <button type="button" className="btn btn-primary" disabled={saving || !dirty} onClick={() => saveDays()}>
              {saving ? 'Saving…' : 'Save days'}
            </button>
          ) : null}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {!days.length ? (
        <div className="sales-empty-hero">
          <h2>No daily targets yet</h2>
          <p className="muted">Assign a monthly target first, then each day will appear here.</p>
        </div>
      ) : (
        <div className="sales-day-table-wrap">
          <table className="sales-day-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Target</th>
                {agentView ? <th>Achieved</th> : <th>Achieved</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {days.map((row) => {
                const draft = drafts[String(row.day)] || { target: '', achieved: '' };
                return (
                  <tr key={row.day} className={row.status === 'today' ? 'is-today' : ''}>
                    <td>
                      <strong>{formatDayDate(row.date)}</strong>
                    </td>
                    <td>
                      {agentView ? (
                        formatAmount(row.target_amount)
                      ) : (
                        <input
                          inputMode="decimal"
                          value={draft.target}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [String(row.day)]: { ...draft, target: e.target.value.replace(/[^\d.]/g, '') },
                            }))
                          }
                        />
                      )}
                    </td>
                    <td>
                      {agentView ? (
                        formatAmount(row.achieved_amount)
                      ) : (
                        <input
                          inputMode="decimal"
                          value={draft.achieved}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [String(row.day)]: { ...draft, achieved: e.target.value.replace(/[^\d.]/g, '') },
                            }))
                          }
                        />
                      )}
                    </td>
                    <td>
                      <span className={`sales-status${statusClass(row.status)}`}>{dayStatusLabel(row.status)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!agentView ? (
        <ConfirmPinModal
          open={Boolean(leavePrompt) && pinPrompt}
          title="Enter sales PIN to leave"
          description="You must enter your sales PIN to leave this page."
          busy={saving}
          confirmLabel="Leave"
          error={pinError}
          onCancel={() => {
            setLeavePrompt(null);
            setPinPrompt(false);
            setPinError('');
          }}
          onConfirm={handleLeaveSave}
        />
      ) : null}
    </div>
  );
}
