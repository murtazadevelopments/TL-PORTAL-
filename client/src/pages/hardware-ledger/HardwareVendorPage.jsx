import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import api from '../../api/client';
import { useFlashSuccess } from '../../utils/successPopup';
import {
  STATEMENT_MODES,
  currentMonthKey,
  defaultStatementRange,
  formatDate,
  formatMoney,
  formatTime,
  localInputToIso,
  statementInputType,
  toDateTimeLocalValue,
  useHardwareLedgerGuard,
} from './hardwareLedgerUtils';
import RemoveVendorModal from './RemoveVendorModal';
import '../petty-cash/PettyCashDashboard.css';
import './HardwareLedger.css';

const KIND_LABELS = { total: 'Item', paid: 'Paid amount' };

const emptyItem = () => ({
  item: '',
  amount: '',
});

const emptyPaid = () => ({
  amount: '',
});

function deviceNowIso() {
  return new Date().toISOString();
}

function HardwareVendorLedger({ vendorId }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vendor, setVendor] = useState(null);
  const [summary, setSummary] = useState({
    total_amount: 0,
    paid_amount: 0,
    month_pending_amount: 0,
    prior_pending_amount: 0,
    pending_amount: 0,
  });
  const [priorPendingMonths, setPriorPendingMonths] = useState([]);
  const [records, setRecords] = useState([]);
  const [month, setMonth] = useState(currentMonthKey);
  const [monthLabelText, setMonthLabelText] = useState('');
  const [canRemoveVendor, setCanRemoveVendor] = useState(false);
  const [itemForm, setItemForm] = useState(() => emptyItem());
  const [paidForm, setPaidForm] = useState(() => emptyPaid());
  const [savingItem, setSavingItem] = useState(false);
  const [savingPaid, setSavingPaid] = useState(false);
  const [removingVendor, setRemovingVendor] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [filter, setFilter] = useState('all');
  const [statementMode, setStatementMode] = useState('month');
  const [statementFrom, setStatementFrom] = useState(() => defaultStatementRange('month').from);
  const [statementTo, setStatementTo] = useState(() => defaultStatementRange('month').to);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState('');
  const [statement, setStatement] = useState(null);
  useFlashSuccess(success);

  function applyPayload(data) {
    setVendor(data.vendor || null);
    setSummary(
      data.summary || {
        total_amount: 0,
        paid_amount: 0,
        month_pending_amount: 0,
        prior_pending_amount: 0,
        pending_amount: 0,
      }
    );
    setPriorPendingMonths(
      Array.isArray(data.prior_pending_months) ? data.prior_pending_months : []
    );
    setRecords(Array.isArray(data.records) ? data.records : []);
    if (data.month) setMonth(data.month);
    if (data.month_label) setMonthLabelText(data.month_label);
    if (typeof data.can_remove_vendor === 'boolean') {
      setCanRemoveVendor(data.can_remove_vendor);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/hardware-ledger/vendors/${vendorId}`, {
        params: { month },
      });
      applyPayload(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load vendor.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [vendorId, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddItem(e) {
    e.preventDefault();
    const item = String(itemForm.item || '').trim();
    const amount = Number(itemForm.amount);
    if (!item) {
      setError('Enter an item name.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a price greater than 0.');
      return;
    }
    setSavingItem(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post(`/api/hardware-ledger/vendors/${vendorId}/records`, {
        kind: 'total',
        item,
        amount: itemForm.amount,
        occurred_at: deviceNowIso(),
        month,
      });
      applyPayload(data);
      setSuccess(data.message || 'Item added.');
      setItemForm(emptyItem());
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add item.');
    } finally {
      setSavingItem(false);
    }
  }

  async function handleAddPaid(e) {
    e.preventDefault();
    const amount = Number(paidForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a paid amount greater than 0.');
      return;
    }
    setSavingPaid(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post(`/api/hardware-ledger/vendors/${vendorId}/records`, {
        kind: 'paid',
        item: '',
        amount: paidForm.amount,
        occurred_at: deviceNowIso(),
        month,
      });
      applyPayload(data);
      setSuccess(data.message || 'Paid amount saved.');
      setPaidForm(emptyPaid());
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save paid amount.');
    } finally {
      setSavingPaid(false);
    }
  }

  function startEdit(record) {
    setEditError('');
    setEditForm({
      id: record.id,
      kind: record.kind,
      item: record.item || '',
      amount: String(record.amount ?? ''),
      occurred_at: toDateTimeLocalValue(record.occurred_at),
    });
  }

  function cancelEdit() {
    setEditForm(null);
    setEditError('');
  }

  async function handleUpdate(e) {
    e.preventDefault();
    if (!editForm) return;
    const amount = Number(editForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('Enter an amount greater than 0.');
      return;
    }
    if (editForm.kind === 'total' && !String(editForm.item || '').trim()) {
      setEditError('Enter an item name.');
      return;
    }
    setSavingEdit(true);
    setEditError('');
    setSuccess('');
    try {
      const { data } = await api.put(
        `/api/hardware-ledger/vendors/${vendorId}/records/${editForm.id}`,
        {
          kind: editForm.kind,
          item: editForm.kind === 'total' ? String(editForm.item || '').trim() : '',
          amount: editForm.amount,
          occurred_at: localInputToIso(editForm.occurred_at),
          month,
        }
      );
      applyPayload(data);
      setSuccess('Record updated.');
      setEditForm(null);
    } catch (err) {
      setEditError(err.response?.data?.message || 'Could not update record.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRemoveRecord(record) {
    const label =
      record.kind === 'total'
        ? `item “${record.item || 'Untitled'}” (${formatMoney(record.amount)})`
        : `paid amount of ${formatMoney(record.amount)}`;
    if (!window.confirm(`Remove this ${label}?`)) return;
    setError('');
    setSuccess('');
    try {
      // Item/paid remove — no account password (password is only for remove vendor).
      const { data } = await api.delete(
        `/api/hardware-ledger/vendors/${vendorId}/records/${record.id}`,
        { params: { month } }
      );
      applyPayload(data);
      setSuccess('Record removed.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove record.');
    }
  }

  function openRemoveVendor() {
    if (!canRemoveVendor || !vendor) return;
    setRemoveError('');
    setRemoveOpen(true);
  }

  function closeRemoveVendor() {
    if (removingVendor) return;
    setRemoveOpen(false);
    setRemoveError('');
  }

  async function confirmRemoveVendor(password) {
    if (!canRemoveVendor || !vendor) return;
    setRemovingVendor(true);
    setRemoveError('');
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/hardware-ledger/vendors/${vendorId}`, {
        data: { password },
      });
      setSuccess(data.message || 'Vendor removed.');
      setRemoveOpen(false);
      navigate('/hardware-ledger', { replace: true });
    } catch (err) {
      setRemoveError(err.response?.data?.message || 'Could not remove vendor.');
      setRemovingVendor(false);
    }
  }

  const visible = filter === 'all' ? records : records.filter((r) => r.kind === filter);

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
      const { data } = await api.get(`/api/hardware-ledger/vendors/${vendorId}/statement`, {
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
      <p className="petty-sub">
        <Link to="/hardware-ledger">← All vendors</Link>
      </p>
      <div className="hw-vendor-title-row">
        <h1>{vendor?.name || 'Vendor'}</h1>
        {canRemoveVendor ? (
          <button
            type="button"
            className="btn btn-ghost hw-remove-vendor"
            disabled={removingVendor || loading}
            onClick={openRemoveVendor}
          >
            Remove vendor
          </button>
        ) : null}
      </div>
      <p className="petty-sub">
        Overall pending is the whole amount still owed through this month. This month pending =
        Total − Paid for the selected month only.
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
      </div>

      {priorPendingMonths.length > 0 ? (
        <div className="hw-prior-box" role="status">
          <p className="hw-prior-title">
            Brought forward · {formatMoney(summary.prior_pending_amount || 0)}
          </p>
          <ul className="hw-prior-list">
            {priorPendingMonths.map((row) => (
              <li key={row.month}>
                <strong>{formatMoney(row.pending_amount)}</strong> — {row.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="petty-tabs" aria-label="Vendor amounts">
        <div className="petty-tab">
          <span className="petty-tab-label">Total Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.total_amount)}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Paid Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.paid_amount)}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">
            This month pending{monthLabelText ? ` (${monthLabelText})` : ''}
          </span>
          <span className="petty-tab-amount">
            {formatMoney(summary.month_pending_amount ?? summary.pending_amount)}
          </span>
        </div>
        <div className="petty-tab active">
          <span className="petty-tab-label">Overall pending</span>
          <span className="petty-tab-amount">
            {formatMoney(Math.max(0, summary.pending_amount || 0))}
          </span>
        </div>
      </div>

      <form className="petty-form" onSubmit={handleAddItem}>
        <label className="full">
          Item name *
          <input
            type="text"
            value={itemForm.item}
            onChange={(e) => setItemForm((f) => ({ ...f, item: e.target.value }))}
            maxLength={200}
            placeholder="Enter item name"
            required
            autoComplete="off"
          />
        </label>
        <label>
          Price *
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={itemForm.amount}
            onChange={(e) => setItemForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Enter price"
            required
          />
        </label>
        <p className="hw-device-time">Date &amp; time is taken from this device when you save.</p>
        <div className="petty-form-actions">
          <button type="submit" className="btn btn-primary" disabled={savingItem || loading}>
            {savingItem ? 'Saving…' : '+ Add new item'}
          </button>
        </div>
      </form>

      <form className="petty-form hw-paid-form" onSubmit={handleAddPaid}>
        <label>
          Paid amount *
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={paidForm.amount}
            onChange={(e) => setPaidForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Enter paid amount"
            required
          />
        </label>
        <div className="petty-form-actions">
          <button type="submit" className="btn btn-ghost" disabled={savingPaid || loading}>
            {savingPaid ? 'Saving…' : 'Add paid amount'}
          </button>
        </div>
      </form>

      <section className="petty-fund-section">
        <div className="hw-records-head">
          <h2 className="petty-section-title">Records</h2>
          <select
            className="hw-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter records"
          >
            <option value="all">All records</option>
            <option value="total">Items</option>
            <option value="paid">Paid amounts</option>
          </select>
        </div>
        {loading ? (
          <p className="petty-empty">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="petty-empty">No records yet.</p>
        ) : (
          <div className="petty-table-wrap">
            <table className="petty-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Item</th>
                  <th>Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.occurred_at)}</td>
                    <td>{formatTime(r.occurred_at)}</td>
                    <td>
                      <span className={`hw-kind hw-kind-${r.kind}`}>{KIND_LABELS[r.kind]}</span>
                    </td>
                    <td>{r.kind === 'total' ? r.item || '—' : '—'}</td>
                    <td>{formatMoney(r.amount)}</td>
                    <td>
                      <div className="petty-row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => startEdit(r)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleRemoveRecord(r)}
                        >
                          {r.kind === 'total' ? 'Remove item' : 'Remove paid'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editForm && typeof document !== 'undefined'
        ? createPortal(
            <div className="petty-modal-backdrop" onClick={cancelEdit} role="presentation">
              <form
                className="petty-modal"
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleUpdate}
                role="dialog"
                aria-modal="true"
                aria-labelledby="hw-edit-title"
              >
                <div className="petty-modal-header">
                  <h2 id="hw-edit-title">
                    {editForm.kind === 'total' ? 'Edit item' : 'Edit paid amount'}
                  </h2>
                  <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                    Close
                  </button>
                </div>
                {editError ? <p className="error">{editError}</p> : null}
                <div className="petty-form petty-form-modal">
                  {editForm.kind === 'total' ? (
                    <label className="full">
                      Item name *
                      <input
                        type="text"
                        value={editForm.item}
                        onChange={(e) => setEditForm((f) => ({ ...f, item: e.target.value }))}
                        maxLength={200}
                        placeholder="Enter item name"
                        required
                      />
                    </label>
                  ) : null}
                  <label>
                    {editForm.kind === 'total' ? 'Price *' : 'Amount *'}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editForm.amount}
                      onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    Date &amp; time *
                    <input
                      type="datetime-local"
                      value={editForm.occurred_at}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, occurred_at: e.target.value }))
                      }
                      required
                    />
                  </label>
                  <div className="petty-form-actions">
                    <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                      {savingEdit ? 'Saving…' : 'Update'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
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
          Choose month-to-month, year-to-year, or date-to-date and generate a complete statement.
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
          <div className="hw-statement-print" id="hw-statement-print">
            <div className="hw-statement-head">
              <h3>{statement.vendor?.name || vendor?.name || 'Vendor'} — statement</h3>
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

            {Array.isArray(statement.months) && statement.months.length > 0 ? (
              <div className="petty-table-wrap">
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
                    <th>Type</th>
                    <th>Item</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(statement.records || []).length === 0 ? (
                    <tr>
                      <td colSpan={5}>No records in this range.</td>
                    </tr>
                  ) : (
                    statement.records.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.occurred_at)}</td>
                        <td>{formatTime(r.occurred_at)}</td>
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
        vendor={removeOpen ? vendor : null}
        busy={removingVendor}
        error={removeError}
        onCancel={closeRemoveVendor}
        onConfirm={confirmRemoveVendor}
      />
    </div>
  );
}

export default function HardwareVendorPage() {
  const ready = useHardwareLedgerGuard();
  const { vendorId } = useParams();
  if (!ready) return null;
  return <HardwareVendorLedger vendorId={vendorId} />;
}
