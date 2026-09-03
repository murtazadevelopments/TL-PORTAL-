import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission, isCeo } from '../../utils/permissions';
import './AdminDashboard.css';

function ipsFromBranch(branch) {
  if (Array.isArray(branch?.ip_addresses) && branch.ip_addresses.length) {
    return branch.ip_addresses.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(branch?.ip_address || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function BranchesPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editIps, setEditIps] = useState(['']);
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [editRadius, setEditRadius] = useState('150');
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission(permissions, 'branches:create', role);
  const canEditAllIps =
    isCeo(role) ||
    hasPermission(permissions, 'branches:create', role) ||
    hasPermission(permissions, 'hr:add_employee', role);

  function canEditBranchIp(branch) {
    return Boolean(canEditAllIps || branch?.can_edit_ip);
  }

  const loadBranches = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/branches');
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load branches.');
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
    if (!checking && role) loadBranches();
  }, [checking, role, loadBranches]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError('Enter a branch name.');
      return;
    }
    if (!canManage) {
      setError('You do not have permission to manage branches.');
      return;
    }
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/api/admin/branches', { name, ip_addresses: [] });
      setBranches((prev) =>
        [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      setNewName('');
      setSuccess(`Branch “${data.name}” created. Add office IPs or GPS with Edit check-in.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create branch.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(branch) {
    if (!canManage || !branch?.id) return;
    const ok = window.confirm(
      `Delete branch “${branch.name}”? People already assigned this branch keep their current value until you change it.`
    );
    if (!ok) return;

    setDeletingId(branch.id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/admin/branches/${branch.id}`);
      setBranches((prev) => prev.filter((b) => b.id !== branch.id));
      if (editing?.id === branch.id) closeEditor();
      setSuccess(data.message || `Branch “${branch.name}” deleted.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete branch.');
    } finally {
      setDeletingId(null);
    }
  }

  function openEditor(branch) {
    if (!canEditBranchIp(branch)) return;
    const ips = ipsFromBranch(branch);
    setEditing(branch);
    setEditIps(ips.length ? ips : ['']);
    setEditLat(branch?.latitude == null || branch?.latitude === '' ? '' : String(branch.latitude));
    setEditLng(branch?.longitude == null || branch?.longitude === '' ? '' : String(branch.longitude));
    setEditRadius(
      branch?.radius_meters == null || branch?.radius_meters === ''
        ? '150'
        : String(branch.radius_meters)
    );
    setError('');
    setSuccess('');
  }

  function closeEditor() {
    setEditing(null);
    setEditIps(['']);
    setEditLat('');
    setEditLng('');
    setEditRadius('150');
  }

  async function handleSaveIps(e) {
    e.preventDefault();
    if (!editing?.id || !canEditBranchIp(editing)) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const ips = editIps.map((s) => String(s).trim()).filter(Boolean);
      const { data } = await api.patch(`/api/admin/branches/${editing.id}`, {
        ip_addresses: ips,
        latitude: editLat.trim() === '' ? null : Number(editLat),
        longitude: editLng.trim() === '' ? null : Number(editLng),
        radius_meters: editRadius.trim() === '' ? 150 : Number(editRadius),
      });
      setBranches((prev) => prev.map((b) => (b.id === data.id ? { ...b, ...data } : b)));
      closeEditor();
      const geoSet = data.latitude != null && data.longitude != null;
      setSuccess(
        [
          ips.length
            ? `Saved ${ips.length} office IP${ips.length === 1 ? '' : 's'}`
            : 'Cleared office IPs',
          geoSet
            ? `and location (${data.radius_meters || 150} m)`
            : 'and cleared GPS location',
          `for “${data.name}”.`,
        ].join(' ')
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save office IPs.');
    } finally {
      setSaving(false);
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
    <div className="admin-page page-panel branches-page">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Manage Branches</h1>
          <p className="muted" style={{ margin: 0 }}>
            Offices used on employee records. For onsite check-in, add each office’s public IP
            (whatismyip on that Wi‑Fi) and/or GPS coordinates — employees can check in if either
            matches.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadBranches}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {canManage && (
        <form className="form branches-add-form" onSubmit={handleCreate}>
          <label>
            New branch name
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Head Office"
              disabled={creating}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Adding…' : 'Add branch'}
          </button>
        </form>
      )}

      {!canManage && (
        <p className="muted">You can view branches. CEO / HR can add offices and set IPs.</p>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && branches.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading branches…
        </div>
      )}

      {!loading && branches.length === 0 && !error && (
        <div className="admin-empty">No branches yet.</div>
      )}

      {branches.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Office IPs</th>
                <th>GPS</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const ips = ipsFromBranch(b);
                return (
                  <tr key={b.id}>
                    <td className="cell-name">{b.name}</td>
                    <td>
                      {canEditBranchIp(b) ? (
                        ips.length ? (
                          <div className="branch-ip-chips">
                            {ips.map((ip) => (
                              <code key={ip} className="branch-ip-chip" title={ip}>
                                {ip}
                              </code>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">Not set</span>
                        )
                      ) : b.ip_configured ? (
                        <span className="muted">Configured</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {b.latitude != null && b.longitude != null ? (
                        <span title={`${b.latitude}, ${b.longitude}`}>
                          {Number(b.latitude).toFixed(5)}, {Number(b.longitude).toFixed(5)}
                          <span className="muted"> · {b.radius_meters || 150} m</span>
                        </span>
                      ) : (
                        <span className="muted">Not set</span>
                      )}
                    </td>
                    <td className="branches-date">
                      {b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="branches-actions">
                      {canEditBranchIp(b) && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={saving || creating}
                          onClick={() => openEditor(b)}
                        >
                          Edit check-in
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={deletingId === b.id || creating}
                          onClick={() => handleDelete(b)}
                        >
                          {deletingId === b.id ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={closeEditor}>
          <form className="modal-card branches-ip-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSaveIps}>
            <h2>Office check-in</h2>
            <p className="muted">
              {editing.name} — add every public IPv4, or an IPv6 prefix like 2407:aa80:14:3c96::/64.
              Check-in matches any exact IP or prefix, or GPS within the radius below.
            </p>
            <div className="branches-ip-list">
              {(editIps.length ? editIps : ['']).map((ip, idx) => (
                <div key={`${editing.id}-edit-${idx}`} className="branch-ip-row">
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) =>
                      setEditIps((prev) => {
                        const next = [...prev];
                        next[idx] = e.target.value;
                        return next;
                      })
                    }
                    placeholder="e.g. 203.0.113.10 or 2407:aa80:14:3c96::/64"
                    autoComplete="off"
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saving || editIps.length <= 1}
                    onClick={() =>
                      setEditIps((prev) => {
                        const next = prev.filter((_, i) => i !== idx);
                        return next.length ? next : [''];
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving || editIps.length >= 20}
              onClick={() => setEditIps((prev) => [...prev, ''])}
            >
              Add another IP
            </button>
            <div className="branches-geo-fields">
              <label>
                Latitude
                <input
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={editLat}
                  onChange={(e) => setEditLat(e.target.value)}
                  placeholder="e.g. 24.86148"
                  disabled={saving}
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={editLng}
                  onChange={(e) => setEditLng(e.target.value)}
                  placeholder="e.g. 67.00991"
                  disabled={saving}
                />
              </label>
              <label>
                Radius (meters)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={editRadius}
                  onChange={(e) => setEditRadius(e.target.value)}
                  placeholder="150"
                  disabled={saving}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={closeEditor}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
