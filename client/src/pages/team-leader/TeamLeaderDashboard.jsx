import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
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
          <label>
            T-Pin
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={busy}
              autoFocus
            />
          </label>
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

  const [newCategoryName, setNewCategoryName] = useState('');
  const [linkDrafts, setLinkDrafts] = useState({});
  const [labelDrafts, setLabelDrafts] = useState({});
  const [openIds, setOpenIds] = useState(() => new Set());
  const [assignableUsers, setAssignableUsers] = useState([]);
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
      if (tPinConfigured) body.current_t_pin = setupForm.current_t_pin;
      else body.current_password = setupForm.current_password;
      await api.post('/api/tl-dashboard/t-pin', body);
      setTPinConfigured(true);
      setSetupOpen(false);
      setSetupForm({ current_password: '', current_t_pin: '', t_pin: '', confirm: '' });
      setSuccess('T-Pin saved. You can manage the dashboard now.');
    } catch (err) {
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
    markDirty();
  }

  function openAssign(cat) {
    setAssignCategory(cat);
    setSelectedAssignees((cat.assignees || []).map((u) => u.id));
  }

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
            <label>
              Account password
              <input
                type="password"
                autoComplete="current-password"
                value={setupForm.current_password}
                onChange={(e) =>
                  setSetupForm((f) => ({ ...f, current_password: e.target.value }))
                }
                required
                disabled={setupBusy}
              />
            </label>
            <label>
              New T-Pin (4–8 digits)
              <input
                type="password"
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
              />
            </label>
            <label>
              Confirm T-Pin
              <input
                type="password"
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
              />
            </label>
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
              ? 'Edit freely, then click Save and enter your T-Pin once.'
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
                  setSetupForm({
                    current_password: '',
                    current_t_pin: '',
                    t_pin: '',
                    confirm: '',
                  });
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
      {success && <p className="success">{success}</p>}

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
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="tl-acc-panel">
                  {canManage && (cat.assignees || []).length > 0 && (
                    <p className="tl-assignees muted">
                      Visible to:{' '}
                      {(cat.assignees || []).map((u) => u.name || u.username).join(', ')}
                    </p>
                  )}

                  <ul className="tl-item-list">
                    {(cat.items || []).map((item) => (
                      <li key={item.id} className="tl-item">
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
                          {canManage && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => handleDeleteItem(cat, item)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                    {(cat.items || []).length === 0 && (
                      <li className="muted">No links yet.</li>
                    )}
                  </ul>

                  {canManage && (
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
        <div className="tl-modal-backdrop" role="presentation" onClick={() => setSetupOpen(false)}>
          <div
            className="tl-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Change T-Pin</h2>
            <p className="muted">Enter your current T-Pin, then choose a new 4–8 digit pin.</p>
            <form className="form" onSubmit={handleSetupTPin}>
              <label>
                Current T-Pin
                <input
                  type="password"
                  inputMode="numeric"
                  value={setupForm.current_t_pin}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      current_t_pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                />
              </label>
              <label>
                New T-Pin
                <input
                  type="password"
                  inputMode="numeric"
                  value={setupForm.t_pin}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      t_pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                />
              </label>
              <label>
                Confirm T-Pin
                <input
                  type="password"
                  inputMode="numeric"
                  value={setupForm.confirm}
                  onChange={(e) =>
                    setSetupForm((f) => ({
                      ...f,
                      confirm: e.target.value.replace(/\D/g, '').slice(0, 8),
                    }))
                  }
                  required
                />
              </label>
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
              {assignableUsers.length === 0 && (
                <p className="muted">No active users available to assign.</p>
              )}
              {assignableUsers.map((u) => (
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
