import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import './ComposeMessageModal.css';

const DELIVERY_OPTIONS = [
  { value: 'portal', label: 'Portal only' },
  { value: 'email', label: 'Email only' },
  { value: 'both', label: 'Portal + Email' },
];

const AUDIENCE_OPTIONS = [
  { value: 'user', label: 'One person' },
  { value: 'all', label: 'Everyone' },
  { value: 'team', label: 'A team' },
  { value: 'branch', label: 'A branch' },
];

function employeeLabel(row) {
  const name = row?.name || row?.username || 'Unnamed';
  const empId = row?.employee_id || 'No ID';
  return `${name} — ${empId}`;
}

/**
 * Admin compose modal for portal / email messages.
 */
export default function ComposeMessageModal({
  open,
  onClose,
  onSuccess,
  initialRecipient = null,
}) {
  const [recipients, setRecipients] = useState([]);
  const [teams, setTeams] = useState([]);
  const [branches, setBranches] = useState([]);
  const [counts, setCounts] = useState({ all: 0, byTeam: {}, byBranch: {} });
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [audienceType, setAudienceType] = useState('user');
  const [search, setSearch] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [team, setTeam] = useState('');
  const [branch, setBranch] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('portal');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const lockedRecipient = Boolean(initialRecipient?.id);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;

    async function load() {
      setLoadingMeta(true);
      setMetaError('');
      setFormError('');
      try {
        const { data } = await api.get('/api/admin/messages/recipients');
        if (!active) return;
        setRecipients(Array.isArray(data.recipients) ? data.recipients : []);
        setTeams(Array.isArray(data.teams) ? data.teams : []);
        setBranches(Array.isArray(data.branches) ? data.branches : []);
        setCounts(data.counts || { all: 0, byTeam: {}, byBranch: {} });
      } catch (err) {
        if (!active) return;
        setMetaError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            'Failed to load recipients.'
        );
      } finally {
        if (active) setLoadingMeta(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSubject('');
    setBody('');
    setDeliveryMethod('portal');
    setSearch('');
    setFormError('');
    setTeam('');
    setBranch('');
    if (initialRecipient?.id) {
      setAudienceType('user');
      setRecipientId(String(initialRecipient.id));
    } else {
      setAudienceType('user');
      setRecipientId('');
    }
  }, [open, initialRecipient]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter((r) => {
      const hay = `${r.name || ''} ${r.username || ''} ${r.employee_id || ''} ${
        r.email || ''
      } ${r.department || ''} ${r.branch || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [recipients, search]);

  const selected = useMemo(
    () =>
      recipients.find((r) => String(r.id) === String(recipientId)) ||
      initialRecipient ||
      null,
    [recipients, recipientId, initialRecipient]
  );

  const previewCount = useMemo(() => {
    if (lockedRecipient || audienceType === 'user') return selected ? 1 : 0;
    if (audienceType === 'all') return counts.all || recipients.length;
    if (audienceType === 'team') {
      if (!team) return 0;
      return counts.byTeam?.[team] ?? 0;
    }
    if (audienceType === 'branch') {
      if (!branch) return 0;
      return counts.byBranch?.[branch] ?? 0;
    }
    return 0;
  }, [
    lockedRecipient,
    audienceType,
    selected,
    counts,
    recipients.length,
    team,
    branch,
  ]);

  const audienceSummary = useMemo(() => {
    if (lockedRecipient || audienceType === 'user') {
      return selected ? employeeLabel(selected) : 'No person selected';
    }
    if (audienceType === 'all') return `Everyone (${previewCount})`;
    if (audienceType === 'team') {
      return team ? `${team} (${previewCount})` : 'No team selected';
    }
    if (audienceType === 'branch') {
      return branch ? `${branch} (${previewCount})` : 'No branch selected';
    }
    return '';
  }, [lockedRecipient, audienceType, selected, previewCount, team, branch]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!body.trim()) {
      setFormError('Message body is required.');
      return;
    }

    const payload = {
      subject: subject.trim() || undefined,
      body: body.trim(),
      deliveryMethod,
      audienceType: lockedRecipient ? 'user' : audienceType,
    };

    if (payload.audienceType === 'user') {
      if (!recipientId) {
        setFormError('Select a person.');
        return;
      }
      payload.recipientId = Number(recipientId);
    } else if (payload.audienceType === 'team') {
      if (!team) {
        setFormError('Select a team.');
        return;
      }
      payload.team = team;
    } else if (payload.audienceType === 'branch') {
      if (!branch) {
        setFormError('Select a branch.');
        return;
      }
      payload.branch = branch;
    }

    if (previewCount > 1) {
      const ok = window.confirm(
        `Send this message to ${previewCount} people?\n\n${audienceSummary}`
      );
      if (!ok) return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      const { data } = await api.post('/api/admin/messages', payload);
      onSuccess?.(data);
      onClose();
    } catch (err) {
      setFormError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          'Failed to send message.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel compose-message-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Compose message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Compose message</h2>
            <p className="muted" style={{ margin: 0 }}>
              Message one person, a team, a branch, or everyone
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {loadingMeta && (
          <div className="admin-loading">
            <div className="spinner" />
            Loading recipients…
          </div>
        )}

        {metaError && <p className="error">{metaError}</p>}

        {!loadingMeta && !metaError && (
          <form className="compose-message-form" onSubmit={handleSubmit} noValidate>
            <fieldset className="compose-step">
              <legend>Who receives this?</legend>

              {lockedRecipient ? (
                <p className="compose-locked">
                  To: <strong>{employeeLabel(selected)}</strong>
                  {selected?.email ? (
                    <span className="muted"> · {selected.email}</span>
                  ) : null}
                </p>
              ) : (
                <>
                  <div
                    className="compose-audience"
                    role="radiogroup"
                    aria-label="Audience"
                  >
                    {AUDIENCE_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`compose-audience-option${
                          audienceType === opt.value ? ' is-active' : ''
                        }`}
                      >
                        <input
                          type="radio"
                          name="audienceType"
                          value={opt.value}
                          checked={audienceType === opt.value}
                          onChange={() => setAudienceType(opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>

                  {audienceType === 'user' && (
                    <>
                      <input
                        className="compose-search"
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, username, employee ID, team…"
                        aria-label="Search people"
                      />
                      <select
                        value={recipientId}
                        onChange={(e) => setRecipientId(e.target.value)}
                        required
                      >
                        <option value="">Select person…</option>
                        {filtered.map((row) => (
                          <option key={row.id} value={row.id}>
                            {employeeLabel(row)}
                            {row.department ? ` · ${row.department}` : ''}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {audienceType === 'all' && (
                    <p className="compose-preview">
                      Sends to <strong>all {counts.all || recipients.length}</strong>{' '}
                      active/pending employees on the portal.
                    </p>
                  )}

                  {audienceType === 'team' && (
                    <label>
                      Team / department
                      <select
                        value={team}
                        onChange={(e) => setTeam(e.target.value)}
                        required
                      >
                        <option value="">Select team…</option>
                        {teams.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                            {counts.byTeam?.[t.name] != null
                              ? ` (${counts.byTeam[t.name]})`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {audienceType === 'branch' && (
                    <label>
                      Branch
                      <select
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        required
                      >
                        <option value="">Select branch…</option>
                        {branches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                            {counts.byBranch?.[b] != null
                              ? ` (${counts.byBranch[b]})`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              <p className="compose-preview muted">
                Will send to: <strong>{audienceSummary}</strong>
              </p>
            </fieldset>

            <fieldset className="compose-step">
              <legend>Message</legend>
              <label>
                Subject <span className="muted">(optional)</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject line"
                />
              </label>
              <label>
                Body
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message…"
                  rows={6}
                  required
                />
              </label>
            </fieldset>

            <fieldset className="compose-step">
              <legend>Delivery</legend>
              <div className="compose-delivery" role="radiogroup" aria-label="Delivery method">
                {DELIVERY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`compose-delivery-option${
                      deliveryMethod === opt.value ? ' is-active' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="deliveryMethod"
                      value={opt.value}
                      checked={deliveryMethod === opt.value}
                      onChange={() => setDeliveryMethod(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {formError && <p className="error">{formError}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || previewCount < 1}
              >
                {submitting
                  ? 'Sending…'
                  : previewCount > 1
                    ? `Send to ${previewCount}`
                    : 'Send message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
