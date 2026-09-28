import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canManageSalesTargets, isCeo } from '../../utils/permissions';
import { describeEmployeeScope } from '../../utils/employeeScope';
import { showSuccess } from '../../utils/successPopup';
import { useAuthUser } from '../../context/AuthUserContext';
import { useRegisterSalesLeaveLock } from '../../context/SalesLeaveGuard';
import ConfirmPinModal from './ConfirmPinModal';
import { readStoredSalesPin, storeSalesPin } from './salesPinStorage';
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
  daysInPeriod,
  dailyTargetAmount,
} from './salesUi';

function normalizeAmount(value) {
  if (value == null || String(value).trim() === '') return '';
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? String(n) : String(value).trim();
}

function savedAmounts(agent) {
  return {
    target: agent?.target_amount == null ? '' : normalizeAmount(agent.target_amount),
    achieved: agent?.achieved_amount == null ? '' : normalizeAmount(agent.achieved_amount),
  };
}

function isAgentDirty(agent, draft) {
  if (!agent || !draft) return false;
  const saved = savedAmounts(agent);
  return (
    normalizeAmount(draft.target) !== saved.target ||
    normalizeAmount(draft.achieved) !== saved.achieved
  );
}

function PinGate({ configured, busy, error, onSetPin, onUnlock, onForgot }) {
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
          ? 'Unlock to view and edit targets. Changes stay on this page until you leave, then you confirm once with PIN to save them all.'
          : 'Create a 4–8 digit PIN. You will need it to open this dashboard. You confirm with PIN again only when you leave with unsaved changes.'}
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
        {configured && (
          <button type="button" className="btn btn-ghost" onClick={onForgot} disabled={busy}>
            Forgot or change PIN?
          </button>
        )}
      </form>
    </div>
  );
}

