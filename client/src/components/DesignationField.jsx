import { useState } from 'react';

function designationSelectOptions(list, currentValue) {
  const rows = Array.isArray(list) ? list : [];
  const lead = rows.filter((d) => d.tl_dashboard_access);
  const other = rows.filter((d) => !d.tl_dashboard_access);
  const names = new Set(rows.map((d) => d.name));

  return (
    <>
      <option value="">Select designation</option>
      {lead.length > 0 && (
        <optgroup label="Team Lead access">
          {lead.map((d) => (
            <option key={d.id || d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </optgroup>
      )}
      {other.length > 0 && (
        <optgroup label="Other">
          {other.map((d) => (
            <option key={d.id || d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </optgroup>
      )}
      {currentValue && !names.has(currentValue) && (
        <option value={currentValue}>{currentValue} (legacy)</option>
      )}
    </>
  );
}

export default function DesignationField({
  name = 'designation',
  value,
  onChange,
  required = false,
  designations,
  canManage,
  error,
  onCreated,
  onRemoved,
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [tlAccess, setTlAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const selected = (Array.isArray(designations) ? designations : []).find(
    (d) => d.name === value
  );

  async function handleAdd() {
    const title = newName.trim();
    if (!title) {
      setLocalError('Enter a designation name.');
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      await onCreated?.({ name: title, tl_dashboard_access: tlAccess });
      setNewName('');
      setTlAccess(false);
      setShowAdd(false);
    } catch (err) {
      setLocalError(err.message || 'Failed to add designation.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!selected?.id) return;
    const ok = window.confirm(
      `Remove “${selected.name}” from the designation list? People already using it keep the title until you change it.`
    );
    if (!ok) return;
    setBusy(true);
    setLocalError('');
    try {
      await onRemoved?.(selected);
    } catch (err) {
      setLocalError(err.message || 'Failed to remove designation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="designation-field field-with-action">
      <label className={error ? 'has-error' : ''}>
        Designation {required ? <span className="req-star" aria-hidden="true">*</span> : null}
        <select name={name} value={value} onChange={onChange} required={required} disabled={busy}>
          {designationSelectOptions(designations, value)}
        </select>
        {error ? <span className="field-error">{error}</span> : null}
      </label>

      {canManage && (
        <div className="designation-field-actions">
          {!showAdd ? (
            <div className="designation-field-actions-row">
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                onClick={() => {
                  setShowAdd(true);
                  setLocalError('');
                }}
              >
                + Add designation
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                disabled={!selected?.id || busy}
                onClick={handleRemove}
              >
                Remove designation
              </button>
            </div>
          ) : (
            <div className="designation-field-actions-row">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New designation"
                disabled={busy}
              />
              <label className="checkbox-inline designation-field-check">
                <input
                  type="checkbox"
                  checked={tlAccess}
                  onChange={(e) => setTlAccess(e.target.checked)}
                  disabled={busy}
                />
                Team Lead access
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleAdd}>
                {busy ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setShowAdd(false);
                  setNewName('');
                  setTlAccess(false);
                  setLocalError('');
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {localError ? <p className="error">{localError}</p> : null}
        </div>
      )}
    </div>
  );
}
