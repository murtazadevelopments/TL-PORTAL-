import { useEffect, useState } from 'react';
import api from '../../api/client';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import ClockHourSelect from '../../components/ClockHourSelect';
import { useAuthUser } from '../../context/AuthUserContext';
import {
  canViewOnsiteTeamAttendance,
  canViewRemoteTeamAttendance,
  canViewTeamAttendance,
} from '../../utils/permissions';
import './AttendanceAdminPage.css';

const EMPTY_MANUAL = { user: null, hour_key: '', status: 'verified', note: '' };
const EMPTY_HOURS = { user: null, work_start_hour: 9, work_end_hour: 18 };
const EMPTY_ONSITE_MANUAL = { user: null, checked_in_at: '', note: '' };

function karachiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toDatetimeLocalValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalForDay(dateKey, source = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  if (source instanceof Date && Number.isFinite(source.getTime())) {
    const existingDay = karachiDateKey(source);
    if (existingDay === dateKey) return toDatetimeLocalValue(source);
  }
  return `${dateKey}T${pad(source.getHours())}:${pad(source.getMinutes())}`;
}

function formatKarachiTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

function onsiteStatusLabel(status) {
  if (status === 'on_time') return 'On time';
  if (status === 'late') return 'Late';
  if (status === 'absent') return 'Absent';
  if (status === 'pending') return 'Pending';
  return status || '—';
}

function attendancePhotoUrl(row) {
  if (!row?.profile_picture_url) return null;
  return (
    withAuthDocumentUrl(row.profile_picture_url, row.updated_at || row.id) ||
    withAuthDocumentUrl(`/api/documents/${row.id}/profile`, row.updated_at || row.id)
  );
}

