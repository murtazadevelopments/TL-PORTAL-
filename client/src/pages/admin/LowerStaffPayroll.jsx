import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useFlashSuccess } from '../../utils/successPopup';
import './LowerStaffPayroll.css';

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function moneyLabel(value) {
  const n = money(value);
  return `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
}

function splitPreview(amount, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const total = money(amount);
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return money(base / 100);
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
  return format === 'pdf' ? 'TL Subordinate Salary.pdf' : 'TL Subordinate Salary.xls';
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

async function downloadPayroll(format, month) {
  const res = await api.get('/api/admin/lower-staff/payroll/export', {
    params: { format, month },
    responseType: 'blob',
  });
  const type = String(res.headers['content-type'] || '');
  if (type.includes('application/json')) {
    const message = (await readErrorBody(res.data)) || 'Export failed.';
    throw new Error(message);
  }
  const filename = parseDownloadName(res, format);
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

function monthKeyFromDate(dateKey) {
  return String(dateKey || '').slice(0, 7);
}

function indexPayroll(employees) {
  const map = {};
  for (const row of employees || []) {
    map[row.id] = row;
    map[String(row.id)] = row;
    const n = Number(row.id);
    if (Number.isFinite(n)) map[n] = row;
  }
  return map;
}

function payFor(map, id) {
  if (!map) return null;
  return map[id] || map[String(id)] || map[Number(id)] || null;
}

function PortalModal({ children }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export default function LowerStaffPayroll({
  employees,
  canManage,
  extraSlotSummary,
  fullName,
  formatSalaryAmount,
  onEdit,
  onCancelEdit,
  onDelete,
  editingId,
  deletingId,
}) {
  const nowMonth = monthKeyFromDate(todayKey());
  const [month, setMonth] = useState(nowMonth);
  const [payroll, setPayroll] = useState({});
  const [today, setToday] = useState(todayKey());
  const [loadingPay, setLoadingPay] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [exporting, setExporting] = useState('');
  const [hubFor, setHubFor] = useState(null);
  const [advanceFor, setAdvanceFor] = useState(null);
  const [loanFor, setLoanFor] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({ amount: '', paid_on: todayKey(), remarks: '' });
  const [loanForm, setLoanForm] = useState({ amount: '', installments: '3', start_month: nowMonth, remarks: '' });
  useFlashSuccess(success);

  const loadPayroll = useCallback(async (monthKey) => {
    setLoadingPay(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/lower-staff/payroll', {
        params: { month: monthKey },
      });
      setPayroll(indexPayroll(data.employees));
      if (data.today) setToday(data.today);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load salary details.');
    } finally {
      setLoadingPay(false);
    }
  }, []);

  useEffect(() => {
    loadPayroll(month);
  }, [month, loadPayroll]);

  function openHub(row) {
    setHubFor(row);
    setError('');
  }

  function closeHub() {
    setHubFor(null);
    setAdvanceFor(null);
    setLoanFor(null);
    setDetailFor(null);
    setDetail(null);
    onCancelEdit?.();
  }

  async function openDetail(row) {
    setDetailFor(row);
    setDetail(null);
    setError('');
    try {
      const { data } = await api.get(`/api/admin/employees/${row.id}/payroll`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load employee salary.');
    }
  }

  function openAdvance(row) {
    const pay = payFor(payroll, row.id);
    setAdvanceFor({ ...row, ...pay });
    setAdvanceForm({ amount: '', paid_on: today, remarks: '' });
    setError('');
  }

  function openLoan(row) {
    const pay = payFor(payroll, row.id);
    setLoanFor({ ...row, ...pay });
    setLoanForm({ amount: '', installments: '3', start_month: month, remarks: '' });
    setError('');
  }

  const loanPreview = useMemo(() => {
    const amount = money(loanForm.amount);
    const count = Math.max(1, Math.floor(Number(loanForm.installments) || 1));
    if (!(amount > 0)) return null;
    const monthly = splitPreview(amount, count);
    const pay = loanFor || {};
    const firstHitsThisMonth = loanForm.start_month === month;
    const remaining = firstHitsThisMonth
      ? money(pay.salary) - money(pay.advance_amount) - money(pay.loan_amount) - monthly
      : money(pay.remaining ?? pay.salary);
    return { monthly, remaining, count };
  }, [loanForm, loanFor, month]);

  const advancePreview = useMemo(() => {
    const amount = money(advanceForm.amount);
    if (!(amount > 0) || !advanceFor) return null;
    const hitsMonth = monthKeyFromDate(advanceForm.paid_on) === month;
    const remaining = hitsMonth
      ? money(advanceFor.salary) - money(advanceFor.advance_amount) - money(advanceFor.loan_amount) - amount
      : money(advanceFor.remaining ?? advanceFor.salary);
    return { remaining, hitsMonth };
  }, [advanceForm, advanceFor, month]);

  async function submitAdvance(e) {
    e.preventDefault();
    if (!advanceFor) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/api/admin/employees/${advanceFor.id}/advances`, {
        amount: money(advanceForm.amount),
        paid_on: advanceForm.paid_on,
        remarks: advanceForm.remarks.trim(),
      });
      setSuccess(data.message || 'Advance saved.');
      setAdvanceFor(null);
      await loadPayroll(month);
      if (detailFor?.id === advanceFor.id) await openDetail(advanceFor);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save advance.');
    } finally {
      setSaving(false);
    }
  }

  async function submitLoan(e) {
    e.preventDefault();
    if (!loanFor) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/api/admin/employees/${loanFor.id}/loans`, {
        amount: money(loanForm.amount),
        installments: Number(loanForm.installments),
        start_month: loanForm.start_month,
        remarks: loanForm.remarks.trim(),
      });
      setSuccess(data.message || 'Loan saved.');
      setLoanFor(null);
      await loadPayroll(month);
      if (detailFor?.id === loanFor.id) await openDetail(loanFor);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save loan.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAdvance(row, advanceId) {
    if (!window.confirm('Remove this advance? Remaining salary will update.')) return;
    try {
      await api.delete(`/api/admin/employees/${row.id}/advances/${advanceId}`);
      setSuccess('Advance removed.');
      await loadPayroll(month);
      await openDetail(row);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove advance.');
    }
  }

  async function removeLoan(row, loanId) {
    if (!window.confirm('Remove this loan and its remaining installments?')) return;
    try {
      await api.delete(`/api/admin/employees/${row.id}/loans/${loanId}`);
      setSuccess('Loan removed.');
      await loadPayroll(month);
      await openDetail(row);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove loan.');
    }
  }

  async function handleExport(format) {
    setExporting(format);
    setError('');
    try {
      const filename = await downloadPayroll(format, month);
      setSuccess(`Downloaded ${filename}`);
    } catch (err) {
      const fromBody = await readErrorBody(err.response?.data);
      const status = err.response?.status;
      const message =
        fromBody ||
        err.message ||
        (status ? `Export failed (${status}).` : 'Export failed.');
      setError(message);
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="lower-payroll">
      <div className="lower-payroll-bar">
        <label className="lower-payroll-month">
          <span>Salary month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={loadingPay}
          />
        </label>
        <p className="muted lower-payroll-hint">
          Remaining salary = monthly salary minus advances and loan installments in this month.
        </p>
        <div className="lower-payroll-export">
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(exporting) || employees.length === 0}
            onClick={() => handleExport('xlsx')}
          >
            {exporting === 'xlsx' ? 'Preparing Excel…' : 'Download Excel'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={Boolean(exporting) || employees.length === 0}
            onClick={() => handleExport('pdf')}
          >
            {exporting === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {error && !advanceFor && !loanFor && !hubFor ? <p className="error">{error}</p> : null}

      <div className="lower-staff-cards">
        {employees.map((row) => {
          const pay = payFor(payroll, row.id);
          const remaining = pay ? pay.remaining : null;
          return (
            <article
              key={row.id}
              className={`lower-staff-card${hubFor?.id === row.id ? ' is-open' : ''}`}
              onClick={canManage ? () => openHub(row) : undefined}
            >
              {canManage ? (
                <button
                  type="button"
                  className="btn btn-primary lower-staff-edit-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    openHub(row);
                  }}
                >
                  Edit
                </button>
              ) : null}
              <div className="lower-staff-card-body">
                <strong className="lower-staff-card-name">{fullName(row)}</strong>
                <p className="muted">
                  {[row.designation, row.shift, row.branch || 'No branch']
                    .filter(Boolean)
                    .join(' · ')}
                  {` · salary ${formatSalaryAmount(row.salary)}`}
                </p>
                <span className="lower-pill-row">
                  {pay?.has_advance ? (
                    <span className="lower-pill">{moneyLabel(pay.advance_amount)} advance</span>
                  ) : null}
                  {pay?.has_loan ? (
                    <span className="lower-pill lower-pill-cyan">{moneyLabel(pay.loan_amount)} loan</span>
                  ) : pay?.open_loans ? (
                    <span className="lower-pill lower-pill-cyan">Open loan</span>
                  ) : null}
                  {!pay?.has_advance && !pay?.has_loan && !pay?.open_loans ? (
                    <span className="muted-cell">No advance or loan this month</span>
                  ) : null}
                </span>
              </div>
              <div className={`lower-staff-remain-box${remaining < 0 ? ' is-over' : ''}`}>
                <span>Remaining this month</span>
                <strong>
                  {pay
                    ? moneyLabel(remaining)
                    : loadingPay
                      ? '…'
                      : formatSalaryAmount(row.salary)}
                </strong>
              </div>
            </article>
          );
        })}
      </div>

      {hubFor ? (
        <PortalModal>
        <div className="modal-backdrop modal-backdrop-stack lower-staff-portal" onClick={closeHub}>
          <div
            className="modal-panel modal-panel-center lower-staff-hub"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${fullName(hubFor)}`}
          >
            <div className="modal-header">
              <div>
                <h2>{fullName(hubFor)}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  {[hubFor.designation, hubFor.shift, hubFor.branch || 'No branch']
                    .filter(Boolean)
                    .join(' · ')}
                  {` · salary ${formatSalaryAmount(hubFor.salary)}`}
                  {payFor(payroll, hubFor.id)
                    ? ` · ${moneyLabel(payFor(payroll, hubFor.id).remaining)} left this month`
                    : ''}
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={closeHub} aria-label="Close">
                ×
              </button>
            </div>
            <div className="lower-staff-hub-actions">
              <button type="button" className="btn btn-primary" onClick={() => openAdvance(hubFor)}>
                Advance salary
              </button>
              <button type="button" className="btn btn-primary" onClick={() => openLoan(hubFor)}>
                Loan
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => openDetail(hubFor)}>
                Salary details
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={deletingId === hubFor.id}
                onClick={() => {
                  setHubFor(null);
                  setAdvanceFor(null);
                  setLoanFor(null);
                  setDetailFor(null);
                  setDetail(null);
                  onEdit(hubFor);
                }}
              >
                Edit details
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deletingId === hubFor.id}
                onClick={async () => {
                  const removed = await onDelete(hubFor);
                  if (removed) closeHub();
                }}
              >
                {deletingId === hubFor.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
            {extraSlotSummary(hubFor, 1) || extraSlotSummary(hubFor, 2) || hubFor.cnic_front_url ? (
              <p className="muted lower-staff-hub-meta">
                {[extraSlotSummary(hubFor, 1), extraSlotSummary(hubFor, 2)].filter(Boolean).join(' · ')
                  || 'Record on file'}
              </p>
            ) : null}
          </div>
        </div>
        </PortalModal>
      ) : null}

      {advanceFor ? (
        <PortalModal>
        <div className="modal-backdrop modal-backdrop-stack lower-pay-stack lower-staff-portal" onClick={() => !saving && setAdvanceFor(null)}>
          <form className="modal-panel modal-panel-center lower-pay-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitAdvance}>
            <h2>Advance salary</h2>
            <p className="muted">
              For {fullName(advanceFor)}. Date defaults to today. Change it if this advance belongs to another day.
            </p>
            <label>
              Amount
              <input
                type="number"
                min="1"
                step="1"
                required
                value={advanceForm.amount}
                onChange={(e) => setAdvanceForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="Enter amount"
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={advanceForm.paid_on}
                onChange={(e) => setAdvanceForm((f) => ({ ...f, paid_on: e.target.value }))}
              />
            </label>
            <label>
              Remarks <span className="muted">(optional)</span>
              <textarea
                rows={3}
                maxLength={500}
                value={advanceForm.remarks}
                onChange={(e) => setAdvanceForm((f) => ({ ...f, remarks: e.target.value }))}
                placeholder="Reason or note"
              />
            </label>
            {advancePreview ? (
              <p className={`lower-pay-preview${advancePreview.remaining < 0 ? ' is-over' : ''}`}>
                {advancePreview.hitsMonth
                  ? `Remaining salary this month after this advance: ${moneyLabel(advancePreview.remaining)}`
                  : `This date is in ${monthKeyFromDate(advanceForm.paid_on)}. It will deduct from that month, not ${month}.`}
              </p>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setAdvanceFor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save advance'}
              </button>
            </div>
          </form>
        </div>
        </PortalModal>
      ) : null}

      {loanFor ? (
        <PortalModal>
        <div className="modal-backdrop modal-backdrop-stack lower-pay-stack lower-staff-portal" onClick={() => !saving && setLoanFor(null)}>
          <form className="modal-panel modal-panel-center lower-pay-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitLoan}>
            <h2>Loan</h2>
            <p className="muted">
              For {fullName(loanFor)}. Enter the amount and how many months to repay. Monthly installment is calculated
              for you.
            </p>
            <label>
              Amount
              <input
                type="number"
                min="1"
                step="1"
                required
                value={loanForm.amount}
                onChange={(e) => setLoanForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="Enter amount"
              />
            </label>
            <label>
              No. of installments
              <input
                type="number"
                min="1"
                max="36"
                step="1"
                required
                value={loanForm.installments}
                onChange={(e) => setLoanForm((f) => ({ ...f, installments: e.target.value }))}
              />
            </label>
            <label>
              First month
              <input
                type="month"
                required
                value={loanForm.start_month}
                onChange={(e) => setLoanForm((f) => ({ ...f, start_month: e.target.value }))}
              />
            </label>
            <label>
              Remarks <span className="muted">(optional)</span>
              <textarea
                rows={3}
                maxLength={500}
                value={loanForm.remarks}
                onChange={(e) => setLoanForm((f) => ({ ...f, remarks: e.target.value }))}
                placeholder="Reason or note"
              />
            </label>
            {loanPreview ? (
              <div className={`lower-pay-preview${loanPreview.remaining < 0 ? ' is-over' : ''}`}>
                <p>
                  <strong>{moneyLabel(loanPreview.monthly)}</strong> per month for {loanPreview.count} months.
                </p>
                <p>
                  Remaining salary {loanForm.start_month === month ? 'this month' : 'in the first month'} after this
                  installment: <strong>{moneyLabel(loanPreview.remaining)}</strong>
                </p>
              </div>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setLoanFor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save loan'}
              </button>
            </div>
          </form>
        </div>
        </PortalModal>
      ) : null}

      {detailFor ? (
        <PortalModal>
        <div className="modal-backdrop modal-backdrop-stack lower-pay-stack lower-staff-portal" onClick={() => setDetailFor(null)}>
          <div className="modal-panel modal-panel-center lower-pay-detail" onClick={(e) => e.stopPropagation()}>
            <h2>{fullName(detailFor)}</h2>
            <p className="muted">
              Monthly salary {formatSalaryAmount(detailFor.salary)}
              {detail ? ` · remaining this month ${moneyLabel(detail.remaining_this_month)}` : ''}
            </p>
            {!detail ? <p className="muted">Loading…</p> : null}
            {detail ? (
              <>
                <h3>Each month</h3>
                <ol className="lower-pay-months">
                  {detail.months.map((row) => (
                    <li key={row.month_key}>
                      <div>
                        <strong>{row.month_label}</strong>
                        <span className={row.remaining < 0 ? 'is-over' : ''}>
                          {moneyLabel(row.remaining)} remaining
                        </span>
                      </div>
                      <p className="muted">
                        Salary {moneyLabel(row.salary)}
                        {row.has_advance ? ` · advance ${moneyLabel(row.advance_amount)}` : ''}
                        {row.has_loan ? ` · loan ${moneyLabel(row.loan_amount)}` : ''}
                        {!row.has_advance && !row.has_loan ? ' · no advance or loan' : ''}
                      </p>
                    </li>
                  ))}
                </ol>
                <h3>Advances</h3>
                {(detail.advances || []).length === 0 ? (
                  <p className="muted">No advance salary yet.</p>
                ) : (
                  <ul className="lower-pay-list">
                    {detail.advances.map((item) => (
                      <li key={item.id}>
                        <span>
                          {moneyLabel(item.amount)} on {item.paid_on} ({item.month_label})
                          {item.remarks ? <em className="muted"> · {item.remarks}</em> : null}
                        </span>
                        <button type="button" className="btn btn-ghost" onClick={() => removeAdvance(detailFor, item.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>Loans</h3>
                {(detail.loans || []).length === 0 ? (
                  <p className="muted">No loan yet.</p>
                ) : (
                  <ul className="lower-pay-list">
                    {detail.loans.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{moneyLabel(item.amount)}</strong>
                          {` · ${item.installments} months · ${moneyLabel(item.monthly_amount)} / month`}
                          <p className="muted">
                            Started {item.start_month_label}. Remaining {moneyLabel(item.remaining_amount)} (
                            {item.remaining_installments} left).
                            {item.remarks ? ` Remarks: ${item.remarks}` : ''}
                          </p>
                        </div>
                        <button type="button" className="btn btn-ghost" onClick={() => removeLoan(detailFor, item.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDetailFor(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
        </PortalModal>
      ) : null}
    </div>
  );
}
