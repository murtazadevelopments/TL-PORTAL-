import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, canReviewLeaveRequests } from '../../utils/permissions';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import { useFlashSuccess } from '../../utils/successPopup';
import './AdminDashboard.css';

function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  return 'Pending';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString();
}

export default function LeaveRequestsPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('pending');
  const [actingId, setActingId] = useState(null);
  const [remarksById, setRemarksById] = useState({});
  useFlashSuccess(success);

  const load = useCallback(async (status) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/leave-requests', {
        params: { status: status || 'all' },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load leave requests.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!canAccessAdmin(data.role) || !canReviewLeaveRequests(data.role, data.permissions)) {
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch {
        if (!active) return;
        localStorage.removeItem('token');
        navigate('/', { replace: true });
        return;
      } finally {
        if (active) setChecking(false);
      }
    }
    verify();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (checking) return;
    load(filter);
  }, [checking, filter, load]);

  async function decide(row, decision) {
    if (!row?.id) return;
    setActingId(row.id);
    setError('');
    setSuccess('');
    try {
      const remarks = String(remarksById[row.id] || '').trim();
      const { data } = await api.post(`/api/leave-requests/${row.id}/${decision}`, {
        remarks: remarks || undefined,
      });
      setSuccess(data?.message || (decision === 'approve' ? 'Approved.' : 'Rejected.'));
      setRemarksById((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load(filter);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update leave request.');
    } finally {
      setActingId(null);
    }
  }

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <div className="admin-loading">
          <div className="spinner" />
          Checking access…
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Leave requests</h1>
          <p className="muted" style={{ margin: 0 }}>
            Review medical leave for remote and onsite employees. Prescription required.
          </p>
        </div>
        <div className="status-tabs" role="tablist" aria-label="Leave status">
          {[
            { id: 'pending', label: 'Pending' },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
            { id: 'all', label: 'All' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`status-tab${filter === tab.id ? ' active' : ''}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="muted">No leave requests in this view.</p>
      )}

      <div className="detail-grid" style={{ marginTop: '1rem', gap: '1rem' }}>
        {rows.map((row) => {
          const pending = String(row.status).toLowerCase() === 'pending';
          const prescriptionHref = withAuthDocumentUrl(
            row.prescription_url,
            row.updated_at || row.id
          );
          return (
            <article
              key={row.id}
              className="card"
              style={{ padding: '1rem', margin: 0, border: '1px solid var(--border)' }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' }}>
                <div>
                  <strong>{row.employee_name || row.employee_username || 'Employee'}</strong>
                  <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                    {row.employee_id_code || 'No employee ID'} ·{' '}
                    {row.employment_type === 'remote' ? 'Remote' : 'Onsite'}
                    {row.department ? ` · ${row.department}` : ''}
                    {row.branch ? ` · ${row.branch}` : ''}
                  </p>
                </div>
                <strong className="muted">{statusLabel(row.status)}</strong>
              </div>

              <div className="detail-grid" style={{ marginTop: '0.85rem' }}>
                <p>
                  <span className="label">Leave type</span>
                  <strong>
                    {row.leave_type_label ||
                      (row.leave_type === 'annual' ? 'Annual leave' : 'Sick leave')}
                  </strong>
                </p>
                <p>
                  <span className="label">From</span>
                  <strong>{formatDate(row.start_date)}</strong>
                </p>
                <p>
                  <span className="label">To</span>
                  <strong>{formatDate(row.end_date)}</strong>
                </p>
                <p>
                  <span className="label">Submitted</span>
                  <strong>
                    {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                  </strong>
                </p>
                {!pending && (
                  <p>
                    <span className="label">Reviewed</span>
                    <strong>
                      {row.reviewer_name || '—'}
                      {row.reviewed_at
                        ? ` · ${new Date(row.reviewed_at).toLocaleString()}`
                        : ''}
                    </strong>
                  </p>
                )}
              </div>

              {row.admin_remarks ? (
                <p style={{ marginTop: '0.75rem' }}>
                  <span className="label">Remarks</span>
                  <strong style={{ display: 'block' }}>{row.admin_remarks}</strong>
                </p>
              ) : null}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                {prescriptionHref ? (
                  <a
                    className="btn btn-ghost"
                    href={prescriptionHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View prescription
                  </a>
                ) : (
                  <span className="muted">No prescription on file</span>
                )}
              </div>

              {pending && (
                <div className="leave-review-actions">
                  <label className="leave-remarks-field">
                    <span>Remarks (optional)</span>
                    <textarea
                      rows={3}
                      value={remarksById[row.id] || ''}
                      onChange={(e) =>
                        setRemarksById((prev) => ({
                          ...prev,
                          [row.id]: e.target.value.slice(0, 1000),
                        }))
                      }
                      placeholder="Optional note for the employee"
                      disabled={actingId === row.id}
                    />
                  </label>
                  <div className="leave-review-buttons">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={actingId === row.id}
                      onClick={() => decide(row, 'approve')}
                    >
                      {actingId === row.id ? 'Saving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={actingId === row.id}
                      onClick={() => decide(row, 'reject')}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
