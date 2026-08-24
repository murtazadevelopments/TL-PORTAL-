import { useEffect, useState } from 'react';
import api from '../../api/client';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import ClockHourSelect from '../../components/ClockHourSelect';
import './AttendanceAdminPage.css';

const EMPTY_MANUAL = { user: null, hour_key: '', status: 'verified', note: '' };
const EMPTY_HOURS = { user: null, work_start_hour: 9, work_end_hour: 18 };

export default function AttendanceAdminPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [hoursEdit, setHoursEdit] = useState(EMPTY_HOURS);
  const [history, setHistory] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data: payload } = await api.get('/api/admin/attendance', {
        params: { date, search, status },
      });
      setData(payload);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load attendance.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, status]);

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

  const summary = data?.summary || { verified: 0, missed: 0, failed: 0, manual: 0, employees: 0 };

  return (
    <div className="admin-page page-panel attendance-admin">
      <div className="attendance-hero">
        <div>
          <h1>Team attendance</h1>
          <p className="muted">Remote employees only. Manual marks require edit access and a reason.</p>
        </div>
      </div>

      <div className="attendance-summary">
        <div className="attendance-stat"><span>People</span><strong>{summary.employees}</strong></div>
        <div className="attendance-stat"><span>Verified slots</span><strong>{summary.verified}</strong></div>
        <div className="attendance-stat"><span>Missed</span><strong>{summary.missed}</strong></div>
        <div className="attendance-stat"><span>Manual</span><strong>{summary.manual}</strong></div>
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
            <option value="verified">Verified</option>
            <option value="missed">Missed</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="leave">Leave</option>
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
      {!loading && (data?.employees || []).length === 0 && !error && (
        <p className="muted">No remote employees in your view yet. Attendance is recorded for remote staff only.</p>
      )}

      <div className="attendance-admin-list">
        {(data?.employees || []).map((row) => {
          const avatar = withAuthDocumentUrl(row.profile_picture_url, row.id);
          return (
            <article key={row.id} className="attendance-admin-card">
              <header>
                {avatar ? <img src={avatar} alt="" /> : <div className="avatar placeholder">{(row.name || '?')[0]}</div>}
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
    </div>
  );
}