function AttendancePhoto({ row }) {
  const [failed, setFailed] = useState(false);
  const src = attendancePhotoUrl(row);
  if (!src || failed) {
    return <div className="avatar placeholder">{(row.name || '?')[0]}</div>;
  }
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

export default function AttendanceAdminPage() {
  const { user, permissions, loading: authLoading } = useAuthUser();
  const canRemote = canViewRemoteTeamAttendance(user?.role, permissions);
  const canOnsite = canViewOnsiteTeamAttendance(user?.role, permissions);
  const canAny = canViewTeamAttendance(user?.role, permissions);

  const [date, setDate] = useState(() => karachiDateKey());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [hoursEdit, setHoursEdit] = useState(EMPTY_HOURS);
  const [history, setHistory] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('onsite');
  const [onsite, setOnsite] = useState(null);
  const [onsiteManual, setOnsiteManual] = useState(EMPTY_ONSITE_MANUAL);
  const [overrideRow, setOverrideRow] = useState(null);
  const [overrideStatus, setOverrideStatus] = useState('on_time');

  async function load(dateOverride) {
    setLoading(true);
    setError('');
    const dateKey = dateOverride || date;
    try {
      if (mode === 'onsite') {
        const { data: payload } = await api.get('/api/admin/onsite-attendance', {
          params: { date: dateKey, search, status },
        });
        setOnsite(payload);
        setData(null);
      } else {
        const { data: payload } = await api.get('/api/admin/attendance', {
          params: { date: dateKey, search, status },
        });
        setData(payload);
        setOnsite(null);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load attendance.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (mode === 'onsite' && canOnsite) return;
    if (mode === 'remote' && canRemote) return;
    if (canOnsite) setMode('onsite');
    else if (canRemote) setMode('remote');
  }, [authLoading, canRemote, canOnsite, mode]);

  useEffect(() => {
    if (authLoading) return;
    if (!canAny) {
      setLoading(false);
      return;
    }
    if (mode === 'remote' && !canRemote) return;
    if (mode === 'onsite' && !canOnsite) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, status, mode, authLoading, canRemote, canOnsite, canAny]);

  async function submitManual(e) {
    e.preventDefault();
    if (!manual.user) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/admin/attendance/${manual.user.id}/manual`, {
        hour_key: manual.hour_key,
        date_key: date,
        status: manual.status,
        note: manual.note,
      });
      setManual(EMPTY_MANUAL);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save manual attendance.');
    } finally {
      setSaving(false);
    }
  }

  async function submitHours(e) {
    e.preventDefault();
    if (!hoursEdit.user) return;
    setSaving(true);
    setError('');
    try {
      const startHour = Number(hoursEdit.work_start_hour ?? hoursEdit.work_start_hour);
      const endHour = Number(hoursEdit.work_end_hour ?? hoursEdit.work_end_hour);
      await api.put(`/api/admin/attendance/${hoursEdit.user.id}/hours`, {
        work_start_hour: startHour,
        work_end_hour: endHour,
        work_start_hour: startHour,
        work_end_hour: endHour,
      });
      setHoursEdit(EMPTY_HOURS);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save working hours.');
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(row) {
    setError('');
    try {
      const { data: payload } = await api.get(`/api/admin/attendance/${row.id}/days`, {
        params: { month: date.slice(0, 7) },
      });
      setHistory(payload);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load daily records.');
    }
  }

  async function submitOnsiteManual(e) {
    e.preventDefault();
    if (!onsiteManual.user) return;
    const when = new Date(onsiteManual.checked_in_at);
    if (!Number.isFinite(when.getTime())) {
      setError('Enter a valid check-in time.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data: payload } = await api.post('/api/admin/onsite-attendance', {
        user_id: onsiteManual.user.id,
        checked_in_at: when.toISOString(),
        note: onsiteManual.note,
      });
      setOnsiteManual(EMPTY_ONSITE_MANUAL);
      const savedDate = String(payload?.record?.work_date || '').slice(0, 10);
      if (savedDate) setDate(savedDate);
      await load(savedDate || date);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save onsite attendance.');
    } finally {
      setSaving(false);
    }
  }

  async function submitOverride(e) {
    e.preventDefault();
    if (!overrideRow?.record?.id) return;
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/admin/onsite-attendance/${overrideRow.record.id}`, {
        status: overrideStatus,
      });
      setOverrideRow(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update status.');
    } finally {
      setSaving(false);
    }
  }

  const summary =
    mode === 'onsite'
      ? onsite?.summary || { employees: 0, on_time: 0, late: 0, absent: 0, pending: 0, manual: 0 }
      : data?.summary || { verified: 0, missed: 0, failed: 0, manual: 0, employees: 0 };

  if (!authLoading && !canAny) {
    return (
      <div className="admin-page page-panel attendance-admin">
        <h1>Team attendance</h1>
        <p className="muted">
          You do not have attendance access. Ask the CEO to assign attendance permissions, or use an HR
          account for onsite employees attendance.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel attendance-admin">
      <div className="attendance-hero">
        <div>
          <h1>Team attendance</h1>
          <p className="muted">
            {mode === 'onsite'
              ? 'Onsite employees attendance — office check-in. Visible to CEO, HR, and people the CEO assigns attendance access.'
              : 'Remote employees attendance — face check-in. Visible to CEO and people the CEO assigns attendance access.'}
          </p>
        </div>
        <div className="attendance-mode-toggle" role="tablist" aria-label="Attendance type">
          {canRemote && (
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'remote'}
              className={mode === 'remote' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => {
                setStatus('all');
                setMode('remote');
              }}
            >
              Remote employees attendance
            </button>
          )}
          {canOnsite && (
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'onsite'}
              className={mode === 'onsite' ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => {
                setStatus('all');
                setMode('onsite');
              }}
            >
              Onsite employees attendance
            </button>
          )}
        </div>
      </div>

      <div className="attendance-summary">
        {mode === 'onsite' ? (
          <>
            <div className="attendance-stat"><span>People</span><strong>{summary.employees}</strong></div>
            <div className="attendance-stat"><span>On time</span><strong>{summary.on_time}</strong></div>
            <div className="attendance-stat"><span>Late</span><strong>{summary.late}</strong></div>
            <div className="attendance-stat"><span>Absent / pending</span><strong>{(summary.absent || 0) + (summary.pending || 0)}</strong></div>
          </>
        ) : (
          <>
            <div className="attendance-stat"><span>People</span><strong>{summary.employees}</strong></div>
            <div className="attendance-stat"><span>Verified slots</span><strong>{summary.verified}</strong></div>
            <div className="attendance-stat"><span>Missed</span><strong>{summary.missed}</strong></div>
            <div className="attendance-stat"><span>Manual</span><strong>{summary.manual}</strong></div>
          </>
        )}
      </div>

      <form
        className="attendance-filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            {mode === 'onsite' ? (
              <>
                <option value="on_time">On time</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="pending">Pending</option>
              </>
            ) : (
              <>
                <option value="verified">Verified</option>
                <option value="missed">Missed</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="leave">Leave</option>
              </>
            )}
          </select>
        </label>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, ID, branch…"
          />
        </label>
        <button type="submit" className="btn btn-ghost">
          Apply
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {mode === 'onsite' ? (
        <>
          {!loading && (onsite?.employees || []).length === 0 && !error && (
            <p className="muted">No onsite employees in your view yet.</p>
          )}
          <div className="attendance-admin-list">
            {(onsite?.employees || []).map((row) => {
              return (
                <article key={row.id} className="attendance-admin-card">
                  <header>
                    <AttendancePhoto row={row} />
                    <div>
                      <strong>{row.name}</strong>
                      <p className="muted">
                        {row.employee_id || 'No ID'}
                        {row.branch ? ` · ${row.branch}` : ''}
                        {row.shift ? ` · ${row.shift}` : ''}
                      </p>
                    </div>
                    <span className={`badge ${row.row_status}`}>{onsiteStatusLabel(row.row_status)}</span>
                  </header>
                  {row.record ? (
                    <p className="muted">
                      {formatKarachiTime(row.record.checked_in_at)} ·{' '}
                      {row.record.method === 'manual' ? 'manual' : 'office check-in'}
                      {row.record.branch_name ? ` · ${row.record.branch_name}` : ''}
                      {row.record.status_overridden ? ' · overridden' : ''}
                    </p>
                  ) : (
                    <p className="muted">No check-in yet.</p>
                  )}
                  <div className="attendance-admin-actions">
                    {row.can_manual && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          setOnsiteManual({
                            user: row,
                            checked_in_at: row.record?.checked_in_at
                              ? toDatetimeLocalValue(new Date(row.record.checked_in_at))
                              : datetimeLocalForDay(date),
                            note: row.record?.note || '',
                          })
                        }
                      >
                        Add / update check-in
                      </button>
                    )}
                    {row.can_override && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setOverrideRow(row);
                          setOverrideStatus(row.record?.status || 'on_time');
                        }}
                      >
                        Change status
                      </button>
                    )}
                    {!row.can_manual && !row.can_override && (
                      <p className="muted">Out of your edit scope</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <>
      {!loading && (data?.employees || []).length === 0 && !error && (
        <p className="muted">No remote employees in your view yet. Attendance is recorded for remote staff only.</p>
      )}

      <div className="attendance-admin-list">
        {(data?.employees || []).map((row) => {
          return (
            <article key={row.id} className="attendance-admin-card">
              <header>
                <AttendancePhoto row={row} />
                <div>
                  <strong>{row.name}</strong>
                  <p className="muted">
                    {row.employee_id || 'No ID'}
                    {row.branch ? ` · ${row.branch}` : ''}
                    {' · '}
                    {row.work_hours_label || '9:00 AM–6:00 PM'}
                  </p>
                </div>
                <span className={`badge ${row.row_status}`}>{row.row_status}</span>
              </header>
              <div className="attendance-mini-slots">
                {row.slots.map((slot) => (
                  <span key={slot.hour_key} className={`dot ${slot.state}`} title={`${slot.label} ${slot.state}`}>
                    {String(slot.label || '').replace(':00', '')}
                  </span>
                ))}
              </div>
              {row.can_manual ? (
                <div className="attendance-admin-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      setHoursEdit({
                        user: row,
                        work_start_hour: row.work_start_hour ?? 9,
                        work_end_hour: row.work_end_hour ?? 18,
                      })
                    }
                  >
                    Set hours
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => openHistory(row)}>
                    Daily records
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      setManual({
                        user: row,
                        hour_key: row.slots.find((s) => s.state !== 'verified')?.hour_key || row.slots[0]?.hour_key || '',
                        status: 'verified',
                        note: '',
                      })
                    }
                  >
                    Manual mark
                  </button>
                </div>
              ) : (
                <div className="attendance-admin-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => openHistory(row)}>
                    Daily records
                  </button>
                  <p className="muted">Out of your edit scope</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
        </>
      )}

      {manual.user && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => setManual(EMPTY_MANUAL)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submitManual}>
            <h2>Manual attendance</h2>
            <p className="muted">{manual.user.name} — a reason is required.</p>
            <label>
              Hour {manual.status === 'leave' ? '(not used for leave)' : ''}
              <select
                value={manual.hour_key}
                onChange={(e) => setManual((m) => ({ ...m, hour_key: e.target.value }))}
                required={manual.status !== 'leave'}
                disabled={manual.status === 'leave'}
              >
                {(manual.user.slots || []).map((slot) => (
                  <option key={slot.hour_key} value={slot.hour_key}>
                    {slot.label} ({slot.state})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={manual.status}
                onChange={(e) => setManual((m) => ({ ...m, status: e.target.value }))}
              >
                <option value="verified">Verified / present</option>
                <option value="late">Late</option>
                <option value="missed">Missed / absent</option>
                <option value="leave">Leave (full day)</option>
              </select>
            </label>
            <label>
              Reason
              <textarea
                required
                minLength={8}
                rows={3}
                value={manual.note}
                onChange={(e) => setManual((m) => ({ ...m, note: e.target.value }))}
                placeholder="Why are you overriding this slot?"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setManual(EMPTY_MANUAL)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save mark'}
              </button>
            </div>
          </form>
        </div>
      )}

      {hoursEdit.user && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => setHoursEdit(EMPTY_HOURS)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submitHours}>
            <h2>Working hours</h2>
            <p className="muted">{hoursEdit.user.name} can only check in during these hours.</p>
            <ClockHourSelect
              label="Start time"
              value={hoursEdit.work_start_hour}
              onChange={(hour) => setHoursEdit((h) => ({ ...h, work_start_hour: hour }))}
            />
            <ClockHourSelect
              label="End time"
              value={hoursEdit.work_end_hour}
              isEnd
              onChange={(hour) => setHoursEdit((h) => ({ ...h, work_end_hour: hour }))}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setHoursEdit(EMPTY_HOURS)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save hours'}
              </button>
            </div>
          </form>
        </div>
      )}

      {history && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => setHistory(null)}>
          <div className="modal-card history-card" onClick={(e) => e.stopPropagation()}>
            <h2>{history.employee?.name || 'Daily records'}</h2>
            <p className="muted">
              {history.month} · presents {history.totals?.present || 0} · lates {history.totals?.late || 0} ·
              absents {history.totals?.absent || 0} · leaves {history.totals?.leave || 0}
            </p>
            <ol className="attendance-day-list">
              {(history.days || []).map((day) => (
                <li key={day.date} className={`attendance-day ${day.status}`}>
                  <span className="attendance-day-date">{day.date}</span>
                  <span className="attendance-day-status">{day.status}</span>
                </li>
              ))}
            </ol>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setHistory(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {onsiteManual.user && (
        <div
          className="modal-backdrop modal-backdrop-stack"
          onClick={() => setOnsiteManual(EMPTY_ONSITE_MANUAL)}
        >
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submitOnsiteManual}>
            <h2>Manual onsite check-in</h2>
            <p className="muted">
              {onsiteManual.user.name} — status is calculated from their shift (late/absent thresholds).
            </p>
            {error && <p className="error">{error}</p>}
            <label>
              Check-in time
              <input
                type="datetime-local"
                required
                value={onsiteManual.checked_in_at}
                onChange={(e) => setOnsiteManual((m) => ({ ...m, checked_in_at: e.target.value }))}
              />
            </label>
            <label>
              Note (optional)
              <textarea
                rows={3}
                value={onsiteManual.note}
                onChange={(e) => setOnsiteManual((m) => ({ ...m, note: e.target.value }))}
                placeholder="Why the portal check-in failed"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOnsiteManual(EMPTY_ONSITE_MANUAL)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save check-in'}
              </button>
            </div>
          </form>
        </div>
      )}

      {overrideRow && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => setOverrideRow(null)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submitOverride}>
            <h2>Change status</h2>
            <p className="muted">
              {overrideRow.name} — currently {onsiteStatusLabel(overrideRow.record?.status)}. This is
              logged in the audit trail.
            </p>
            <label>
              New status
              <select
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value)}
              >
                <option value="on_time">On time</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOverrideRow(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save status'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