function RecoverPinPanel({ busy, error, onBusy, onError, onCancel, onDone }) {
  const [step, setStep] = useState('request');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [localError, setLocalError] = useState('');

  async function sendCode() {
    onBusy(true);
    onError('');
    setLocalError('');
    try {
      const { data } = await api.post('/api/sales-targets/pin/otp');
      setHint(data?.email_hint || 'your email');
      setStep('otp');
    } catch (err) {
      setLocalError(err.response?.data?.message || 'Could not send the code.');
    } finally {
      onBusy(false);
    }
  }

  async function verifyCode(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setLocalError('Enter the 6-digit code from your email.');
      return;
    }
    onBusy(true);
    onError('');
    setLocalError('');
    try {
      await api.post('/api/sales-targets/pin/otp/verify', { otp });
      setStep('pin');
    } catch (err) {
      setLocalError(err.response?.data?.message || 'That code is invalid or expired.');
    } finally {
      onBusy(false);
    }
  }

  async function savePin(e) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin)) {
      setLocalError('New PIN must be 4–8 digits.');
      return;
    }
    if (pin !== confirm) {
      setLocalError('PIN and confirmation do not match.');
      return;
    }
    onBusy(true);
    onError('');
    setLocalError('');
    try {
      await api.post('/api/sales-targets/pin', { sales_pin: pin });
      onDone(pin);
    } catch (err) {
      setLocalError(err.response?.data?.message || 'Could not save the new PIN.');
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="tl-setup-card sales-pin-card">
      <h2>
        {step === 'request' && 'Forgot or change sales PIN'}
        {step === 'otp' && 'Enter email code'}
        {step === 'pin' && 'Set a new sales PIN'}
      </h2>
      <p className="muted">
        {step === 'request' &&
          'We’ll email a 6-digit one-time code to the address on your profile. It is valid for 10 minutes.'}
        {step === 'otp' && `Enter the code sent to ${hint}. It expires in 10 minutes.`}
        {step === 'pin' && 'Code confirmed. Choose a new 4–8 digit sales PIN.'}
      </p>
      {step === 'request' && (
        <div className="form tl-setup-form">
          {(localError || error) && <p className="error">{localError || error}</p>}
          <div className="tl-modal-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={sendCode} disabled={busy}>
              {busy ? 'Sending…' : 'Email my code'}
            </button>
          </div>
        </div>
      )}
      {step === 'otp' && (
        <form className="form tl-setup-form" onSubmit={verifyCode}>
          <label>
            One-time code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
              autoFocus
            />
          </label>
          {(localError || error) && <p className="error">{localError || error}</p>}
          <div className="tl-modal-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-ghost" onClick={sendCode} disabled={busy}>
              Resend
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Checking…' : 'Verify code'}
            </button>
          </div>
        </form>
      )}
      {step === 'pin' && (
        <form className="form tl-setup-form" onSubmit={savePin}>
          <label>
            New sales PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={busy}
              autoFocus
            />
          </label>
          <label>
            Confirm new PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={busy}
            />
          </label>
          {(localError || error) && <p className="error">{localError || error}</p>}
          <div className="tl-modal-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save new PIN'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function SalesTargetsDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuthUser();
  const [checking, setChecking] = useState(true);
  const [ceo, setCeo] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [unlockedPin, setUnlockedPin] = useState(() => readStoredSalesPin());
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const [agents, setAgents] = useState([]);
  const [period, setPeriod] = useState('');
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [leavePrompt, setLeavePrompt] = useState(null);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [newOnly, setNewOnly] = useState(false);
  const { release } = useRegisterSalesLeaveLock(Boolean(unlockedPin), (action) => {
    if (action?.type === 'month') return;
    setLeavePrompt(action);
    setPinPrompt(true);
    setPinError('');
  });

  const currentKarachi = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
  }, []);

  const dirtyAgents = useMemo(
    () => agents.filter((row) => isAgentDirty(row, drafts[String(row.id)])),
    [agents, drafts]
  );
  const hasDirty = dirtyAgents.length > 0;

  const loadAgents = useCallback(async (pin, { month, silent, replaceDrafts } = {}) => {
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
          if (!replaceDrafts && isAgentDirty(row, next[key])) continue;
          next[key] = {
            target: row.target_amount == null ? '' : String(row.target_amount),
            achieved: row.achieved_amount == null ? '' : String(row.achieved_amount),
          };
        }
        return next;
      });
      if (pin) {
        setUnlockedPin(pin);
        storeSalesPin(pin);
      }
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'SALES_PIN_NOT_SET') {
        setPinConfigured(false);
        setUnlockedPin('');
        storeSalesPin('');
        setAgents([]);
      } else if (code === 'SALES_PIN_INVALID' || code === 'SALES_PIN_REQUIRED') {
        setUnlockedPin('');
        storeSalesPin('');
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
      } catch (err) {
        if (!active) return;
        const status = err.response?.status;
        const code = err.response?.data?.code;
        if (
          status === 401 ||
          code === 'ACCOUNT_BLOCKED' ||
          code === 'ACCOUNT_DEACTIVATED' ||
          code === 'ACCOUNT_LOCKED'
        ) {
          localStorage.removeItem('token');
          navigate('/', { replace: true });
          return;
        }
        setPinError(err.response?.data?.message || 'Could not load your account. Try again.');
        setChecking(false);
      }
    }
    verify();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (checking || !unlockedPin) return undefined;
    loadAgents(unlockedPin, { month: period || undefined });
    return undefined;
    // Load once after access check when a stored PIN is present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);

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

  function finishLeave(action) {
    setLeavePrompt(null);
    setPinPrompt(false);
    setPinError('');
    if (action?.type === 'lock') {
      lockDashboard();
      return;
    }
    if (action?.type === 'month') {
      loadAgents(unlockedPin, { month: action.month, replaceDrafts: true });
      return;
    }
    release();
    if (action?.type === 'logout') {
      storeSalesPin('');
      logout();
      return;
    }
    lockDashboard();
    navigate('/dashboard', { replace: true });
  }

  function lockDashboard() {
    setUnlockedPin('');
    storeSalesPin('');
    setAgents([]);
    setPeriod('');
    setScope(null);
    setError('');
    setPinError('');
    setDrafts({});
    setQuery('');
    setTeamFilter('all');
    setStatusFilter('all');
    setNewOnly(false);
    setLeavePrompt(null);
    setPinPrompt(false);
    setRecoverOpen(false);
  }

  function askToLeave(action) {
    if (action?.type === 'month') {
      finishLeave(action);
      return;
    }
    setLeavePrompt(action);
    setPinPrompt(true);
    setPinError('');
  }

  function goMonth(delta) {
    if (!period) return;
    const next = shiftPeriod(period, delta);
    if (delta > 0 && next > currentKarachi) return;
    loadAgents(unlockedPin, { month: next, replaceDrafts: true });
  }

  async function saveAgent(payload, pin) {
    setSavingId(payload.id);
    setError('');
    setPinError('');
    try {
      const body = { period };
      if (payload.mode === 'target' || payload.mode === 'both') {
        body.target_amount = payload.target_amount;
      }
      if (payload.mode === 'achieved' || payload.mode === 'both') {
        body.achieved_amount = payload.achieved_amount;
      }
      const { data } = await api.put(`/api/sales-targets/agents/${payload.id}`, body, {
        headers: pin ? { 'X-Sales-Pin': pin } : {},
        skipSuccessPopup: payload.silent,
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
      return { ok: true, message: data?.message || 'Saved.' };
    } catch (err) {
      const code = err.response?.data?.code;
      const message = err.response?.data?.message || 'Could not save.';
      if (code === 'SALES_PIN_INVALID' || code === 'SALES_PIN_REQUIRED') {
        setPinError(message);
        return { ok: false, pin: true, message };
      }
      return { ok: false, message };
    } finally {
      setSavingId(null);
    }
  }

  async function requestSave(agent, mode) {
    const draft = drafts[String(agent.id)] || {};
    if (mode === 'target' || mode === 'both') {
      if (!String(draft.target || '').trim()) {
        setError('Enter a target amount first.');
        return;
      }
    }
    if (mode === 'achieved' && !agent.target_amount && !String(draft.target || '').trim()) {
      setError('Assign a target before logging achieved sales.');
      return;
    }
    const targetDirty = normalizeAmount(draft.target) !== savedAmounts(agent).target;
    const achievedDirty = normalizeAmount(draft.achieved) !== savedAmounts(agent).achieved;
    const nextMode =
      targetDirty && achievedDirty ? 'both' : mode === 'target' && targetDirty ? 'target' : mode;
    const result = await saveAgent(
      {
        id: agent.id,
        mode: nextMode,
        target_amount: draft.target,
        achieved_amount: draft.achieved,
      },
      unlockedPin
    );
    if (result.ok) {
      return;
    }
    if (result.pin) {
      setUnlockedPin('');
      setAgents([]);
      setPinError(result.message || 'Enter your sales PIN again.');
      return;
    }
    setError(result.message);
  }

  async function requestReset(agent) {
    const draft = drafts[String(agent.id)] || {};
    const hasSaved = Boolean(agent.target_amount) || Number(agent.achieved_amount) > 0;
    const dirty = isAgentDirty(agent, draft);
    if (!hasSaved && !dirty) return;

    if (!hasSaved && dirty) {
      setDrafts((prev) => ({
        ...prev,
        [String(agent.id)]: { target: '', achieved: '' },
      }));
      showSuccess(`Reset ${agent.name || agent.employee_id || 'agent'} on this page.`);
      return;
    }

    setSavingId(agent.id);
    setError('');
    try {
      const { data } = await api.delete(`/api/sales-targets/agents/${agent.id}`, {
        params: { period },
        headers: unlockedPin ? { 'X-Sales-Pin': unlockedPin } : {},
      });
      const nextAgent = data?.agent
        ? { ...agent, ...data.agent, created_at: agent.created_at }
        : {
            ...agent,
            target_amount: null,
            achieved_amount: 0,
            percent: 0,
            remaining: null,
            status: 'not_set',
          };
      setAgents((prev) => prev.map((row) => (row.id === agent.id ? nextAgent : row)));
      setDrafts((prev) => ({
        ...prev,
        [String(agent.id)]: { target: '', achieved: '' },
      }));
    } catch (err) {
      const code = err.response?.data?.code;
      const message = err.response?.data?.message || 'Could not reset.';
      if (code === 'SALES_PIN_INVALID' || code === 'SALES_PIN_REQUIRED') {
        setUnlockedPin('');
        setAgents([]);
        setPinError(message);
      } else {
        setError(message);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function flushDirty(pin) {
    const items = agents.filter((row) => isAgentDirty(row, drafts[String(row.id)]));
    if (!items.length) return { ok: true };
    for (const agent of items) {
      const draft = drafts[String(agent.id)] || {};
      const saved = savedAmounts(agent);
      const targetChanged = normalizeAmount(draft.target) !== saved.target;
      const achievedChanged = normalizeAmount(draft.achieved) !== saved.achieved;
      if (targetChanged && !String(draft.target || '').trim()) {
        setError(`Enter a target amount for ${agent.name || agent.employee_id || 'this agent'} first.`);
        return { ok: false };
      }
      if (achievedChanged && !targetChanged && !agent.target_amount && !String(draft.target || '').trim()) {
        setError(`Assign a target for ${agent.name || agent.employee_id || 'this agent'} before logging achieved sales.`);
        return { ok: false };
      }
      const payload = {
        id: agent.id,
        mode: targetChanged && achievedChanged ? 'both' : targetChanged ? 'target' : 'achieved',
        target_amount: draft.target,
        achieved_amount: draft.achieved,
        silent: true,
      };
      const result = await saveAgent(payload, pin);
      if (!result.ok) {
        if (!result.pin) setError(result.message);
        return result;
      }
    }
    showSuccess('All changes saved.');
    return { ok: true };
  }

  useEffect(() => {
    if (!unlockedPin) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unlockedPin]);

  async function verifyLeavePin(pin) {
    try {
      await api.get('/api/sales-targets', {
        params: period ? { period } : undefined,
        headers: { 'X-Sales-Pin': pin },
        skipSuccessPopup: true,
      });
      return { ok: true };
    } catch (err) {
      const message = err.response?.data?.message || 'Invalid sales PIN.';
      setPinError(message);
      return { ok: false, pin: true, message };
    }
  }

  async function handleLeaveSave(pin) {
    if (hasDirty) {
      const result = await flushDirty(pin);
      if (!result.ok) return;
    } else {
      const result = await verifyLeavePin(pin);
      if (!result.ok) return;
    }
    finishLeave(leavePrompt);
  }

  function handleLeaveStay() {
    setLeavePrompt(null);
    setPinPrompt(false);
    setPinError('');
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
            Amounts are in USD. Enter your sales PIN to open this board. You must enter the PIN again to leave.
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
            <button type="button" className="btn btn-ghost" onClick={() => setRecoverOpen(true)}>
              Change PIN
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => askToLeave({ type: 'lock' })}>
              Lock
            </button>
          </div>
        )}
      </div>

      {recoverOpen ? (
        <RecoverPinPanel
          key="sales-pin-recover"
          busy={pinBusy}
          error={pinError}
          onBusy={setPinBusy}
          onError={setPinError}
          onCancel={() => {
            setRecoverOpen(false);
            setPinError('');
          }}
          onDone={async (pin) => {
            setRecoverOpen(false);
            setPinConfigured(true);
            setPinError('');
            await loadAgents(pin);
          }}
        />
      ) : locked ? (
        <PinGate
          configured={pinConfigured}
          busy={pinBusy || loading}
          error={pinError}
          onSetPin={handleSetPin}
          onUnlock={handleUnlock}
          onForgot={() => {
            setRecoverOpen(true);
            setPinError('');
          }}
        />
      ) : (
        <>
          <p className="muted">{scope ? describeEmployeeScope(scope) : 'Assigned teams only'}</p>
          {error && <p className="error">{error}</p>}
          {hasDirty && (
            <p className="muted">Unsaved changes on this page. You’ll be asked to save (with PIN) if you leave.</p>
          )}

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
              <span>Per day</span>
              <strong>
                {formatAmount(dailyTargetAmount(visibleSummary.target_total || 0, period) || 0)}
              </strong>
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
                const draftTarget = Number(String(draft.target || '').replace(/,/g, ''));
                const dayTarget = dailyTargetAmount(
                  Number.isFinite(draftTarget) && draftTarget > 0 ? draftTarget : row.target_amount,
                  period
                );
                const monthDays = daysInPeriod(period);
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
                        {dayTarget != null ? (
                          <em className="sales-daily-hint">
                            {formatAmount(dayTarget)} per day · {monthDays} days in {formatPeriod(period)}
                          </em>
                        ) : null}
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
                          placeholder={
                            hasTarget || String(draft.target || '').trim()
                              ? 'Update when they close sales'
                              : 'Assign a target first'
                          }
                          disabled={!hasTarget && !String(draft.target || '').trim()}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={!hasTarget}
                          onClick={() =>
                            navigate(
                              `/sales-targets/${row.id}?period=${encodeURIComponent(period)}`
                            )
                          }
                        >
                          View more
                        </button>
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
                          disabled={savingId === row.id || (!hasTarget && !String(draft.target || '').trim())}
                        >
                          {savingId === row.id ? 'Saving…' : 'Save achieved'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={
                            savingId === row.id ||
                            (!hasTarget &&
                              !(Number(row.achieved_amount) > 0) &&
                              !isAgentDirty(row, draft))
                          }
                          onClick={() => requestReset(row)}
                        >
                          Reset
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
        open={Boolean(leavePrompt) && pinPrompt}
        title="Enter sales PIN to leave"
        description={
          hasDirty
            ? 'Enter your PIN to save remaining changes and leave this page.'
            : 'You must enter your sales PIN to leave this page.'
        }
        busy={Boolean(savingId) || pinBusy}
        confirmLabel="Leave"
        error={pinError}
        onCancel={handleLeaveStay}
        onConfirm={handleLeaveSave}
      />
    </div>
  );
}
