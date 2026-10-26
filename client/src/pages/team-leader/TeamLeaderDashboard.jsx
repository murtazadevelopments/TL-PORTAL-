import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { useFlashSuccess } from '../../utils/successPopup';
import TeamFilterSelect from '../../components/TeamFilterSelect';
import { matchesTeamFilter } from '../../utils/teamNames';
import PasswordInput from '../../components/PasswordInput';
import '../admin/AdminDashboard.css';
import './TeamLeaderDashboard.css';

const SECTIONS = [
  { id: 'all', label: 'All' },
  { id: 'merchant', label: 'Merchant Wise' },
];

let tempSeq = 0;
function tempId(prefix) {
  tempSeq += 1;
  return `temp-${prefix}-${Date.now()}-${tempSeq}`;
}

function linkHref(value) {
  const v = String(value || '').trim();
  if (!v) return '#';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      className="tl-copy-btn"
      title={copied ? 'Copied' : `Copy ${label || 'value'}`}
      aria-label={`Copy ${label || 'value'}`}
      onClick={handleCopy}
    >
      {copied ? (
        <span className="tl-copy-done">Copied</span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="9"
            y="9"
            width="13"
            height="13"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      )}
    </button>
  );
}

function TPinModal({ open, title, onCancel, onConfirm, busy }) {
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) {
      setPin('');
      setLocalError('');
    }
  }, [open]);

  if (!open) return null;

  function submit(e) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin.trim())) {
      setLocalError('Enter your 4–8 digit T-Pin.');
      return;
    }
    onConfirm(pin.trim());
  }

  return (
    <div className="tl-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="tl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tl-tpin-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tl-tpin-title">{title || 'Confirm with T-Pin'}</h2>
        <p className="muted">Enter your T-Pin to save all changes on this tab.</p>
        <form className="form" onSubmit={submit}>
          <PasswordInput
            label="T-Pin"
            name="t_pin"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            disabled={busy}
            autoFocus
            maxLength={8}
          />
          {localError && <p className="error">{localError}</p>}
          <div className="tl-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Confirm & save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function normalizeCategories(list) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    id: c.id,
    name: c.name || '',
    items: (c.items || []).map((it) => {
      const value = it.value || it.label || '';
      const label = String(it.label || '').trim();
      return {
        id: it.id,
        value,
        label: label && label !== value ? label : '',
        item_type: 'link',
      };
    }),
    assignees: Array.isArray(c.assignees) ? c.assignees : [],
  }));
}

