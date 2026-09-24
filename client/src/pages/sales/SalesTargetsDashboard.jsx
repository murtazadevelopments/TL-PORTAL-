import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canManageSalesTargets, isCeo } from '../../utils/permissions';
import { describeEmployeeScope } from '../../utils/employeeScope';
import '../admin/AdminDashboard.css';
import '../team-leader/TeamLeaderDashboard.css';
import './SalesTargetsDashboard.css';
import {
  ProgressRing,
  formatAmount,
  formatPeriod,
  shiftPeriod,
  statusLabel,
  isRecentlyAdded,
  summarizeAgents,
} from './salesUi';

function PinGate({ configured, busy, error, onSetPin, onUnlock }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setPassword('');
    setPin('');
    setConfirm('');
    setLocalError('');
  }, [configured]);

  function submit(e) {
    e.preventDefault();
    setLocalError('');
    if (!/^\d{4,8}$/.test(pin)) {
      setLocalError('PIN must be 4–8 digits.');
      return;
    }
    if (!configured) {
      if (pin !== confirm) {
        setLocalError('PIN and confirmation do not match.');
        return;
      }
      if (!password) {
        setLocalError('Enter your account password to create this PIN.');
        return;
      }
      onSetPin({ password, pin });
      return;
    }
    onUnlock(pin);
  }

  return (
    <div className="tl-setup-card sales-pin-card">
      <h2>{configured ? 'Enter sales PIN' : 'Create your sales PIN'}</h2>
      <p className="muted">
        {configured
          ? 'Unlock to assign targets and log achieved sales. Nothing is shown until the PIN is entered.'
          : 'Create a 4–8 digit PIN. You will need it to open this dashboard and to save changes.'}
      </p>
      <form className="form tl-setup-form" onSubmit={submit}>
        {!configured && (
          <label>
            Account password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
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
        {!configured && (
          <label>
            Confirm PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={busy}
            />
          </label>
        )}
        {(localError || error) && <p className="error">{localError || error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : configured ? 'Unlock dashboard' : 'Save PIN and continue'}
        </button>
      </form>
    </div>
  );
}

function ConfirmPinModal({ open, title, busy, error, onCancel, onConfirm }) {
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
        <p className="muted">This change is confidential. Enter your PIN to save.</p>
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
              {busy ? 'Saving…' : 'Confirm & save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SalesTargetsDashboard() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ceo, setCeo] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [unlockedPin, setUnlockedPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const [agents, setAgents] = useState([]);
  const [period, setPeriod] = useState('');
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [pendingSave, setPendingSave] = useState(null);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [newOnly, setNewOnly] = useState(false);

  const currentKarachi = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
  }, []);

  const loadAgents = useCallback(async (pin, { ceoView, month, silent } = {}) => {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const { data } = await api.get('/api/sales-targets', {
        params: month ? { period: month } : undefined,
        headers: pin ? { 'X-Sales-Pin': pin } : {},
      });
      const list = Array.isArray(data?.agents) ? data.agents : [];
      setAgents(list);
      setPeriod(data?.period || '');
      setScope(data?.scope || null);
      setDrafts((prev) => {
        const next = { ...prev };
        const ids = new Set(list.map((row) => String(row.id)));
        for (const key of Object.keys(next)) {
          if (!ids.has(String(key))) delete next[key];
        }
        for (const row of list) {
          const key = String(row.id);
          if (next[key]) continue;
          next[key] = {
            target: row.target_amount == null ? '' : String(row.target_amount),
            achieved: row.achieved_amount == null ? '' : String(row.achieved_amount),
          };
        }
        return next;
      });
      if (pin) setUnlockedPin(pin);
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'SALES_PIN_NOT_SET') {
        setPinConfigured(false);
        setUnlockedPin('');
        setAgents([]);
      } else if (code === 'SALES_PIN_INVALID' || code === 'SALES_PIN_REQUIRED') {
        setUnlockedPin('');
        setAgents([]);
        setPinError(err.response?.data?.message || 'Invalid sales PIN.');
      } else if (!silent) {
        setError(err.response?.data?.message || 'Failed to load sales targets.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!canManageSalesTargets(data.role, data.permissions)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setCeo(isCeo(data.role));
        setPinConfigured(Boolean(data.sales_pin_configured));
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
    if (!unlockedPin) return undefined;
    const timer = setInterval(() => {
      loadAgents(unlockedPin, { month: period || undefined, silent: true });
    }, 20000);
    return () => clearInterval(timer);
  }, [checking, unlockedPin, period, loadAgents]);

  async function handleSetPin({ password, pin }) {
    setPinBusy(true);
    setPinError('');
    try {
      await api.post('/api/sales-targets/pin', {
        sales_pin: pin,
        current_password: password,
      });
      setPinConfigured(true);
      await loadAgents(pin);
    } catch (err) {
      setPinError(err.response?.data?.message || 'Could not save sales PIN.');
    } finally {
      setPinBusy(false);
    }
  }

  async function handleUnlock(pin) {
    setPinBusy(true);
    setPinError('');
    await loadAgents(pin);
    setPinBusy(false);
  }

  function lockDashboard() {
    setUnlockedPin('');
    setAgents([]);
    setPeriod('');
    setScope(null);
    setError('');
    setSuccess('');
    setPinError('');
    setDrafts({});
    setQuery('');
    setTeamFilter('all');
    setStatusFilter('all');
    setNewOnly(false);
  }

  function goMonth(delta) {
    if (!period) return;
    const next = shiftPeriod(period, delta);
    if (delta > 0 && next > currentKarachi) return;
    loadAgents(unlockedPin, { month: next });
  }

  function requestSave(agent, mode) {
    const draft = drafts[String(agent.id)] || {};
    if (mode === 'target') {
      if (!String(draft.target || '').trim()) {
        setError('Enter a target amount first.');
        return;
      }
    } else if (!agent.target_amount) {
      setError('Assign a target before logging achieved sales.');
      return;
    }
    const payload = {
      id: agent.id,
      mode,
      target_amount: draft.target,
      achieved_amount: draft.achieved,
    };
    setPendingSave(payload);
  }

  async function saveAgent(payload, pin) {
    setSavingId(payload.id);
    setError('');
    setSuccess('');
    setPinError('');
    try {
      const body = { period };
      if (payload.mode === 'target') body.target_amount = payload.target_amount;
      if (payload.mode === 'achieved') body.achieved_amount = payload.achieved_amount;
      const { data } = await api.put(`/api/sales-targets/agents/${payload.id}`, body, {
        headers: pin ? { 'X-Sales-Pin': pin } : {},
      });
      if (data?.agent) {
        setAgents((prev) => prev.map((row) => (row.id === data.agent.id ? data.agent : row)));
        setDrafts((prev) => ({
          ...prev,
          [String(data.agent.id)]: {
            target: data.agent.target_amount == null ? '' : String(data.agent.target_amount),
            achieved: data.agent.achieved_amount == null ? '' : String(data.agent.achieved_amount),
          },
        }));
      }
      setSuccess(data?.message || 'Saved.');
      setPendingSave(null);
      if (pin || unlockedPin) {
        loadAgents(pin || unlockedPin, { month: period, silent: true });
      }
    } catch (err) {
      const code = err.response?.data?.code;
      const message = err.response?.data?.message || 'Could not save.';
      if (code === 'SALES_PIN_INVALID' || code === 'SALES_PIN_REQUIRED') {
        setPinError(message);
      } else {
        setError(message);
        setPendingSave(null);
      }
    } finally {
      setSavingId(null);
    }
  }

  const teamOptions = useMemo(
    () =>
      [...new Set(agents.map((row) => String(row.department || '').trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [agents]
  );

  const visibleAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((row) => {
      if (teamFilter !== 'all' && String(row.department || '').trim() !== teamFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (newOnly && !isRecentlyAdded(row.created_at)) return false;
      if (!q) return true;
      const hay = `${row.name || ''} ${row.employee_id || ''} ${row.designation || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [agents, query, teamFilter, statusFilter, newOnly]);

  const visibleSummary = useMemo(() => summarizeAgents(visibleAgents), [visibleAgents]);

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <p className="muted">Checking access…</p>
      </div>
    );
  }

  const locked = !unlockedPin;

  return (
    <div className="admin-page page-panel sales-dash">
      <div className="sales-dash-head">
        <div>
          <h1>{ceo ? 'Sales overview' : 'Sales supervisor'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Amounts are in USD. Enter your sales PIN to open this board and to save changes.
          </p>
        </div>
        {!locked && (
          <div className="sales-period-nav">
            <button type="button" className="btn btn-ghost" onClick={() => goMonth(-1)} disabled={loading}>
              Previous
            </button>
            <span className="sales-period-label">{formatPeriod(period)}</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => goMonth(1)}
              disabled={loading || period >= currentKarachi}
            >
              Next
            </button>
            <button type="button" className="btn btn-ghost" onClick={lockDashboard}>
              Lock
            </button>
          </div>
        )}
      </div>

      {locked ? (
        <PinGate
          configured={pinConfigured}
          busy={pinBusy || loading}
          error={pinError}
          onSetPin={handleSetPin}
          onUnlock={handleUnlock}
        />
      ) : (
        <>
          <p className="muted">{scope ? describeEmployeeScope(scope) : 'Assigned teams only'}</p>
          {error && <p className="error">{error}</p>}
          {success && <p className="success">{success}</p>}

          <div className="sales-filters">
            <input
              className="admin-search"
              type="search"
              placeholder="Search name or employee ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              Team
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="all">All assigned teams</option>
                {teamOptions.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="not_set">No target</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label className="sales-filter-check">
              <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
              New only
            </label>
          </div>

          <div className="sales-kpi-grid">
            <div className="sales-kpi">
              <span>Team target</span>
              <strong>{formatAmount(visibleSummary.target_total || 0)}</strong>
            </div>
            <div className="sales-kpi">
              <span>Achieved</span>
              <strong>{formatAmount(visibleSummary.achieved_total || 0)}</strong>
            </div>
            <div className="sales-kpi">
              <span>Remaining</span>
              <strong>{formatAmount(visibleSummary.remaining_total || 0)}</strong>
            </div>
            <div className="sales-kpi">
              <span>Completed</span>
              <strong>
                {visibleSummary.completed_count || 0}/{visibleSummary.assigned_count || 0}
              </strong>
            </div>
          </div>

          {loading && <p className="muted">Refreshing…</p>}
          {agents.length === 0 && !loading ? (
            <div className="admin-empty">No sales executives or team leaders in your assigned teams.</div>
          ) : visibleAgents.length === 0 && !loading ? (
            <div className="admin-empty">No agents match these filters.</div>
          ) : (
            <div className="sales-agent-grid">
              {visibleAgents.map((row) => {
                const draft = drafts[String(row.id)] || { target: '', achieved: '' };
                const hasTarget = Boolean(row.target_amount);
                return (
                  <article
                    key={row.id}
                    className={`sales-agent-card${row.status === 'completed' ? ' is-done' : ''}`}
                  >
                    <div className="sales-agent-top">
                      <ProgressRing percent={row.percent || 0} size={96} label="done" />
                      <div className="sales-agent-copy">
                        <h3>
                          {row.name || '—'}
                          {isRecentlyAdded(row.created_at) ? (
                            <span className="sales-status is-new">New</span>
                          ) : null}
                        </h3>
                        <p className="muted">
                          {row.employee_id || 'No ID'} · {row.department || 'No team'}
                        </p>
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
                    </div>
                    <form
                      className="sales-agent-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        requestSave(row, hasTarget ? 'achieved' : 'target');
                      }}
                    >
                      <label>
                        Assigned target (USD)
                        <input
                          inputMode="decimal"
                          value={draft.target}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [String(row.id)]: { ...draft, target: e.target.value.replace(/[^\d.]/g, '') },
                            }))
                          }
                          placeholder="Set target first"
                        />
                      </label>
                      <label>
                        Achieved (USD)
                        <input
                          inputMode="decimal"
                          value={draft.achieved}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [String(row.id)]: { ...draft, achieved: e.target.value.replace(/[^\d.]/g, '') },
                            }))
                          }
                          placeholder={hasTarget ? 'Update when they close sales' : 'Assign a target first'}
                          disabled={!hasTarget}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={savingId === row.id}
                          onClick={() => requestSave(row, 'target')}
                        >
                          {hasTarget ? 'Update target' : 'Assign target'}
                        </button>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          disabled={savingId === row.id || !hasTarget}
                        >
                          {savingId === row.id ? 'Saving…' : 'Save achieved'}
                        </button>
                      </div>
                    </form>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      <ConfirmPinModal
        open={Boolean(pendingSave)}
        busy={Boolean(savingId)}
        error={pinError}
        onCancel={() => {
          setPendingSave(null);
          setPinError('');
        }}
        onConfirm={(pin) => pendingSave && saveAgent(pendingSave, pin)}
      />
    </div>
  );
}
