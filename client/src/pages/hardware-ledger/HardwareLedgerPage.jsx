import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import api from '../../api/client';
import { useFlashSuccess } from '../../utils/successPopup';
import {
  currentMonthKey,
  formatMoney,
  useHardwareLedgerGuard,
} from './hardwareLedgerUtils';
import RemoveVendorModal from './RemoveVendorModal';
import '../petty-cash/PettyCashDashboard.css';
import './HardwareLedger.css';

function HardwareLedgerDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState({ total_amount: 0, paid_amount: 0, pending_amount: 0 });
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
  useFlashSuccess(success);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/hardware-ledger/vendors', { params: { month } });
      setVendors(Array.isArray(data.vendors) ? data.vendors : []);
      setSummary(data.summary || { total_amount: 0, paid_amount: 0, pending_amount: 0 });
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

  return (
    <div className="petty-page">
      <h1>Hardware Ledger</h1>
      <p className="petty-sub">Vendors and their amounts for the selected month.</p>

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
        <p className="petty-formula">Pending amount = Total amount − Paid amount</p>
      </div>

      <div className="petty-tabs" aria-label="All vendors amounts">
        <div className="petty-tab active">
          <span className="petty-tab-label">Pending Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.pending_amount)}</span>
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
                  </div>
                </div>
                <div className="hw-pending">
                  <span className="hw-pending-label">Pending</span>
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