export default function TeamLeaderDashboard() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [tPinConfigured, setTPinConfigured] = useState(false);
  const [section, setSection] = useState('all');
  const [categories, setCategories] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useFlashSuccess(success);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [linkDrafts, setLinkDrafts] = useState({});
  const [labelDrafts, setLabelDrafts] = useState({});
  const [openIds, setOpenIds] = useState(() => new Set());
  const [editingCats, setEditingCats] = useState(() => new Set());
  const [editingItem, setEditingItem] = useState(null);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [assignTeam, setAssignTeam] = useState('all');
  const [assignCategory, setAssignCategory] = useState(null);
  const [selectedAssignees, setSelectedAssignees] = useState([]);

  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupForm, setSetupForm] = useState({
    current_password: '',
    current_t_pin: '',
    t_pin: '',
    confirm: '',
  });
  const [setupBusy, setSetupBusy] = useState(false);
  const [tPinForgot, setTPinForgot] = useState(false);
  const [tPinOtpSent, setTPinOtpSent] = useState(false);
  const [tPinOtpVerified, setTPinOtpVerified] = useState(false);
  const [tPinOtp, setTPinOtp] = useState('');
  const [tPinEmailHint, setTPinEmailHint] = useState('');
  const [setupHint, setSetupHint] = useState('');

  function resetTPinSetupForm() {
    setSetupForm({
      current_password: '',
      current_t_pin: '',
      t_pin: '',
      confirm: '',
    });
    setTPinForgot(false);
    setTPinOtpSent(false);
    setTPinOtpVerified(false);
    setTPinOtp('');
    setTPinEmailHint('');
    setSetupHint('');
  }

  const sectionLabel = useMemo(
    () => SECTIONS.find((s) => s.id === section)?.label || section,
    [section]
  );

  const markDirty = useCallback(() => {
    setDirty(true);
    setSuccess('');
  }, []);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/tl-dashboard', { params: { section } });
      setCategories(normalizeCategories(data.categories));
      setCanManage(Boolean(data.canManage));
      setDirty(false);
      setLinkDrafts({});
      setLabelDrafts({});
      setEditingCats(new Set());
      setEditingItem(null);
      const next = normalizeCategories(data.categories);
      // Open first category by default
      setOpenIds(next.length ? new Set([String(next[0].id)]) : new Set());
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard.');
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const { data } = await api.get('/api/tl-dashboard/access');
        if (!active) return;
        if (!data.access) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setCanManage(Boolean(data.canManage));
        setTPinConfigured(Boolean(data.tPinConfigured));
        if (data.canManage) {
          try {
            const users = await api.get('/api/tl-dashboard/assignable-users');
            if (active) setAssignableUsers(Array.isArray(users.data) ? users.data : []);
          } catch {
            /* optional */
          }
        }
      } catch {
        if (!active) return;
        navigate('/dashboard', { replace: true });
        return;
      } finally {
        if (active) setChecking(false);
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (checking) return;
    if (canManage && !tPinConfigured) return;
    loadBoard();
  }, [checking, canManage, tPinConfigured, loadBoard]);

  function switchSection(next) {
    if (next === section) return;
    if (canManage && dirty) {
      const ok = window.confirm(
        'You have unsaved changes on this tab. Switch anyway and discard them?'
      );
      if (!ok) return;
    }
    setSection(next);
    setError('');
    setSuccess('');
  }

  async function handleSetupTPin(e) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(setupForm.t_pin)) {
      setError('T-Pin must be 4–8 digits.');
      return;
    }
    if (setupForm.t_pin !== setupForm.confirm) {
      setError('T-Pin confirmation does not match.');
      return;
    }
    setSetupBusy(true);
    setError('');
    try {
      const body = { t_pin: setupForm.t_pin };
      if (tPinOtpVerified) {
        /* email OTP already verified — server uses the reset window */
      } else if (tPinConfigured) body.current_t_pin = setupForm.current_t_pin;
      else body.current_password = setupForm.current_password;
      await api.post('/api/tl-dashboard/t-pin', body);
      setTPinConfigured(true);
      setSetupOpen(false);
      resetTPinSetupForm();
      setSuccess('T-Pin saved. You can manage the dashboard now.');
    } catch (err) {
      setSetupHint('');
      setError(err.response?.data?.message || 'Failed to save T-Pin.');
    } finally {
      setSetupBusy(false);
    }
  }

  function handleCreateCategory(e) {
    e.preventDefault();
    if (!canManage) return;
    const name = newCategoryName.trim();
    if (!name) {
      setError('Enter a category name.');
      return;
    }
    const id = tempId('cat');
    setCategories((prev) => [...prev, { id, name, items: [], assignees: [] }]);
    setOpenIds((prev) => new Set([...prev, String(id)]));
    setEditingCats((prev) => new Set([...prev, String(id)]));
    setNewCategoryName('');
    markDirty();
    setError('');
  }

  function handleRenameCategory(cat) {
    if (!canManage) return;
    const name = window.prompt('Rename category', cat.name);
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories((prev) =>
      prev.map((c) => (c.id === cat.id ? { ...c, name: trimmed } : c))
    );
    markDirty();
  }

  function handleDeleteCategory(cat) {
    if (!canManage) return;
    if (!window.confirm(`Remove category “${cat.name}” from this draft?`)) return;
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.delete(String(cat.id));
      return next;
    });
    setEditingCats((prev) => {
      const next = new Set(prev);
      next.delete(String(cat.id));
      return next;
    });
    setEditingItem((prev) =>
      prev && String(prev.catId) === String(cat.id) ? null : prev
    );
    markDirty();
  }

  function toggleAccordion(catId) {
    const key = String(catId);
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleAddLink(cat) {
    if (!canManage) return;
    const link = String(linkDrafts[cat.id] || '').trim();
    const label = String(labelDrafts[cat.id] || '').trim();
    if (!link) {
      setError('Enter a link.');
      return;
    }
    setCategories((prev) =>
      prev.map((c) =>
        c.id === cat.id
          ? {
              ...c,
              items: [
                ...c.items,
                {
                  id: tempId('item'),
                  value: link,
                  label,
                  item_type: 'link',
                },
              ],
            }
          : c
      )
    );
    setLinkDrafts((prev) => ({ ...prev, [cat.id]: '' }));
    setLabelDrafts((prev) => ({ ...prev, [cat.id]: '' }));
    setOpenIds((prev) => new Set([...prev, String(cat.id)]));
    markDirty();
    setError('');
  }

  function handleDeleteItem(cat, item) {
    if (!canManage) return;
    setCategories((prev) =>
      prev.map((c) =>
        c.id === cat.id
          ? { ...c, items: c.items.filter((it) => it.id !== item.id) }
          : c
      )
    );
    setEditingItem((prev) =>
      prev && String(prev.catId) === String(cat.id) && String(prev.itemId) === String(item.id)
        ? null
        : prev
    );
    markDirty();
  }

  function isEditingCategory(cat) {
    return canManage && editingCats.has(String(cat.id));
  }

  function startEditCategory(cat) {
    if (!canManage) return;
    setEditingCats((prev) => new Set([...prev, String(cat.id)]));
    setOpenIds((prev) => new Set([...prev, String(cat.id)]));
  }

  function stopEditCategory(cat) {
    setEditingCats((prev) => {
      const next = new Set(prev);
      next.delete(String(cat.id));
      return next;
    });
    setEditingItem((prev) =>
      prev && String(prev.catId) === String(cat.id) ? null : prev
    );
  }

  function startEditItem(cat, item) {
    if (!canManage) return;
    setEditingItem({
      catId: cat.id,
      itemId: item.id,
      label: item.label || '',
      value: item.value || '',
    });
  }

  function saveEditItem() {
    if (!canManage || !editingItem) return;
    const value = String(editingItem.value || '').trim();
    if (!value) {
      setError('Enter a link.');
      return;
    }
    const label = String(editingItem.label || '').trim();
    setCategories((prev) =>
      prev.map((c) =>
        c.id === editingItem.catId
          ? {
              ...c,
              items: c.items.map((it) =>
                it.id === editingItem.itemId
                  ? { ...it, value, label: label && label !== value ? label : '' }
                  : it
              ),
            }
          : c
      )
    );
    setEditingItem(null);
    markDirty();
    setError('');
  }

  function openAssign(cat) {
    setAssignCategory(cat);
    setAssignTeam('all');
    setSelectedAssignees((cat.assignees || []).map((u) => u.id));
  }

  const visibleAssignable = useMemo(
    () => assignableUsers.filter((row) => matchesTeamFilter(row, assignTeam)),
    [assignableUsers, assignTeam]
  );

  function toggleAssignee(id) {
    setSelectedAssignees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function applyAssignmentsLocally() {
    if (!assignCategory) return;
    const selected = assignableUsers.filter((u) => selectedAssignees.includes(u.id));
    setCategories((prev) =>
      prev.map((c) =>
        c.id === assignCategory.id
          ? {
              ...c,
              assignees: selected.map((u) => ({
                id: u.id,
                name: u.name,
                username: u.username,
                email: u.email,
                role: u.role,
              })),
            }
          : c
      )
    );
    setAssignCategory(null);
    markDirty();
  }

  function requestSave() {
    if (!canManage || !tPinConfigured) return;
    if (!dirty) {
      setSuccess('Nothing to save.');
      return;
    }
    setSavePromptOpen(true);
  }

  async function confirmSaveWithTPin(tPin) {
    setSaveBusy(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        section,
        t_pin: tPin,
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          items: (c.items || []).map((it) => {
            const link = String(it.value || '').trim();
            const label = String(it.label || '').trim();
            return {
              id: it.id,
              label: label || link,
              value: link,
              item_type: 'link',
            };
          }),
          assignee_ids: (c.assignees || []).map((a) => a.id),
        })),
      };
      await api.post('/api/tl-dashboard/save', payload);
      setSavePromptOpen(false);
      setSuccess(`Saved ${sectionLabel} successfully.`);
      await loadBoard();
    } catch (err) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.message || 'Save failed.';
      setError(msg);
      if (code !== 'TPIN_INVALID') setSavePromptOpen(false);
    } finally {
      setSaveBusy(false);
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

  if (canManage && !tPinConfigured) {
    return (
      <div className="admin-page page-panel tl-page">
        <div className="admin-toolbar" style={{ marginTop: 0 }}>
          <div>
            <h1>Team Leader Dashboard</h1>
            <p className="muted" style={{ margin: 0 }}>
              Step 1 — create your T-Pin before managing categories and links.
            </p>
          </div>
        </div>

        <div className="tl-setup-card">
          <h2>Create T-Pin</h2>
          <p className="muted">
            You will enter this pin once when you click Save after finishing your work.
          </p>

          {error && <p className="error">{error}</p>}

          <form className="form tl-setup-form" onSubmit={handleSetupTPin}>
            <PasswordInput
              label="Account password"
              name="current_password"
              autoComplete="current-password"
              value={setupForm.current_password}
              onChange={(e) =>
                setSetupForm((f) => ({ ...f, current_password: e.target.value }))
              }
              required
              disabled={setupBusy}
            />
            <PasswordInput
              label="New T-Pin (4–8 digits)"
              name="t_pin"
              inputMode="numeric"
              autoComplete="new-password"
              value={setupForm.t_pin}
              onChange={(e) =>
                setSetupForm((f) => ({
                  ...f,
                  t_pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                }))
              }
              required
              disabled={setupBusy}
              maxLength={8}
            />
            <PasswordInput
              label="Confirm T-Pin"
              name="confirm_t_pin"
              inputMode="numeric"
              autoComplete="new-password"
              value={setupForm.confirm}
              onChange={(e) =>
                setSetupForm((f) => ({
                  ...f,
                  confirm: e.target.value.replace(/\D/g, '').slice(0, 8),
                }))
              }
              required
              disabled={setupBusy}
              maxLength={8}
            />
            <button type="submit" className="btn btn-primary" disabled={setupBusy}>
              {setupBusy ? 'Saving T-Pin…' : 'Save T-Pin & continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel tl-page">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Team Leader Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            {canManage
              ? 'Use Edit on a category to change it, then Save with your T-Pin. Team leaders only see copy.'
              : 'View and copy the links assigned to you.'}
          </p>
        </div>
        <div className="tl-toolbar-actions">
          {canManage && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  resetTPinSetupForm();
                  setError('');
                  setSetupOpen(true);
                }}
              >
                Change T-Pin
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loading || dirty}
                onClick={loadBoard}
                title={dirty ? 'Save or discard changes first' : 'Reload from server'}
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dirty || saveBusy}
                onClick={requestSave}
              >
                {dirty ? 'Save' : 'Saved'}
              </button>
            </>
          )}
          {!canManage && (
            <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadBoard}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      <div className="status-tabs" role="tablist" aria-label="Dashboard sections">
        {SECTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={section === tab.id}
            className={`status-tab${section === tab.id ? ' active' : ''}`}
            onClick={() => switchSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {canManage && dirty && (
        <div className="tl-unsaved">
          Unsaved changes on <strong>{sectionLabel}</strong>. Click <strong>Save</strong> when
          finished — you will be asked for your T-Pin.
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {canManage && (
        <form className="form tl-create-cat" onSubmit={handleCreateCategory}>
          <label>
            New category in {sectionLabel}
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={
                section === 'merchant' ? 'e.g. Merchant ABC' : 'e.g. Banking / Portal links'
              }
            />
          </label>
          <button type="submit" className="btn btn-primary">
            Add category
          </button>
        </form>
      )}

      {loading && categories.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading…
        </div>
      )}

      {!loading && categories.length === 0 && !error && (
        <div className="admin-empty">
          {canManage
            ? `No categories in ${sectionLabel} yet. Add one above, then Save.`
            : 'Nothing assigned to you in this tab yet.'}
        </div>
      )}

      <div className="tl-accordion">
        {categories.map((cat) => {
          const isOpen = openIds.has(String(cat.id));
          const linkCount = (cat.items || []).length;
          return (
            <div key={cat.id} className={`tl-acc-item${isOpen ? ' is-open' : ''}`}>
              <div className="tl-acc-header">
                <button
                  type="button"
                  className="tl-acc-trigger"
                  aria-expanded={isOpen}
                  onClick={() => toggleAccordion(cat.id)}
                >
                  <span className="tl-acc-chevron" aria-hidden="true">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span className="tl-acc-title">{cat.name}</span>
                  <span className="tl-acc-count">
                    {linkCount} link{linkCount === 1 ? '' : 's'}
                  </span>
                </button>
                {canManage && (
                  <div className="tl-category-actions" onClick={(e) => e.stopPropagation()}>
                    {isEditingCategory(cat) ? (
                      <>
                        <button type="button" className="btn btn-ghost" onClick={() => openAssign(cat)}>
                          Assign ({(cat.assignees || []).length})
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleRenameCategory(cat)}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleDeleteCategory(cat)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => stopEditCategory(cat)}
                        >
                          Done
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => startEditCategory(cat)}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="tl-acc-panel">
                  {isEditingCategory(cat) && (cat.assignees || []).length > 0 && (
                    <p className="tl-assignees muted">
                      Visible to:{' '}
                      {(cat.assignees || []).map((u) => u.name || u.username).join(', ')}
                    </p>
                  )}

                  <ul className="tl-item-list">
                    {(cat.items || []).map((item) => {
                      const itemEditing =
                        editingItem &&
                        String(editingItem.catId) === String(cat.id) &&
                        String(editingItem.itemId) === String(item.id);
                      return (
                      <li key={item.id} className="tl-item">
                        {itemEditing ? (
                          <div className="tl-item-edit">
                            <input
                              type="text"
                              placeholder="Label (optional)"
                              value={editingItem.label}
                              onChange={(e) =>
                                setEditingItem((prev) =>
                                  prev ? { ...prev, label: e.target.value } : prev
                                )
                              }
                            />
                            <input
                              type="url"
                              placeholder="https://…"
                              value={editingItem.value}
                              onChange={(e) =>
                                setEditingItem((prev) =>
                                  prev ? { ...prev, value: e.target.value } : prev
                                )
                              }
                            />
                            <div className="tl-item-edit-actions">
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={saveEditItem}
                              >
                                Update
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setEditingItem(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                        {item.label ? (
                          <p className="tl-item-label">{item.label}</p>
                        ) : null}
                        <div className="tl-item-value-row">
                          <a
                            href={linkHref(item.value)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {item.value}
                          </a>
                          <CopyButton value={item.value} label="link" />
                          {isEditingCategory(cat) && (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => startEditItem(cat, item)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => handleDeleteItem(cat, item)}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                          </>
                        )}
                      </li>
                      );
                    })}
                    {(cat.items || []).length === 0 && (
                      <li className="muted">No links yet.</li>
                    )}
                  </ul>

                  {isEditingCategory(cat) && (
                    <div className="tl-add-link">
                      <input
                        type="text"
                        placeholder="Label (optional)"
                        value={labelDrafts[cat.id] || ''}
                        onChange={(e) =>
                          setLabelDrafts((prev) => ({ ...prev, [cat.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddLink(cat);
                          }
                        }}
                      />
                      <div className="tl-add-link-row">
                        <input
                          type="url"
                          placeholder="Paste link (https://…)"
                          value={linkDrafts[cat.id] || ''}
                          onChange={(e) =>
                            setLinkDrafts((prev) => ({ ...prev, [cat.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddLink(cat);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleAddLink(cat)}
                        >
                          Add link
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canManage && dirty && (
        <div className="tl-save-bar">
          <span className="muted">When you are done editing this tab:</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveBusy}
            onClick={requestSave}
          >
            Save
          </button>
        </div>
      )}

      <TPinModal
        open={savePromptOpen}
        title={`Save ${sectionLabel}`}
        busy={saveBusy}
        onCancel={() => setSavePromptOpen(false)}
        onConfirm={confirmSaveWithTPin}
      />

      {setupOpen && tPinConfigured && (
        <div
          className="tl-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!setupBusy) setSetupOpen(false);
          }}
        >
          <div
            className="tl-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Change T-Pin</h2>
            <p className="muted">
              {tPinOtpVerified
                ? 'Code confirmed. Choose a new 4–8 digit T-Pin.'
                : tPinForgot
                  ? tPinOtpSent
                    ? `Enter the 6-digit code sent to ${tPinEmailHint || 'your email'}.`
                    : 'We will email a 6-digit code to reset your T-Pin.'
                  : 'Enter your current T-Pin, then choose a new 4–8 digit pin.'}
            </p>
            {setupHint ? <p className="success">{setupHint}</p> : null}
            {error ? <p className="error">{error}</p> : null}

            {!tPinForgot ? (
              <form className="form" onSubmit={handleSetupTPin}>
                <PasswordInput
                  label="Current T-Pin"
                  name="current_t_pin"
                  inputMode="numeric"
                  value={setupForm.current_t_pin}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      current_t_pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                  maxLength={8}
                />
                <button
                  type="button"
                  className="tl-forgot-link"
                  onClick={() => {
                    setError('');
                    setSetupHint('');
                    setTPinForgot(true);
                  }}
                >
                  Forgot T-Pin?
                </button>
                <PasswordInput
                  label="New T-Pin"
                  name="new_t_pin"
                  inputMode="numeric"
                  value={setupForm.t_pin}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      t_pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                  maxLength={8}
                />
                <PasswordInput
                  label="Confirm T-Pin"
                  name="confirm_t_pin"
                  inputMode="numeric"
                  value={setupForm.confirm}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      confirm: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                  maxLength={8}
                />
                <div className="tl-modal-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSetupOpen(false)}
                    disabled={setupBusy}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={setupBusy}>
                    {setupBusy ? 'Saving…' : 'Save T-Pin'}
                  </button>
                </div>
              </form>
            ) : !tPinOtpVerified ? (
              <form
                className="form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSetupBusy(true);
                  setError('');
                  setSetupHint('');
                  try {
                    if (!tPinOtpSent) {
                      const { data } = await api.post('/api/tl-dashboard/t-pin/otp');
                      setTPinEmailHint(data.email_hint || '');
                      setTPinOtpSent(true);
                      setSetupHint(data.message || 'Code sent to your email.');
                    } else {
                      const code = tPinOtp.replace(/\D/g, '');
                      if (!/^\d{6}$/.test(code)) {
                        setError('Enter the 6-digit code from your email.');
                        return;
                      }
                      const { data } = await api.post('/api/tl-dashboard/t-pin/otp/verify', {
                        otp: code,
                      });
                      setTPinOtpVerified(true);
                      setSetupHint(data.message || 'Code confirmed. Set a new T-Pin now.');
                    }
                  } catch (err) {
                    setError(err.response?.data?.message || 'Could not complete T-Pin reset.');
                    if (err.response?.data?.email_hint) {
                      setTPinEmailHint(err.response.data.email_hint);
                    }
                  } finally {
                    setSetupBusy(false);
                  }
                }}
              >
                {tPinOtpSent ? (
                  <label className="field">
                    Email code
                    <input
                      type="text"
                      className="tl-otp-input"
                      name="t_pin_otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={tPinOtp}
                      onChange={(e) => setTPinOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                    />
                  </label>
                ) : null}
                <div className="tl-modal-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setTPinForgot(false);
                      setTPinOtpSent(false);
                      setTPinOtp('');
                      setSetupHint('');
                      setError('');
                    }}
                    disabled={setupBusy}
                  >
                    Back
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={setupBusy}>
                    {setupBusy
                      ? tPinOtpSent
                        ? 'Checking…'
                        : 'Sending…'
                      : tPinOtpSent
                        ? 'Verify code'
                        : 'Send OTP to email'}
                  </button>
                </div>
                {tPinOtpSent ? (
                  <button
                    type="button"
                    className="tl-forgot-link"
                    disabled={setupBusy}
                    onClick={async () => {
                      setSetupBusy(true);
                      setError('');
                      try {
                        const { data } = await api.post('/api/tl-dashboard/t-pin/otp');
                        setTPinEmailHint(data.email_hint || tPinEmailHint);
                        setSetupHint(data.message || 'Code sent to your email.');
                      } catch (err) {
                        setError(err.response?.data?.message || 'Could not resend the code.');
                      } finally {
                        setSetupBusy(false);
                      }
                    }}
                  >
                    Resend code
                  </button>
                ) : null}
              </form>
            ) : (
              <form className="form" onSubmit={handleSetupTPin}>
                <PasswordInput
                  label="New T-Pin"
                  name="new_t_pin"
                  inputMode="numeric"
                  value={setupForm.t_pin}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      t_pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                  maxLength={8}
                />
                <PasswordInput
                  label="Confirm T-Pin"
                  name="confirm_t_pin"
                  inputMode="numeric"
                  value={setupForm.confirm}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      confirm: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                  maxLength={8}
                />
                <div className="tl-modal-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSetupOpen(false)}
                    disabled={setupBusy}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={setupBusy}>
                    {setupBusy ? 'Saving…' : 'Save T-Pin'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {assignCategory && (
        <div
          className="tl-modal-backdrop"
          role="presentation"
          onClick={() => setAssignCategory(null)}
        >
          <div
            className="tl-modal tl-modal-wide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Assign viewers — {assignCategory.name}</h2>
            <p className="muted">
              Changes apply to your draft. Click Save on the dashboard to store them with your
              T-Pin.
            </p>
            <div className="tl-assign-list">
              <TeamFilterSelect
                value={assignTeam}
                onChange={setAssignTeam}
                extraNames={assignableUsers}
                allLabel="Team: All"
              />
              {visibleAssignable.length === 0 && (
                <p className="muted">
                  {assignableUsers.length === 0
                    ? 'No active users available to assign.'
                    : 'No people in this team.'}
                </p>
              )}
              {visibleAssignable.map((u) => (
                <label key={u.id} className="tl-assign-row">
                  <input
                    type="checkbox"
                    checked={selectedAssignees.includes(u.id)}
                    onChange={() => toggleAssignee(u.id)}
                  />
                  <span>
                    <strong>{u.name || u.username}</strong>
                    <span className="muted">
                      {' '}
                      · {u.username}
                      {u.department ? ` · ${u.department}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="tl-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setAssignCategory(null)}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={applyAssignmentsLocally}>
                Apply to draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
