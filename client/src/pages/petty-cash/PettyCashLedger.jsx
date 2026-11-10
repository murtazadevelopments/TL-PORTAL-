import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import api from '../../api/client';
import { BRANCH_OPTIONS } from '../../constants/branches';
import { useFlashSuccess } from '../../utils/successPopup';
import './PettyCashDashboard.css';

function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function currentMonthKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7);
}

function toDateTimeLocalValue(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseDownloadName(res, format) {
  const headerName = String(res.headers['x-export-filename'] || '').trim();
  if (headerName) return headerName;
  const disposition = String(res.headers['content-disposition'] || '');
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* keep scanning */
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return format === 'pdf' ? 'TL Petty Cash.pdf' : 'TL Petty Cash.xls';
}

async function readErrorBody(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data.message === 'string') return data.message;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.text === 'function') {
    const text = await data.text();
    try {
      const parsed = JSON.parse(text);
      return parsed.message || parsed.error || text;
    } catch {
      return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

const emptyForm = () => ({
  item_name: '',
  price: '',
  quantity: '',
  branch: '',
  person_name: '',
  occurred_at: toDateTimeLocalValue(new Date()),
});

/**
 * @param {{ mode: 'mine' | 'holder', holderUserId?: string|number, backTo?: string }} props
 */
export default function PettyCashLedger({ mode, holderUserId, backTo }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState(null);
  const [entries, setEntries] = useState([]);
  const [fundAdditions, setFundAdditions] = useState([]);
  const [summary, setSummary] = useState({
    total_amount: 0,
    used_amount: 0,
    pending_amount: 0,
    count: 0,
  });
  const [canEdit, setCanEdit] = useState(false);
  const [month, setMonth] = useState(currentMonthKey);
  const [form, setForm] = useState(emptyForm);
  const [receiptFile, setReceiptFile] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editReceiptFile, setEditReceiptFile] = useState(null);
  const [clearReceipt, setClearReceipt] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingHasReceipt, setEditingHasReceipt] = useState(false);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [totalDraft, setTotalDraft] = useState('');
  const [totalOccurredAt, setTotalOccurredAt] = useState(() =>
    toDateTimeLocalValue(new Date())
  );
  const [editingTotal, setEditingTotal] = useState(false);
  const [savingTotal, setSavingTotal] = useState(false);
  const [exporting, setExporting] = useState('');
  const [success, setSuccess] = useState('');
  const [branches, setBranches] = useState(BRANCH_OPTIONS);
  useFlashSuccess(success);

  const title = useMemo(() => {
    if (mode === 'holder') {
      return owner?.name ? `${owner.name}'s petty cash` : 'Petty cash';
    }
    return 'Petty cash';
  }, [mode, owner]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const url =
        mode === 'holder'
          ? `/api/petty-cash/holders/${holderUserId}`
          : '/api/petty-cash/me';
      const { data } = await api.get(url, { params: { month } });
      setOwner(data.owner || null);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setFundAdditions(Array.isArray(data.fund_additions) ? data.fund_additions : []);
      const nextSummary =
        data.summary || {
          total_amount: 0,
          used_amount: 0,
          pending_amount: 0,
          count: 0,
        };
      setSummary(nextSummary);
      setCanEdit(Boolean(data.can_edit));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load petty cash.');
      setEntries([]);
      setFundAdditions([]);
    } finally {
      setLoading(false);
    }
  }, [mode, holderUserId, month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    api
      .get('/api/admin/branches')
      .then(({ data }) => {
        if (!active) return;
        const names = Array.isArray(data)
          ? data.map((b) => b.name).filter(Boolean)
          : [];
        if (names.length) setBranches(names);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function receiptUrl(entry) {
    if (!entry?.has_receipt) return null;
    if (mode === 'holder') {
      return `/api/petty-cash/holders/${holderUserId}/entries/${entry.id}/receipt`;
    }
    return `/api/petty-cash/me/${entry.id}/receipt`;
  }

  async function openReceipt(entry) {
    const url = receiptUrl(entry);
    if (!url) return;
    try {
      const { data } = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(data);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not open receipt.');
    }
  }

  function startEdit(entry) {
    setEditingId(entry.id);
    setEditingHasReceipt(Boolean(entry.has_receipt));
    setClearReceipt(false);
    setEditReceiptFile(null);
    setEditError('');
    setEditForm({
      item_name: entry.item_name || '',
      price: String(entry.price ?? ''),
      quantity: entry.quantity != null ? String(entry.quantity) : '',
      branch: entry.branch || '',
      person_name: entry.person_name || '',
      occurred_at: toDateTimeLocalValue(entry.occurred_at || entry.created_at),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingHasReceipt(false);
    setClearReceipt(false);
    setEditReceiptFile(null);
    setEditError('');
    setEditForm(emptyForm());
  }

  function buildFormData(source, file, shouldClearReceipt = false) {
    const fd = new FormData();
    fd.append('item_name', String(source.item_name || '').trim());
    fd.append('price', source.price);
    if (source.quantity !== '' && source.quantity != null) {
      fd.append('quantity', source.quantity);
    }
    if (source.branch) fd.append('branch', source.branch);
    if (String(source.person_name || '').trim()) {
      fd.append('person_name', String(source.person_name).trim());
    }
    fd.append('occurred_at', source.occurred_at);
    if (file) fd.append('receipt', file);
    if (shouldClearReceipt) fd.append('clear_receipt', '1');
    return fd;
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.post('/api/petty-cash/me', buildFormData(form, receiptFile));
      setSuccess('Entry added.');
      setForm(emptyForm());
      setReceiptFile(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(e) {
    e.preventDefault();
    if (!canEdit || !editingId) return;
    setSaving(true);
    setEditError('');
    setSuccess('');
    try {
      await api.put(
        `/api/petty-cash/me/${editingId}`,
        buildFormData(editForm, editReceiptFile, clearReceipt)
      );
      setSuccess('Entry updated.');
      cancelEdit();
      await load();
    } catch (err) {
      setEditError(err.response?.data?.message || 'Could not update entry.');
    } finally {
      setSaving(false);
    }
  }

  function openAddTotal() {
    setTotalDraft('');
    setTotalOccurredAt(toDateTimeLocalValue(new Date()));
    setEditingTotal(true);
  }

  async function handleUpdateTotal(e) {
    e.preventDefault();
    if (!canEdit) return;
    setSavingTotal(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.put('/api/petty-cash/me/total', {
        amount: totalDraft,
        occurred_at: totalOccurredAt,
        month,
      });
      if (data.summary) setSummary(data.summary);
      if (Array.isArray(data.fund_additions)) setFundAdditions(data.fund_additions);
      setTotalDraft('');
      setTotalOccurredAt(toDateTimeLocalValue(new Date()));
      setEditingTotal(false);
      setSuccess(data.message || 'Amount added to total.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add to total amount.');
    } finally {
      setSavingTotal(false);
    }
  }

  async function handleDelete(entry) {
    if (!canEdit) return;
    if (!window.confirm('Delete this petty cash entry?')) return;
    setError('');
    setSuccess('');
    try {
      await api.delete(`/api/petty-cash/me/${entry.id}`);
      setSuccess('Entry deleted.');
      if (editingId === entry.id) cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete entry.');
    }
  }

  async function handleExport(format) {
    setExporting(format);
    setError('');
    try {
      const url =
        mode === 'holder'
          ? `/api/petty-cash/holders/${holderUserId}/export`
          : '/api/petty-cash/me/export';
      const res = await api.get(url, {
        params: { format, month },
        responseType: 'blob',
      });
      const type = String(res.headers['content-type'] || '');
      if (type.includes('application/json')) {
        const message = (await readErrorBody(res.data)) || 'Export failed.';
        throw new Error(message);
      }
      const filename = parseDownloadName(res, format);
      const blobUrl = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      setSuccess(`Downloaded ${filename}`);
    } catch (err) {
      const fromBody = await readErrorBody(err.response?.data);
      const status = err.response?.status;
      setError(
        fromBody ||
          err.message ||
          (status ? `Export failed (${status}).` : 'Export failed.')
      );
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="petty-page">
      {backTo ? (
        <p className="petty-sub">
          <Link to={backTo}>← All petty cash</Link>
        </p>
      ) : null}
      <h1>{title}</h1>
      <p className="petty-sub">
        {mode === 'holder'
          ? 'Read-only month view of this assigned person’s items.'
          : 'Your personal petty cash by month. Pending = Total − Used.'}
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="petty-toolbar">
        <label className="petty-month">
          <span>Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonthKey())}
            disabled={loading}
          />
        </label>
        <p className="petty-formula">
          Pending amount = Total amount − Used amount
        </p>
        <div className="petty-export">
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(exporting) || loading}
            onClick={() => handleExport('xlsx')}
          >
            {exporting === 'xlsx' ? 'Preparing Excel…' : 'Download Excel'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={Boolean(exporting) || loading}
            onClick={() => handleExport('pdf')}
          >
            {exporting === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div className="petty-tabs" aria-label="Petty cash amounts">
        <div className="petty-tab active">
          <span className="petty-tab-label">Total Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.total_amount)}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Used Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.used_amount)}</span>
        </div>
        <div className="petty-tab">
          <span className="petty-tab-label">Pending Amount</span>
          <span className="petty-tab-amount">{formatMoney(summary.pending_amount)}</span>
        </div>
      </div>

      {canEdit ? (
        <div className="petty-total-box">
          {editingTotal ? (
            <form className="petty-total-form" onSubmit={handleUpdateTotal}>
              <label>
                Amount to add
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={totalDraft}
                  onChange={(e) => setTotalDraft(e.target.value)}
                  placeholder="Enter amount"
                  required
                />
              </label>
              <label>
                Date & time
                <input
                  type="datetime-local"
                  value={totalOccurredAt}
                  onChange={(e) => setTotalOccurredAt(e.target.value)}
                  required
                />
              </label>
              <div className="petty-form-actions">
                <button type="submit" className="btn btn-primary" disabled={savingTotal}>
                  {savingTotal ? 'Saving…' : 'Add to total'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditingTotal(false);
                    setTotalDraft('');
                    setTotalOccurredAt(toDateTimeLocalValue(new Date()));
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={openAddTotal}>
              Add to total amount
            </button>
          )}
        </div>
      ) : null}

      <section className="petty-fund-section">
        <h2 className="petty-section-title">Total amount details</h2>
        {loading ? (
          <p className="petty-empty">Loading…</p>
        ) : fundAdditions.length === 0 ? (
          <p className="petty-empty">No total amount additions for this month.</p>
        ) : (
          <div className="petty-table-wrap">
            <table className="petty-table">
              <thead>
                <tr>
                  <th>Date & time</th>
                  <th>Amount added</th>
                </tr>
              </thead>
              <tbody>
                {fundAdditions.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.occurred_at || row.created_at)}</td>
                    <td>{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit ? (
        <form className="petty-form" onSubmit={handleAdd}>
          <label>
            Item name *
            <input
              type="text"
              value={form.item_name}
              onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
              maxLength={200}
              required
            />
          </label>
          <label>
            Price *
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              required
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label>
            Branch
            <select
              value={form.branch}
              onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
            >
              <option value="">Optional</option>
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Person name
            <input
              type="text"
              value={form.person_name}
              onChange={(e) => setForm((f) => ({ ...f, person_name: e.target.value }))}
              maxLength={120}
              placeholder="Optional"
            />
          </label>
          <label>
            Date & time *
            <input
              type="datetime-local"
              value={form.occurred_at}
              onChange={(e) => setForm((f) => ({ ...f, occurred_at: e.target.value }))}
              required
            />
          </label>
          <label className="full">
            Receipt
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
            />
          </label>
          <div className="petty-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving && !editingId}>
              {saving && !editingId ? 'Saving…' : 'Add item'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="petty-empty">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="petty-empty">No items for this month.</p>
      ) : (
        <div className="petty-table-wrap">
          <table className="petty-table">
            <thead>
              <tr>
                <th>Date & time</th>
                <th>Item</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Amount</th>
                <th>Branch</th>
                <th>Person</th>
                <th>Receipt</th>
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.occurred_at || entry.created_at)}</td>
                  <td>{entry.item_name}</td>
                  <td>{formatMoney(entry.price)}</td>
                  <td>{entry.quantity != null ? entry.quantity : '—'}</td>
                  <td>{formatMoney(entry.amount)}</td>
                  <td>{entry.branch || '—'}</td>
                  <td>{entry.person_name || '—'}</td>
                  <td>
                    {entry.has_receipt ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => openReceipt(entry)}
                      >
                        View
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canEdit ? (
                    <td>
                      <div className="petty-row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => startEdit(entry)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleDelete(entry)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingId && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="petty-modal-backdrop"
              onClick={cancelEdit}
              role="presentation"
            >
              <form
                className="petty-modal"
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleUpdate}
                role="dialog"
                aria-modal="true"
                aria-labelledby="petty-edit-title"
              >
                <div className="petty-modal-header">
                  <h2 id="petty-edit-title">Edit item</h2>
                  <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                    Close
                  </button>
                </div>
                {editError ? <p className="error">{editError}</p> : null}
                <div className="petty-form petty-form-modal">
                  <label>
                    Item name *
                    <input
                      type="text"
                      value={editForm.item_name}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, item_name: e.target.value }))
                      }
                      maxLength={200}
                      required
                    />
                  </label>
                  <label>
                    Price *
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editForm.price}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, price: e.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editForm.quantity}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, quantity: e.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    Branch
                    <select
                      value={editForm.branch}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, branch: e.target.value }))
                      }
                    >
                      <option value="">Optional</option>
                      {branches.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Person name
                    <input
                      type="text"
                      value={editForm.person_name}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, person_name: e.target.value }))
                      }
                      maxLength={120}
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    Date & time *
                    <input
                      type="datetime-local"
                      value={editForm.occurred_at}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, occurred_at: e.target.value }))
                      }
                      required
                    />
                  </label>
                  <label className="full">
                    Receipt
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        setEditReceiptFile(e.target.files?.[0] || null);
                        setClearReceipt(false);
                      }}
                    />
                  </label>
                  {editingHasReceipt && !editReceiptFile ? (
                    <div className="petty-form-actions">
                      <label className="petty-check">
                        <input
                          type="checkbox"
                          checked={clearReceipt}
                          onChange={(e) => setClearReceipt(e.target.checked)}
                        />
                        Remove current receipt
                      </label>
                    </div>
                  ) : null}
                  <div className="petty-form-actions">
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : 'Update item'}
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
