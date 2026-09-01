import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import './AdminDashboard.css';

const EMPTY_FORM = {
  name: '',
  start_time: '09:00',
  late_after: '09:15',
  absent_after: '11:00',
};

export default function ShiftsPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const canManage = hasPermission(permissions, 'hr:add_employee', role);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/shifts');
      setShifts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load shifts.');
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
        if (!canAccessAdmin(data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
      } catch {
        if (!active) return;
        localStorage.removeItem('token');
        navigate('/', { replace: true });
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
    if (!checking && role) loadShifts();
  }, [checking, role, loadShifts]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!canManage) {
      setError('Only HR and CEO can manage shifts.');
      return;
    }
    if (!form.name.trim()) {
      setError('Enter a shift name.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        name: form.name.trim(),
        start_time: form.start_time,
        late_after: form.late_after,
        absent_after: form.absent_after,
      };
      if (editingId) {
        const { data } = await api.put(`/api/admin/shifts/${editingId}`, payload);
        setShifts((prev) =>
          prev
            .map((s) => (s.id === data.id ? data : s))
            .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
        );
        setSuccess(`Shift “${data.name}” updated.`);
      } else {
        const { data } = await api.post('/api/admin/shifts', payload);
        setShifts((prev) =>
          [...prev, data].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
        );
        setSuccess(`Shift “${data.name}” created.`);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save shift.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(shift) {
    setEditingId(shift.id);
    setForm({
      name: shift.name || '',
      start_time: shift.start_time || '09:00',
      late_after: shift.late_after || '09:15',
      absent_after: shift.absent_after || '11:00',
    });
    setError('');
    setSuccess('');
  }

  async function handleDelete(shift) {
    if (!canManage || !shift?.id) return;
    const ok = window.confirm(
      `Delete shift “${shift.name}”? People already assigned this shift keep their current value until you change it.`
    );
    if (!ok) return;
    setDeletingId(shift.id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/admin/shifts/${shift.id}`);
      setShifts((prev) => prev.filter((s) => s.id !== shift.id));
      if (editingId === shift.id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      setSuccess(data.message || `Shift “${shift.name}” deleted.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete shift.');
    } finally {
      setDeletingId(null);
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
          <h1>Manage Shifts</h1>
          <p className="muted" style={{ margin: 0 }}>
            Start, late, and absent times used for onsite check-in. Times are in Pakistan time.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadShifts}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {canManage && (
        <form className="form" onSubmit={handleSave} style={{ maxWidth: 480, marginBottom: '1.25rem' }}>
          <label>
            {editingId ? 'Edit shift name' : 'New shift name'}
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Morning"
              disabled={saving}
            />
          </label>
          <label>
            Shift start
            <input
              type="time"
              name="start_time"
              value={form.start_time}
              onChange={handleChange}
              disabled={saving}
              required
            />
          </label>
          <label>
            Late after
            <input
              type="time"
              name="late_after"
              value={form.late_after}
              onChange={handleChange}
              disabled={saving}
              required
            />
          </label>
          <label>
            Absent after
            <input
              type="time"
              name="absent_after"
              value={form.absent_after}
              onChange={handleChange}
              disabled={saving}
              required
            />
          </label>
          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save shift' : 'Add shift'}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      )}

      {!canManage && (
        <p className="muted">You can view shifts. Only HR and CEO can create or edit them.</p>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && shifts.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading shifts…
        </div>
      )}

      {!loading && shifts.length === 0 && !error && (
        <div className="admin-empty">No shifts yet. Add Morning / Evening / Night with your own times.</div>
      )}

      {shifts.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>Late after</th>
                <th>Absent after</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td className="cell-name">{s.name}</td>
                  <td>{s.start_time || '—'}</td>
                  <td>{s.late_after || '—'}</td>
                  <td>{s.absent_after || '—'}</td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={saving || deletingId === s.id}
                        onClick={() => startEdit(s)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={deletingId === s.id || saving}
                        onClick={() => handleDelete(s)}
                      >
                        {deletingId === s.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
