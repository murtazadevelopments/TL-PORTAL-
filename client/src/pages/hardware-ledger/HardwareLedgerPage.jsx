import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import api from '../../api/client';
import { useFlashSuccess } from '../../utils/successPopup';
import {
  STATEMENT_MODES,
  currentMonthKey,
  defaultStatementRange,
  formatDate,
  formatMoney,
  formatTime,
  statementInputType,
  useHardwareLedgerGuard,
} from './hardwareLedgerUtils';
import RemoveVendorModal from './RemoveVendorModal';
import '../petty-cash/PettyCashDashboard.css';
import './HardwareLedger.css';

const KIND_LABELS = { total: 'Item', paid: 'Paid amount' };

function HardwareLedgerDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState({
    total_amount: 0,
    paid_amount: 0,
    month_pending_amount: 0,
    prior_pending_amount: 0,
    pending_amount: 0,
  });
  const [canRemoveVendors, setCanRemoveVendors] = useState(false);
  const [month, setMonth] = useState(currentMonthKey);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [vendorName, setVendorName] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [removingId, setRemovingId] = useState(null);
  const [statementMode, setStatementMode] = useState('month');
  const [statementFrom, setStatementFrom] = useState(() => defaultStatementRange('month').from);
  const [statementTo, setStatementTo] = useState(() => defaultStatementRange('month').to);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState('');
  const [statement, setStatement] = useState(null);
  useFlashSuccess(success);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/hardware-ledger/vendors', { params: { month } });
      setVendors(Array.isArray(data.vendors) ? data.vendors : []);
      setSummary(
        data.summary || {
          total_amount: 0,
          paid_amount: 0,
          month_pending_amount: 0,
          prior_pending_amount: 0,
          pending_amount: 0,
        }
      );
      setCanRemoveVendors(Boolean(data.can_remove_vendors));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load vendors.');
      setVendors([]);
      setCanRemoveVendors(false);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setVendorName('');
    setAddError('');
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
    setAddError('');
  }

  async function handleAddVendor(e) {
    e.preventDefault();
    const name = vendorName.trim();
    if (!name) {
      setAddError('Vendor name is required.');
      return;
    }
    setSaving(true);
    setAddError('');
    setSuccess('');
    try {
      await api.post('/api/hardware-ledger/vendors', { name });
      setSuccess('Vendor added.');
      setAdding(false);
      await load();
    } catch (err) {
      setAddError(err.response?.data?.message || 'Could not add vendor.');
    } finally {
      setSaving(false);
    }
  }

  function openRemoveVendor(vendor) {
    if (!canRemoveVendors || !vendor?.id) return;
    setRemoveError('');
    setRemoveTarget(vendor);
  }

  function closeRemoveVendor() {
    if (removingId) return;
    setRemoveTarget(null);
    setRemoveError('');
  }

  async function confirmRemoveVendor(password) {
    if (!canRemoveVendors || !removeTarget?.id) return;
    setRemovingId(removeTarget.id);
    setRemoveError('');
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/hardware-ledger/vendors/${removeTarget.id}`, {
        data: { password },
      });
      setSuccess(data.message || 'Vendor removed.');
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setRemoveError(err.response?.data?.message || 'Could not remove vendor.');
    } finally {
      setRemovingId(null);
    }
  }

  const query = search.trim().toLowerCase();
  const visible = query
    ? vendors.filter((v) => v.name.toLowerCase().includes(query))
    : vendors;

  const statementFromType = useMemo(
    () => statementInputType(statementMode),
    [statementMode]
  );

  function changeStatementMode(nextMode) {
    const range = defaultStatementRange(nextMode, month);
    setStatementMode(nextMode);
    setStatementFrom(range.from);
    setStatementTo(range.to);
    setStatement(null);
    setStatementError('');
  }

  async function handleGenerateStatement(e) {
    e?.preventDefault?.();
    setStatementLoading(true);
    setStatementError('');
    try {
      const { data } = await api.get('/api/hardware-ledger/statement', {
        params: {
          mode: statementMode,
          from: statementFrom,
          to: statementTo,
        },
      });
      setStatement(data);
    } catch (err) {
      setStatement(null);
      setStatementError(err.response?.data?.message || 'Failed to generate statement.');
    } finally {
      setStatementLoading(false);
    }
  }

  function printStatement() {
    window.print();
  }

  return (
    <div className="petty-page">
      <h1>Hardware Ledger</h1>
      <p className="petty-sub">
        Vendors and their amounts for the selected month. Unpaid balances from earlier months are
        included in overall pending.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="petty-toolbar">
        <label className="petty-month">
          <span>Month</span>
          <input
            type="month"
            className="hw-month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonthKey())}
            disabled={loading}
          />
        </label>
        <p className="petty-formula">
          Overall pending = whole amount still owed through this month (all unpaid totals)
        </p>
      </div>

      <div className="petty-tabs" aria-label="All vendors amounts">
        <div className="petty-tab active">
          <span className="petty-tab-label">Overall pending</span>
          <span className="petty-tab-amount">{formatMoney(Math.max(0, summary.pending_amount))}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Prior pending</span>
          <span className="petty-tab-amount">
            {formatMoney(summary.prior_pending_amount || 0)}
          </span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">This month pending</span>
          <span className="petty-tab-amount">
            {formatMoney(summary.month_pending_amount ?? summary.pending_amount)}
          </span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Total Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.total_amount)}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Paid Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.paid_amount)}</span>
        </div>
      </div>

      <div className="petty-toolbar">
        <input
          type="search"
          className="hw-search"
          placeholder="Search vendor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={openAdd}>
          + Add new vendor
        </button>
      </div>

      {loading ? (
        <p className="petty-empty">Loading…</p>
      ) : vendors.length === 0 ? (
        <p className="petty-empty">No vendors yet. Click “Add new vendor” to create one.</p>
      ) : visible.length === 0 ? (
        <p className="petty-empty">No vendor matches “{search}”.</p>
      ) : (
        <div className="petty-holders">
          {visible.map((v) => (
            <div key={v.id} className="hw-vendor-row">
              <Link to={`/hardware-ledger/${v.id}`} className="petty-holder-card">
                <div>
                  <div className="petty-holder-name">{v.name}</div>
                  <div className="petty-holder-meta">
                    Total {formatMoney(v.total_amount)} · Paid {formatMoney(v.paid_amount)}
                    {v.prior_pending_amount > 0
                      ? ` · Prior ${formatMoney(v.prior_pending_amount)}`
                      : ''}
                  </div>
                </div>
                <div className="hw-pending">
                  <span className="hw-pending-label">Overall pending</span>
                  <span
                    className={
                      v.pending_amount > 0 ? 'petty-holder-balance hw-due' : 'petty-holder-balance'
                    }
                  >
                    {formatMoney(v.pending_amount)}
                  </span>
                </div>
              </Link>
              {canRemoveVendors ? (
                <button
                  type="button"
                  className="btn btn-ghost hw-remove-vendor"
                  disabled={Boolean(removingId)}
                  onClick={() => openRemoveVendor(v)}
                >
                  Remove vendor
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {adding && typeof document !== 'undefined'
        ? createPortal(
            <div className="petty-modal-backdrop" onClick={closeAdd} role="presentation">
              <form
                className="petty-modal"
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleAddVendor}
                role="dialog"
                aria-modal="true"
                aria-labelledby="hw-add-vendor-title"
              >
                <div className="petty-modal-header">
                  <h2 id="hw-add-vendor-title">Add new vendor</h2>
                  <button type="button" className="btn btn-ghost" onClick={closeAdd}>
                    Close
                  </button>
                </div>
                {addError ? <p className="error">{addError}</p> : null}
                <div className="petty-form petty-form-modal">
                  <label className="full">
                    Vendor name *
                    <input
                      type="text"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      maxLength={160}
                      placeholder="Enter vendor name"
                      required
                      autoFocus
                    />
                  </label>
                  <div className="petty-form-actions">
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : 'Add vendor'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={closeAdd}>
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            </div>,
            document.body
          )
        : null}

      <section className="hw-statement-section">
        <h2 className="petty-section-title">Statement</h2>
        <p className="petty-sub">
          Filter month-to-month, year-to-year, or date-to-date and generate a complete statement for
          all vendors.
        </p>
        <form className="hw-statement-form" onSubmit={handleGenerateStatement}>
          <label>
            Range type
            <select
              className="hw-filter"
              value={statementMode}
              onChange={(e) => changeStatementMode(e.target.value)}
            >
              {STATEMENT_MODES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type={statementFromType}
              className="hw-month"
              value={statementFrom}
              onChange={(e) => setStatementFrom(e.target.value)}
              min={statementMode === 'year' ? '2000' : undefined}
              max={statementMode === 'year' ? '2100' : undefined}
              required
            />
          </label>
          <label>
            To
            <input
              type={statementFromType}
              className="hw-month"
              value={statementTo}
              onChange={(e) => setStatementTo(e.target.value)}
              min={statementMode === 'year' ? '2000' : undefined}
              max={statementMode === 'year' ? '2100' : undefined}
              required
            />
          </label>
          <div className="petty-form-actions">
            <button type="submit" className="btn btn-primary" disabled={statementLoading}>
              {statementLoading ? 'Generating…' : 'Generate statement'}
            </button>
            {statement ? (
              <button type="button" className="btn btn-ghost" onClick={printStatement}>
                Print / save PDF
              </button>
            ) : null}
          </div>
        </form>
        {statementError ? <p className="error">{statementError}</p> : null}

        {statement ? (
          <div className="hw-statement-print" id="hw-ledger-statement-print">
            <div className="hw-statement-head">
              <h3>Hardware Ledger — all vendors</h3>
              <p className="petty-sub">
                {statement.range_label}
                {statement.generated_at
                  ? ` · Generated ${formatDate(statement.generated_at)} ${formatTime(statement.generated_at)}`
                  : ''}
              </p>
            </div>

            <div className="petty-tabs" aria-label="Statement totals">
              <div className="petty-tab">
                <span className="petty-tab-label">Opening prior pending</span>
                <span className="petty-tab-amount">
                  {formatMoney(statement.summary?.prior_pending_amount)}
                </span>
              </div>
              <div className="petty-tab">
                <span className="petty-tab-label">Range total</span>
                <span className="petty-tab-amount">
                  {formatMoney(statement.summary?.total_amount)}
                </span>
              </div>
              <div className="petty-tab">
                <span className="petty-tab-label">Range paid</span>
                <span className="petty-tab-amount">
                  {formatMoney(statement.summary?.paid_amount)}
                </span>
              </div>
              <div className="petty-tab active">
                <span className="petty-tab-label">Closing pending</span>
                <span className="petty-tab-amount">
                  {formatMoney(statement.summary?.pending_amount)}
                </span>
              </div>
            </div>

            <div className="petty-table-wrap">
              <table className="petty-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Prior pending</th>
                    <th>Overall pending</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(statement.vendors || []).length === 0 ? (
                    <tr>
                      <td colSpan={6}>No vendors in this range.</td>
                    </tr>
                  ) : (
                    statement.vendors.map((v) => (
                      <tr key={v.id}>
                        <td>{v.name}</td>
                        <td>{formatMoney(v.total_amount)}</td>
                        <td>{formatMoney(v.paid_amount)}</td>
                        <td>{formatMoney(v.prior_pending_amount)}</td>
                        <td>{formatMoney(v.pending_amount)}</td>
                        <td>{v.status || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {Array.isArray(statement.months) && statement.months.length > 0 ? (
              <div className="petty-table-wrap" style={{ marginTop: '1rem' }}>
                <table className="petty-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Total</th>
                      <th>Paid</th>
                      <th>Pending</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.months.map((m) => (
                      <tr key={m.month}>
                        <td>{m.month_label}</td>
                        <td>{formatMoney(m.total_amount)}</td>
                        <td>{formatMoney(m.paid_amount)}</td>
                        <td>{formatMoney(m.pending_amount)}</td>
                        <td>{m.status || 'Settled for this month'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="petty-table-wrap" style={{ marginTop: '1rem' }}>
              <table className="petty-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Vendor</th>
                    <th>Type</th>
                    <th>Item</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(statement.records || []).length === 0 ? (
                    <tr>
                      <td colSpan={6}>No records in this range.</td>
                    </tr>
                  ) : (
                    statement.records.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.occurred_at)}</td>
                        <td>{formatTime(r.occurred_at)}</td>
                        <td>{r.vendor_name || '—'}</td>
                        <td>{KIND_LABELS[r.kind] || r.kind}</td>
                        <td>{r.kind === 'total' ? r.item || '—' : '—'}</td>
                        <td>{formatMoney(r.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <RemoveVendorModal
        vendor={removeTarget}
        busy={Boolean(removingId)}
        error={removeError}
        onCancel={closeRemoveVendor}
        onConfirm={confirmRemoveVendor}
      />
    </div>
  );
}

export default function HardwareLedgerPage() {
  const ready = useHardwareLedgerGuard();
  if (!ready) return null;
  return <HardwareLedgerDashboard />;
}
