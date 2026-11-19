import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router';
import api from '../../api/client';
import { useFlashSuccess } from '../../utils/successPopup';
import {
  formatDate,
  formatMoney,
  formatTime,
  localInputToIso,
  toDateTimeLocalValue,
  useHardwareLedgerGuard,
} from './hardwareLedgerUtils';
import '../petty-cash/PettyCashDashboard.css';
import './HardwareLedger.css';

const KIND_LABELS = { total: 'Total amount', paid: 'Paid amount' };

const emptyRecord = (kind = 'total') => ({
  kind,
  amount: '',
  occurred_at: toDateTimeLocalValue(new Date()),
});

function RecordFields({ value, setValue }) {
  return (
    <>
      <label>
        Type *
        <select
          value={value.kind}
          onChange={(e) => setValue((f) => ({ ...f, kind: e.target.value }))}
          required
        >
          <option value="total">Total amount</option>
          <option value="paid">Paid amount</option>
        </select>
      </label>
      <label>
        Amount *
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={value.amount}
          onChange={(e) => setValue((f) => ({ ...f, amount: e.target.value }))}
          placeholder="Enter amount"
          required
        />
      </label>
      <label>
        Date &amp; time *
        <input
          type="datetime-local"
          value={value.occurred_at}
          onChange={(e) => setValue((f) => ({ ...f, occurred_at: e.target.value }))}
          required
        />
      </label>
    </>
  );
}

function HardwareVendorLedger({ vendorId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vendor, setVendor] = useState(null);
  const [summary, setSummary] = useState({ total_amount: 0, paid_amount: 0, pending_amount: 0 });
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(() => emptyRecord());
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [filter, setFilter] = useState('all');
  useFlashSuccess(success);

  function applyPayload(data) {
    setVendor(data.vendor || null);
    setSummary(data.summary || { total_amount: 0, paid_amount: 0, pending_amount: 0 });
    setRecords(Array.isArray(data.records) ? data.records : []);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/api/hardware-ledger/vendors/${vendorId}`);
      applyPayload(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load vendor.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post(`/api/hardware-ledger/vendors/${vendorId}/records`, {
        kind: form.kind,
        amount: form.amount,
        occurred_at: localInputToIso(form.occurred_at),
      });
      applyPayload(data);
      setSuccess(data.message || 'Saved.');
      setForm(emptyRecord(form.kind));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save record.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(record) {
    setEditError('');
    setEditForm({
      id: record.id,
      kind: record.kind,
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
    setSavingEdit(true);
    setEditError('');
    setSuccess('');
    try {
      const { data } = await api.put(
        `/api/hardware-ledger/vendors/${vendorId}/records/${editForm.id}`,
        {
          kind: editForm.kind,
          amount: editForm.amount,
          occurred_at: localInputToIso(editForm.occurred_at),
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

  async function handleRemove(record) {
    if (
      !window.confirm(
        `Remove this ${KIND_LABELS[record.kind].toLowerCase()} of ${formatMoney(record.amount)}?`
      )
    ) {
      return;
    }
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(
        `/api/hardware-ledger/vendors/${vendorId}/records/${record.id}`
      );
      applyPayload(data);
      setSuccess('Record removed.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove record.');
    }
  }

  const visible = filter === 'all' ? records : records.filter((r) => r.kind === filter);

  return (
    <div className="petty-page">
      <p className="petty-sub">
        <Link to="/hardware-ledger">← All vendors</Link>
      </p>
      <h1>{vendor?.name || 'Vendor'}</h1>
      <p className="petty-sub">Pending amount = Total amount − Paid amount.</p>

      {error ? <p className="error">{error}</p> : null}

      <div className="petty-tabs" aria-label="Vendor amounts">
        <div className="petty-tab">
          <span className="petty-tab-label">Total Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.total_amount)}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Paid Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.paid_amount)}</span>
        </div>
        <div className="petty-tab active">
          <span className="petty-tab-label">Pending Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.pending_amount)}</span>
        </div>
      </div>

      <form className="petty-form" onSubmit={handleAdd}>
        <RecordFields value={form} setValue={setForm} />
        <div className="petty-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || loading}>
            {saving ? 'Saving…' : `Add ${KIND_LABELS[form.kind].toLowerCase()}`}
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
            <option value="total">Total amounts</option>
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
                          onClick={() => handleRemove(r)}
                        >
                          Remove
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
                  <h2 id="hw-edit-title">Edit record</h2>
                  <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                    Close
                  </button>
                </div>
                {editError ? <p className="error">{editError}</p> : null}
                <div className="petty-form petty-form-modal">
                  <RecordFields value={editForm} setValue={setEditForm} />
                  <div className="petty-form-actions">
                    <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                      {savingEdit ? 'Saving…' : 'Update record'}
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
    </div>
  );
}

export default function HardwareVendorPage() {
  const ready = useHardwareLedgerGuard();
  const { vendorId } = useParams();
  if (!ready) return null;
  return <HardwareVendorLedger vendorId={vendorId} />;
}
