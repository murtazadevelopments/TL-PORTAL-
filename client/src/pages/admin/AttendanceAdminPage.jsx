import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import api from '../../api/client';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import ClockHourSelect from '../../components/ClockHourSelect';
import PhotoLightbox from '../../components/PhotoLightbox';
import { FaceCheckShot } from './FaceCheckCapturesPage';
import { useAuthUser } from '../../context/AuthUserContext';
import TeamFilterSelect from '../../components/TeamFilterSelect';
import {
  canViewOnsiteTeamAttendance,
  canViewRemoteTeamAttendance,
  canViewTeamAttendance,
  isCeo,
  isCeoOrManager,
} from '../../utils/permissions';
import ShiftHoursDetail from '../../components/ShiftHoursDetail';
import '../../components/ShiftHoursDetail.css';
import './AttendanceAdminPage.css';

const EMPTY_MANUAL = { user: null, hour_key: '', status: 'verified', note: '' };
const EMPTY_HOURS = { user: null, work_start_hour: 9, work_end_hour: 18, remote_check_count: 5 };
const EMPTY_ONSITE_MANUAL = { user: null, checked_in_at: '', note: '' };
const EMPTY_TIME_EDIT = {
  userId: null,
  name: '',
  label: '',
  challengeId: null,
  hourKey: '',
  scheduled_at: '',
  checked_in_at: '',
  hasCheckIn: false,
};

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

function shiftKarachiDateKey(dateKey, delta) {
  const [y, mo, d] = String(dateKey)
    .split('-')
    .map((n) => Number(n));
  return new Date(Date.UTC(y, mo - 1, d + delta)).toISOString().slice(0, 10);
}

function attendanceDateWindow() {
  const today = karachiDateKey();
  return {
    today,
    yesterday: shiftKarachiDateKey(today, -1),
    tomorrow: shiftKarachiDateKey(today, 1),
  };
}

function canEditCheckTime(dateKey, fullDays = false) {
  const key = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  if (fullDays) return true;
  const { yesterday, today, tomorrow } = attendanceDateWindow();
  return key === yesterday || key === today || key === tomorrow;
}

function clampAttendanceDate(value) {
  const { today, yesterday } = attendanceDateWindow();
  const key = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return today;
  if (key > today) return today;
  if (key < yesterday) return yesterday;
  return key;
}

function dateForAdminFilter(value, fullDays) {
  if (fullDays) {
    const today = karachiDateKey();
    const key = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return today;
    return key;
  }
  return clampAttendanceDate(value);
}

function datetimeLocalForDay(dateKey, source = new Date(), fullDays = false) {
  const day = dateForAdminFilter(dateKey, fullDays);
  if (source instanceof Date && Number.isFinite(source.getTime())) {
    const existingDay = karachiDateKey(source);
    if (existingDay === day) return toDatetimeLocalValue(source);
  }
  return `${day}T09:00`;
}

function formatKarachiClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function checkInRequestButton(row) {
  if (row.check_in_request_reason === 'complete') {
    const n = Number(row.checks_per_shift) || 5;
    return {
      label: `All ${n} checks done`,
      title: 'Opens again in their next working hours.',
    };
  }
  if (row.check_in_request_reason === 'cooldown' && row.check_in_request_available_at) {
    const when = formatKarachiClock(row.check_in_request_available_at);
    return { label: `Available ${when}`, title: `Wait at least 1 hour after a check-in request (${when}).` };
  }
  if (row.check_in_request_reason === 'stopped') {
    return { label: 'Check in Request', title: 'Attendance is turned off.' };
  }
  if (row.check_in_request_reason === 'holiday') {
    return { label: 'Day off', title: 'This weekday is turned off for this employee.' };
  }
  if (row.check_in_request_reason === 'no_shift') {
    return { label: 'Check in Request', title: 'Not in this employee’s working hours right now.' };
  }
  if (row.check_in_request_reason === 'on_break') {
    return { label: 'On break', title: 'Check-out and random checks wait until this employee turns break off.' };
  }
  return { label: 'Check in Request', title: 'Send the next attendance check to this employee.' };
}

function liveStatusLabel(row) {
  const s = row.live_status || row.row_status;
  if (s === 'in_shift') return 'In shift';
  if (s === 'on_break') return 'On break';
  if (s === 'off_shift') return 'Off shift';
  if (s === 'complete') return 'Shift done';
  if (s === 'absent' || s === 'missed' || s === 'failed') return 'Absent';
  if (s === 'verified' || s === 'present') return 'Present';
  if (s === 'late') return 'Late';
  if (s === 'leave') return 'Leave';
  if (s === 'holiday') return 'Day off';
  if (s === 'pending') return 'Pending';
  return s || '—';
}

function slotDotLabel(slot) {
  if (slot.kind === 'checkout' || /out/i.test(slot.label || '')) return 'Out';
  if (slot.kind === 'start' || Number(slot.seq) === 1) return 'In';
  return String(slot.seq || '');
}

function shiftTrackLine(row) {
  const bits = [];
  if (row.work_hours_label) bits.push(row.work_hours_label);
  if (row.work_days_label) bits.push(row.work_days_label);
  if (row.shift_date) bits.push(row.shift_date);
  if (row.in_shift && row.shift_ends_at) bits.push(`until ${formatKarachiClock(row.shift_ends_at)}`);
  const needed = Number(row.checks_needed || row.checks_per_shift || 0);
  const done = Number(row.checks_done || 0);
  if (needed > 0) bits.push(`${done} of ${needed} checks`);
  if (row.last_checked_in_at) bits.push(`last in ${formatKarachiClock(row.last_checked_in_at)}`);
  if (row.next_check_label && row.live_status !== 'complete' && !row.on_break) {
    bits.push(`next ${row.next_check_label}`);
  }
  if (row.work_label) bits.push(`work ${row.work_label}`);
  else if (row.duration_label) bits.push(row.duration_label);
  if (row.breaks_enabled && row.break_label && (row.break_minutes > 0 || row.on_break)) {
    bits.push(`break ${row.break_label}`);
  }
  if (row.breaks_enabled && row.on_break) bits.push('on break now');
  return bits.join(' · ');
}

function EmployeePowerSwitch({ label, name, on, busy, disabled, onToggle, title }) {
  return (
    <div
      className={`attendance-power attendance-power-sm ${on ? '' : 'is-off'}`}
      title={title}
    >
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? `Turn off ${label.toLowerCase()} for ${name}` : `Turn on ${label.toLowerCase()} for ${name}`}
        className="attendance-switch"
        disabled={disabled || busy}
        onClick={onToggle}
      />
      <strong>{busy ? '…' : on ? 'On' : 'Off'}</strong>
    </div>
  );
}

function EmployeeAttendanceSwitch({ row, busy, onToggle }) {
  const on = row.attendance_enabled !== false;
  const canToggle = row.can_toggle_attendance !== false;
  return (
    <EmployeePowerSwitch
      label="Attendance"
      name={row.name}
      on={on}
      busy={busy}
      disabled={!canToggle}
      onToggle={() => onToggle(row)}
    />
  );
}

function EmployeeFlexibleSwitch({ row, busy, onToggle }) {
  const on = row.flexible_hours === true;
  const canToggle = row.can_toggle_attendance !== false;
  return (
    <EmployeePowerSwitch
      label="Flexible"
      name={row.name}
      on={on}
      busy={busy}
      disabled={!canToggle}
      onToggle={() => onToggle(row)}
    />
  );
}

function EmployeeBreaksSwitch({ row, busy, onToggle }) {
  const on = row.breaks_enabled === true;
  const canToggle = row.can_toggle_attendance !== false;
  return (
    <EmployeePowerSwitch
      label="Break"
      name={row.name}
      on={on}
      busy={busy}
      disabled={!canToggle}
      onToggle={() => onToggle(row)}
    />
  );
}

const WORK_DAY_OPTIONS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

function defaultWorkDays() {
  return {
    mon: true,
    tue: true,
    wed: true,
    thu: true,
    fri: true,
    sat: true,
    sun: true,
  };
}

function workDaysFromRow(row) {
  const days = defaultWorkDays();
  const incoming = row?.work_days && typeof row.work_days === 'object' ? row.work_days : {};
  for (const { key } of WORK_DAY_OPTIONS) {
    if (incoming[key] === false || incoming[key] === 0 || incoming[key] === 'off' || incoming[key] === 'false') {
      days[key] = false;
    }
  }
  return days;
}

function EmployeePictureSwitch({ row, busy, onToggle }) {
  return (
    <EmployeePowerSwitch
      label="Picture"
      name={row.name}
      on={row.face_check_capture === true}
      busy={busy}
      disabled={false}
      onToggle={() => onToggle(row)}
    />
  );
}

function toKarachiDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function karachiLocalToIso(local) {
  if (!local) return null;
  const value = String(local).length === 16 ? `${local}:00` : local;
  const d = new Date(`${value}+05:00`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function formatKarachiTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
}

function checkStateLabel(state) {
  if (state === 'verified' || state === 'on_time') return 'On time';
  if (state === 'late' || state === 'late_window') return 'Late';
  if (state === 'missed' || state === 'absent') return 'Absent';
  if (state === 'leave') return 'Leave';
  if (state === 'holiday') return 'Holiday';
  if (state === 'failed') return 'Failed';
  if (state === 'open') return 'Open';
  if (state === 'pending' || state === 'upcoming') return 'Pending';
  return state || '—';
}

function dayStatusLabel(status) {
  if (status === 'present' || status === 'verified') return 'Present';
  return checkStateLabel(status);
}

function onsiteStatusLabel(status) {
  if (status === 'on_time') return 'On time';
  if (status === 'late') return 'Late';
  if (status === 'absent') return 'Absent';
  if (status === 'holiday') return 'Holiday';
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

function RemoteDeleteButtons({ row, canDelete, deletingId, onDeleteLast, onDeleteDay }) {
  if (!canDelete) return null;
  const lastBusy = deletingId === `remote-last-${row.id}`;
  const dayBusy = deletingId === `remote-day-${row.id}`;
  return (
    <>
      <button
        type="button"
        className="btn btn-danger"
        disabled={lastBusy || row.can_delete_last === false}
        title={
          row.can_delete_last === false
            ? 'No check-in on this shift day yet'
            : 'Remove the latest check-in for this shift day'
        }
        onClick={() => onDeleteLast(row)}
      >
        {lastBusy ? 'Deleting…' : 'Delete last attendance'}
      </button>
      <button
        type="button"
        className="btn btn-danger"
        disabled={dayBusy}
        title="Remove every check for this shift day"
        onClick={() => onDeleteDay(row)}
      >
        {dayBusy ? 'Deleting…' : 'Delete full day attendance'}
      </button>
    </>
  );
}

function AttendancePhoto({ row, onOpen }) {
  const [failed, setFailed] = useState(false);
  const src = attendancePhotoUrl(row);
  if (!src || failed) {
    return <div className="avatar placeholder">{(row.name || '?')[0]}</div>;
  }
  return (
    <button
      type="button"
      className="photo-open-btn"
      aria-label={`View photo of ${row.name || 'employee'}`}
      onClick={() => onOpen?.({ src, alt: row.name || '' })}
    >
      <img src={src} alt="" onError={() => setFailed(true)} />
    </button>
  );
}

export default function AttendanceAdminPage() {
  const { user, permissions, loading: authLoading } = useAuthUser();
  const ceo = isCeo(user?.role);
  const fullDays = isCeoOrManager(user?.role);
  const canDeleteAttendance = fullDays;
  const canRemote = canViewRemoteTeamAttendance(user?.role, permissions);
  const canOnsite = canViewOnsiteTeamAttendance(user?.role, permissions);
  const canAny = canViewTeamAttendance(user?.role, permissions);

  const [date, setDate] = useState(() => clampAttendanceDate(karachiDateKey()));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [branch, setBranch] = useState('all');
  const [branchOptions, setBranchOptions] = useState([]);
  const [team, setTeam] = useState('all');
  const [teamOptions, setTeamOptions] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestingId, setRequestingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [hoursEdit, setHoursEdit] = useState(EMPTY_HOURS);
  const [history, setHistory] = useState(null);
  const [historyMode, setHistoryMode] = useState('detail');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('onsite');
  const [onsite, setOnsite] = useState(null);
  const [onsiteManual, setOnsiteManual] = useState(EMPTY_ONSITE_MANUAL);
  const [overrideRow, setOverrideRow] = useState(null);
  const [overrideStatus, setOverrideStatus] = useState('on_time');
  const [deletingId, setDeletingId] = useState(null);
  const [timeEdit, setTimeEdit] = useState(EMPTY_TIME_EDIT);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [onsiteMonth, setOnsiteMonth] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [togglingFlexibleId, setTogglingFlexibleId] = useState(null);
  const [togglingBreaksId, setTogglingBreaksId] = useState(null);
  const [daysEdit, setDaysEdit] = useState(null);
  const [savingDays, setSavingDays] = useState(false);
  const [togglingPictureId, setTogglingPictureId] = useState(null);
  const [dayFaceChecks, setDayFaceChecks] = useState(null);
  const { today: todayKey, yesterday: yesterdayKey } = attendanceDateWindow();

  async function load(dateOverride) {
    setLoading(true);
    setError('');
    const dateKey = dateForAdminFilter(dateOverride || date, fullDays);
    try {
      const params = { date: dateKey, search, status };
      if (branch && branch !== 'all') params.branch = branch;
      if (team && team !== 'all') params.team = team;
      if (mode === 'onsite') {
        const { data: payload } = await api.get('/api/admin/onsite-attendance', {
          params,
        });
        setOnsite(payload);
        setData(null);
        if (Array.isArray(payload?.branches)) setBranchOptions(payload.branches);
        if (Array.isArray(payload?.teams)) setTeamOptions(payload.teams);
      } else {
        const { data: payload } = await api.get('/api/admin/attendance', {
          params,
        });
        setData(payload);
        setOnsite(null);
        if (Array.isArray(payload?.branches)) setBranchOptions(payload.branches);
        if (Array.isArray(payload?.teams)) setTeamOptions(payload.teams);
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
  }, [date, status, branch, team, mode, authLoading, canRemote, canOnsite, canAny]);

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
        remote_check_count: Number(hoursEdit.remote_check_count) || 5,
      });
      setHoursEdit(EMPTY_HOURS);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save working hours.');
    } finally {
      setSaving(false);
    }
  }

  async function openOnsiteMonth(row) {
    setError('');
    try {
      const month = karachiDateKey().slice(0, 7);
      const { data: payload } = await api.get(`/api/admin/onsite-attendance/${row.id}/month`, {
        params: { month },
      });
      setOnsiteMonth(payload);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this month’s attendance.');
    }
  }

  async function openHistory(row, mode = 'detail') {
    setError('');
    try {
      const { data: payload } = await api.get(`/api/admin/attendance/${row.id}/days`, {
        params: { month: date.slice(0, 7) },
      });
      setHistoryMode(mode);
      setHistory(payload);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load attendance history.');
    }
  }

  function openTimeEdit(slot, dateKey) {
    if (!history?.employee?.id) return;
    if (!canEditCheckTime(dateKey, fullDays)) return;
    if (!slot?.id && !slot?.hour_key) return;
    const label =
      slot.seq === 1 || slot.kind === 'start' ? 'Start' : `Check ${slot.seq || slot.label}`;
    setTimeEdit({
      userId: history.employee.id,
      name: history.employee.name || '',
      label,
      challengeId: slot.id || null,
      hourKey: slot.hour_key || '',
      scheduled_at: toKarachiDatetimeLocal(slot.scheduled_at) || toKarachiDatetimeLocal(new Date().toISOString()),
      checked_in_at: toKarachiDatetimeLocal(slot.checked_in_at),
      hasCheckIn: Boolean(slot.checked_in_at),
    });
  }

  async function submitTimeEdit(e) {
    e.preventDefault();
    if (!timeEdit.userId || (!timeEdit.challengeId && !timeEdit.hourKey)) return;
    const scheduledIso = karachiLocalToIso(timeEdit.scheduled_at);
    if (!scheduledIso) {
      setError('Enter a valid check time.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { scheduled_at: scheduledIso, hour_key: timeEdit.hourKey };
      if (timeEdit.hasCheckIn && timeEdit.checked_in_at) {
        const checkInIso = karachiLocalToIso(timeEdit.checked_in_at);
        if (!checkInIso) {
          setError('Enter a valid check-in time.');
          setSaving(false);
          return;
        }
        payload.checked_in_at = checkInIso;
      }
      await api.patch(
        `/api/admin/attendance/${timeEdit.userId}/challenges/${timeEdit.challengeId || 0}`,
        payload
      );
      setTimeEdit(EMPTY_TIME_EDIT);
      const { data: next } = await api.get(`/api/admin/attendance/${timeEdit.userId}/days`, {
        params: { month: date.slice(0, 7) },
      });
      setHistory(next);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save check time.');
    } finally {
      setSaving(false);
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
        work_date: dateForAdminFilter(String(onsiteManual.checked_in_at).slice(0, 10) || date, fullDays),
        note: onsiteManual.note,
      });
      setOnsiteManual(EMPTY_ONSITE_MANUAL);
      const savedDate = dateForAdminFilter(payload?.record?.work_date || date, fullDays);
      setDate(savedDate);
      await load(savedDate);
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

  async function deleteOnsiteRecord(row) {
    if (!canDeleteAttendance || !row?.record?.id) return;
    const workDate = row.record.work_date || date;
    const ok = window.confirm(
      `Delete ${row.name}'s attendance for ${workDate}? They will be able to check in again for that date.`
    );
    if (!ok) return;
    setDeletingId(`onsite-${row.record.id}`);
    setError('');
    try {
      await api.delete(`/api/admin/onsite-attendance/${row.record.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete attendance.');
    } finally {
      setDeletingId(null);
    }
  }

  function remoteShiftDate(row) {
    return String(row?.shift_date || date).slice(0, 10);
  }

  async function deleteRemoteLast(row) {
    if (!canDeleteAttendance || !row?.id) return;
    const shiftDate = remoteShiftDate(row);
    const ok = window.confirm(
      `Delete ${row.name}'s last attendance punch on ${shiftDate}? That check will open again.`
    );
    if (!ok) return;
    setDeletingId(`remote-last-${row.id}`);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.delete(
        `/api/admin/attendance/${row.id}/days/${shiftDate}/last`
      );
      setNotice(payload?.message || `Deleted last attendance for ${row.name}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete last attendance.');
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteRemoteDay(row) {
    if (!canDeleteAttendance || !row?.id) return;
    const shiftDate = remoteShiftDate(row);
    const ok = window.confirm(
      `Delete ${row.name}'s full-day attendance for ${shiftDate}? Face and manual marks for that date will be removed.`
    );
    if (!ok) return;
    setDeletingId(`remote-day-${row.id}`);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.delete(
        `/api/admin/attendance/${row.id}/days/${shiftDate}`
      );
      setNotice(payload?.message || `Deleted attendance for ${row.name} on ${shiftDate}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete attendance.');
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleEmployeeAttendance(row) {
    if (!row?.id || row.can_toggle_attendance === false) return;
    const next = row.attendance_enabled === false;
    setTogglingId(row.id);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.put(`/api/admin/attendance/${row.id}/enabled`, {
        enabled: next,
      });
      const enabled = Boolean(payload.enabled);
      const patch = (list) =>
        (list || []).map((item) =>
          item.id === row.id
            ? {
                ...item,
                attendance_enabled: enabled,
                can_check_in_request: enabled
                  ? !['complete', 'cooldown', 'holiday', 'no_shift'].includes(item.check_in_request_reason)
                  : false,
                check_in_request_reason: enabled
                  ? item.check_in_request_reason === 'stopped'
                    ? null
                    : item.check_in_request_reason
                  : 'stopped',
              }
            : item
        );
      setData((prev) => (prev ? { ...prev, employees: patch(prev.employees) } : prev));
      setOnsite((prev) => (prev ? { ...prev, employees: patch(prev.employees) } : prev));
      setNotice(
        payload?.message ||
          (enabled ? `Attendance is on for ${row.name}.` : `Attendance is off for ${row.name}.`)
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update attendance.');
    } finally {
      setTogglingId(null);
    }
  }

  async function toggleEmployeeFlexible(row) {
    if (!row?.id || row.can_toggle_attendance === false) return;
    const next = row.flexible_hours !== true;
    setTogglingFlexibleId(row.id);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.put(`/api/admin/attendance/${row.id}/flexible`, {
        enabled: next,
      });
      const enabled = Boolean(payload.enabled);
      const checks = Number(payload.checks_per_shift) > 0 ? Number(payload.checks_per_shift) : enabled ? 3 : row.checks_per_shift;
      setData((prev) =>
        prev
          ? {
              ...prev,
              employees: (prev.employees || []).map((item) =>
                item.id === row.id
                  ? {
                      ...item,
                      flexible_hours: enabled,
                      checks_per_shift: checks,
                    }
                  : item
              ),
            }
          : prev
      );
      setNotice(
        payload?.message ||
          (enabled ? `Flexible hours are on for ${row.name}.` : `Flexible hours are off for ${row.name}.`)
      );
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update flexible hours.');
    } finally {
      setTogglingFlexibleId(null);
    }
  }

  async function toggleEmployeeBreaks(row) {
    if (!row?.id || row.can_toggle_attendance === false) return;
    const next = row.breaks_enabled !== true;
    setTogglingBreaksId(row.id);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.put(`/api/admin/attendance/${row.id}/breaks`, {
        enabled: next,
      });
      const enabled = Boolean(payload.enabled);
      setData((prev) =>
        prev
          ? {
              ...prev,
              employees: (prev.employees || []).map((item) =>
                item.id === row.id
                  ? {
                      ...item,
                      breaks_enabled: enabled,
                      on_break: enabled ? item.on_break : false,
                      live_status:
                        !enabled && item.live_status === 'on_break' ? 'in_shift' : item.live_status,
                    }
                  : item
              ),
            }
          : prev
      );
      setNotice(
        payload?.message ||
          (enabled ? `Breaks are on for ${row.name}.` : `Breaks are off for ${row.name}.`)
      );
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update breaks.');
    } finally {
      setTogglingBreaksId(null);
    }
  }

  function openDaysEditor(row) {
    if (!row?.id || row.can_toggle_attendance === false) return;
    setDaysEdit({ user: row, days: workDaysFromRow(row) });
  }

  async function saveWorkDays(nextDays) {
    if (!daysEdit?.user?.id) return;
    const days = { ...defaultWorkDays(), ...nextDays };
    if (!WORK_DAY_OPTIONS.some(({ key }) => days[key])) {
      setError('Turn on at least one day.');
      return;
    }
    setSavingDays(true);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.put(`/api/admin/attendance/${daysEdit.user.id}/work-days`, {
        days,
      });
      const saved = payload?.days || days;
      setDaysEdit((prev) => (prev ? { ...prev, days: workDaysFromRow({ work_days: saved }) } : prev));
      setData((prev) =>
        prev
          ? {
              ...prev,
              employees: (prev.employees || []).map((item) =>
                item.id === daysEdit.user.id
                  ? {
                      ...item,
                      work_days: saved,
                      work_days_label: payload?.work_days_label || item.work_days_label,
                    }
                  : item
              ),
            }
          : prev
      );
      setNotice(payload?.message || `Work days saved for ${daysEdit.user.name}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save work days.');
    } finally {
      setSavingDays(false);
    }
  }

  function toggleWorkDay(key) {
    if (!daysEdit || savingDays) return;
    const days = { ...daysEdit.days, [key]: daysEdit.days[key] !== true };
    if (!WORK_DAY_OPTIONS.some(({ key: dayKey }) => days[dayKey])) {
      setError('Turn on at least one day.');
      return;
    }
    setDaysEdit((prev) => (prev ? { ...prev, days } : prev));
    saveWorkDays(days);
  }

  async function toggleEmployeePicture(row) {
    if (!ceo || !row?.id) return;
    const next = row.face_check_capture !== true;
    setTogglingPictureId(row.id);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.put(`/api/admin/attendance/${row.id}/face-capture`, {
        enabled: next,
      });
      const enabled = Boolean(payload.enabled);
      setData((prev) =>
        prev
          ? {
              ...prev,
              employees: (prev.employees || []).map((item) =>
                item.id === row.id ? { ...item, face_check_capture: enabled } : item
              ),
            }
          : prev
      );
      setNotice(
        payload?.message ||
          (enabled
            ? `Picture capture is on for ${row.name}.`
            : `Picture capture is off for ${row.name}.`)
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update picture capture.');
    } finally {
      setTogglingPictureId(null);
    }
  }

  async function sendCheckInRequest(row) {
    if (row.attendance_enabled === false || !row?.id || row.can_check_in_request === false) {
      return;
    }
    setRequestingId(row.id);
    setError('');
    setNotice('');
    try {
      const { data: payload } = await api.post(`/api/admin/attendance/${row.id}/check-in-request`);
      await load();
      setNotice(payload?.message || `Check-in request sent to ${row.name}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send check-in request.');
    } finally {
      setRequestingId(null);
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
              : 'Remote employees attendance — face checks per shift. Check count is set per employee. Only the CEO and people granted Remote employees can open this.'}
          </p>
        </div>
        <div className="attendance-hero-tools">
        {canRemote && canOnsite ? (
        <div className="attendance-mode-toggle" role="tablist" aria-label="Attendance type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'remote'}
            className={mode === 'remote' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => {
              setStatus('all');
              setBranch('all');
              setTeam('all');
              setMode('remote');
            }}
          >
            Remote employees attendance
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'onsite'}
            className={mode === 'onsite' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => {
              setStatus('all');
              setBranch('all');
              setTeam('all');
              setMode('onsite');
            }}
          >
            Onsite employees attendance
          </button>
        </div>
        ) : null}
        {ceo && canRemote ? (
          <Link className="btn btn-ghost attendance-face-link" to="/admin/attendance/face-checks">
            Face check photos
          </Link>
        ) : null}
        </div>
      </div>

      <div className="attendance-summary">
        {mode === 'onsite' ? (
          <>
            <div className="attendance-stat"><span>People</span><strong>{summary.employees}</strong></div>
            <div className="attendance-stat"><span>On time</span><strong>{summary.on_time}</strong></div>
            <div className="attendance-stat"><span>Late</span><strong>{summary.late}</strong></div>
            <div className="attendance-stat"><span>Absent / pending</span><strong>{(summary.absent || 0) + (summary.pending || 0)}</strong></div>
            <div className="attendance-stat"><span>Holiday</span><strong>{summary.holiday || 0}</strong></div>
          </>
        ) : (
          <>
            <div className="attendance-stat"><span>People</span><strong>{summary.employees}</strong></div>
            <div className="attendance-stat"><span>On shift now</span><strong>{(data?.employees || []).filter((row) => row.in_shift && !row.on_break).length}</strong></div>
            <div className="attendance-stat"><span>On break</span><strong>{(data?.employees || []).filter((row) => row.breaks_enabled && row.on_break).length}</strong></div>
            <div className="attendance-stat"><span>Waiting on a check</span><strong>{(data?.employees || []).filter((row) => row.in_shift && row.next_check_label).length}</strong></div>
            <div className="attendance-stat"><span>Missed</span><strong>{summary.missed}</strong></div>
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
          <input
            type="date"
            min={fullDays ? undefined : yesterdayKey}
            max={fullDays ? undefined : todayKey}
            value={date}
            onChange={(e) => setDate(dateForAdminFilter(e.target.value, fullDays))}
          />
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
                <option value="holiday">Holiday</option>
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
                <option value="holiday">Holiday</option>
              </>
            )}
          </select>
        </label>
        <label>
          Branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Filter by branch">
            <option value="all">All</option>
            {branchOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {branch !== 'all' && !branchOptions.includes(branch) && (
              <option value={branch}>{branch}</option>
            )}
          </select>
        </label>
        <label>
          Team
          <TeamFilterSelect
            value={team}
            onChange={setTeam}
            extraNames={teamOptions}
            className=""
          />
        </label>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, ID…"
          />
        </label>
        <button type="submit" className="btn btn-ghost">
          Apply
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {notice && mode === 'remote' && <p className="success">{notice}</p>}
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
                    <AttendancePhoto row={row} onOpen={setPhotoPreview} />
                    <div>
                      <strong>{row.name}</strong>
                      <p className="muted">
                        {row.employee_id || 'No ID'}
                        {row.branch ? ` · ${row.branch}` : ''}
                        {row.shift ? ` · ${row.shift}` : ''}
                      </p>
                    </div>
                    <div className="attendance-card-meta">
                      <EmployeeAttendanceSwitch
                        row={row}
                        busy={togglingId === row.id}
                        onToggle={toggleEmployeeAttendance}
                      />
                      <span className={`badge ${row.row_status}`}>{onsiteStatusLabel(row.row_status)}</span>
                    </div>
                  </header>
                  {row.attendance_enabled === false ? (
                    <p className="muted">Check-in paused for this employee. Manual mark still works.</p>
                  ) : null}
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
                              : datetimeLocalForDay(date, undefined, fullDays),
                            note: row.record?.note || '',
                          })
                        }
                      >
                        {row.record && fullDays ? 'Update check-in' : 'Add check-in'}
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
                    {canDeleteAttendance && row.record && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={deletingId === `onsite-${row.record.id}`}
                        onClick={() => deleteOnsiteRecord(row)}
                      >
                        {deletingId === `onsite-${row.record.id}` ? 'Deleting…' : 'Delete attendance'}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => openOnsiteMonth(row)}>
                      This month
                    </button>
                    {!row.can_manual && !row.can_override && !row.record && (
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
            <article
              key={row.id}
              className={`attendance-admin-card${row.in_shift ? ' is-on-shift' : ''}${row.breaks_enabled && row.on_break ? ' is-on-break' : ''}`}
            >
              <header>
                <AttendancePhoto row={row} onOpen={setPhotoPreview} />
                <div>
                  <strong>{row.name}</strong>
                  <p className="muted">
                    {row.employee_id || 'No ID'}
                    {row.branch ? ` · ${row.branch}` : ''}
                    {row.department ? ` · ${row.department}` : ''}
                  </p>
                </div>
                <div className="attendance-card-meta">
                  <div className="attendance-card-toggles">
                    <EmployeeAttendanceSwitch
                      row={row}
                      busy={togglingId === row.id}
                      onToggle={toggleEmployeeAttendance}
                    />
                    <EmployeeFlexibleSwitch
                      row={row}
                      busy={togglingFlexibleId === row.id}
                      onToggle={toggleEmployeeFlexible}
                    />
                    <EmployeeBreaksSwitch
                      row={row}
                      busy={togglingBreaksId === row.id}
                      onToggle={toggleEmployeeBreaks}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost attendance-days-btn"
                      disabled={row.can_toggle_attendance === false}
                      onClick={() => openDaysEditor(row)}
                    >
                      Days
                    </button>
                    {ceo ? (
                      <EmployeePictureSwitch
                        row={row}
                        busy={togglingPictureId === row.id}
                        onToggle={toggleEmployeePicture}
                      />
                    ) : null}
                  </div>
                  <span className={`badge ${row.live_status || row.row_status}`}>
                    {liveStatusLabel(row)}
                  </span>
                </div>
              </header>
              <p className="attendance-shift-track">{shiftTrackLine(row)}</p>
              {(row.work_label || row.first_check_in || (row.breaks_enabled && (row.breaks || []).length > 0)) && (
                <ShiftHoursDetail
                  workLabel={row.work_label}
                  breakLabel={row.break_label}
                  firstCheckIn={row.first_check_in}
                  checkedOutAt={row.checked_out_at}
                  breaks={row.breaks_enabled ? row.breaks : []}
                  onBreak={Boolean(row.breaks_enabled && row.on_break)}
                  showBreak={row.breaks_enabled === true}
                />
              )}
              {row.profile_complete === false ? (
                <p className="muted">
                  Profile is incomplete. This employee cannot self check-in until they complete it.
                </p>
              ) : row.attendance_enabled === false ? (
                <p className="muted">Check-in paused for this employee. Manual mark still works.</p>
              ) : row.live_status === 'holiday' || row.row_status === 'holiday' ? (
                <p className="muted">Day off — this weekday is turned off. No checks today.</p>
              ) : null}
              {ceo && row.face_check_capture ? (
                <p className="muted">Picture capture is on — check-in photos are saved for review.</p>
              ) : null}
              <div className="attendance-mini-slots">
                {[...row.slots]
                  .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
                  .map((slot) => (
                  <span
                    key={slot.hour_key}
                    className={`dot ${slot.state}`}
                    title={`${slot.label}${slot.scheduled_at ? ` · ${formatKarachiTime(slot.scheduled_at)}` : ''}${slot.checked_in_at ? ` · in ${formatKarachiTime(slot.checked_in_at)}` : ''} · ${slot.state}`}
                  >
                    {slotDotLabel(slot)}
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
                        remote_check_count: row.checks_per_shift ?? (row.flexible_hours ? 3 : 5),
                        flexible_hours: Boolean(row.flexible_hours),
                      })
                    }
                  >
                    Set hours
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => openHistory(row, 'detail')}>
                    Daily records
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => openHistory(row, 'summary')}>
                    This month
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={requestingId === row.id || row.can_check_in_request === false}
                    title={checkInRequestButton(row).title}
                    onClick={() => sendCheckInRequest(row)}
                  >
                    {requestingId === row.id ? 'Sending…' : checkInRequestButton(row).label}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    title="Manually mark this check"
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
                  <RemoteDeleteButtons
                    row={row}
                    canDelete={canDeleteAttendance}
                    deletingId={deletingId}
                    onDeleteLast={deleteRemoteLast}
                    onDeleteDay={deleteRemoteDay}
                  />
                </div>
              ) : (
                <div className="attendance-admin-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => openHistory(row, 'detail')}>
                    Daily records
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => openHistory(row, 'summary')}>
                    This month
                  </button>
                  <RemoteDeleteButtons
                    row={row}
                    canDelete={canDeleteAttendance}
                    deletingId={deletingId}
                    onDeleteLast={deleteRemoteLast}
                    onDeleteDay={deleteRemoteDay}
                  />
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
            <p className="muted">{manual.user.name} — reason is optional.</p>
            <label>
              Hour / check {manual.status === 'leave' ? '(not used for leave)' : ''}
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
              Reason (optional)
              <textarea
                rows={3}
                value={manual.note}
                onChange={(e) => setManual((m) => ({ ...m, note: e.target.value }))}
                placeholder="Why are you overriding this slot? (optional)"
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

      {daysEdit?.user && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => !savingDays && setDaysEdit(null)}>
          <div
            className="modal-card work-days-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Work days"
          >
            <h2>Days</h2>
            <p className="muted">
              {daysEdit.user.name} — turn each weekday on or off. Off days have no attendance checks.
            </p>
            <ul className="work-days-list">
              {WORK_DAY_OPTIONS.map(({ key, label }) => {
                const on = daysEdit.days[key] !== false;
                return (
                  <li key={key}>
                    <EmployeePowerSwitch
                      label={label}
                      name={daysEdit.user.name}
                      on={on}
                      busy={savingDays}
                      disabled={savingDays}
                      onToggle={() => toggleWorkDay(key)}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" disabled={savingDays} onClick={() => setDaysEdit(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {hoursEdit.user && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => setHoursEdit(EMPTY_HOURS)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submitHours}>
            <h2>Working hours</h2>
            <p className="muted">
              {hoursEdit.flexible_hours
                ? `${hoursEdit.user.name}'s assigned hours are the window for the random check. First check-in and check-out can happen anytime today.`
                : `${hoursEdit.user.name} can only check in during these hours.`}
            </p>
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
            <label>
              Checks per shift
              <input
                type="number"
                min={hoursEdit.flexible_hours ? 2 : 1}
                max={8}
                step={1}
                value={hoursEdit.remote_check_count ?? (hoursEdit.flexible_hours ? 3 : 5)}
                onChange={(e) =>
                  setHoursEdit((h) => ({
                    ...h,
                    remote_check_count: Number(e.target.value) || 1,
                  }))
                }
              />
            </label>
            <p className="muted">
              {hoursEdit.flexible_hours
                ? 'Flexible default is 3 (first check-in + 1 random + check-out). Allowed range: 2–8.'
                : 'Includes the shift-start check. Default is 5 (1 start + 4 random). Allowed range: 1–8.'}
            </p>
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

      {onsiteMonth && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={() => setOnsiteMonth(null)}>
          <div className="modal-card history-card" onClick={(e) => e.stopPropagation()}>
            <h2>{onsiteMonth.employee?.name || 'This month'}</h2>
            <p className="muted">{onsiteMonth.month} summary</p>
            <div className="attendance-month-summary">
              <div className="attendance-stat">
                <span>On time</span>
                <strong>{onsiteMonth.totals?.on_time || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Late</span>
                <strong>{onsiteMonth.totals?.late || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Absent</span>
                <strong>{onsiteMonth.totals?.absent || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Days recorded</span>
                <strong>{onsiteMonth.recorded || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Holiday</span>
                <strong>{onsiteMonth.totals?.holiday || 0}</strong>
              </div>
            </div>
            <ol className="attendance-day-list">
              {(onsiteMonth.days || []).map((day) => (
                <li key={day.work_date} className={`attendance-day ${day.status}`}>
                  <div className="attendance-day-main">
                    <span className="attendance-day-date">{day.work_date}</span>
                    <span className="muted">
                      {day.checked_in_at ? formatKarachiTime(day.checked_in_at) : day.status === 'holiday' ? 'Holiday' : 'No check-in'}
                      {day.method ? ` · ${day.method}` : ''}
                    </span>
                  </div>
                  <span className="attendance-day-status">{onsiteStatusLabel(day.status)}</span>
                </li>
              ))}
              {(onsiteMonth.days || []).length === 0 && (
                <li className="muted">No check-ins this month.</li>
              )}
            </ol>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setOnsiteMonth(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {history && (
        <div
          className="modal-backdrop modal-backdrop-stack"
          onClick={() => {
            setDayFaceChecks(null);
            setHistory(null);
          }}
        >
          <div className="modal-card history-card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {history.employee?.name || 'Attendance'}
              {historyMode === 'summary' ? ' — this month' : ' — daily records'}
            </h2>
            <p className="muted">{history.month}</p>
            <div className="attendance-month-summary">
              <div className="attendance-stat">
                <span>Present</span>
                <strong>{history.totals?.present || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Late</span>
                <strong>{history.totals?.late || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Absent</span>
                <strong>{history.totals?.absent || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Leave</span>
                <strong>{history.totals?.leave || 0}</strong>
              </div>
              <div className="attendance-stat">
                <span>Holiday</span>
                <strong>{history.totals?.holiday || 0}</strong>
              </div>
            </div>
            {historyMode === 'detail' ? (
              <ol className="attendance-day-list attendance-day-detail-list">
                {(history.days || []).map((day) => (
                  <li key={day.date} className={`attendance-day-detail ${day.status}`}>
                    <div className="attendance-day-detail-head">
                      <span className="attendance-day-date">{day.date}</span>
                      {ceo ? (
                        history.employee?.face_check_capture ? (
                          <button
                            type="button"
                            className="btn btn-ghost attendance-time-edit"
                            onClick={() =>
                              setDayFaceChecks({
                                date: day.date,
                                name: history.employee?.name || '',
                                captures: day.face_checks || [],
                              })
                            }
                          >
                            Face check
                          </button>
                        ) : (
                          <span className="muted attendance-no-face">No face detection</span>
                        )
                      ) : null}
                      <span className="attendance-day-status">{dayStatusLabel(day.status)}</span>
                      {day.work_label ? (
                        <span className="muted"> · work {day.work_label}</span>
                      ) : day.duration_label ? (
                        <span className="muted"> · {day.duration_label}</span>
                      ) : null}
                      {history.employee?.breaks_enabled && day.break_minutes > 0 ? (
                        <span className="muted"> · break {day.break_label}</span>
                      ) : null}
                    </div>
                    <ul className="attendance-check-list">
                      {(day.slots || [])
                        .slice()
                        .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
                        .map((slot) => (
                        <li key={slot.hour_key || slot.seq}>
                          <span>
                            {slot.kind === 'checkout'
                              ? 'Check out'
                              : slot.seq === 1 || slot.kind === 'start'
                                ? 'Start'
                                : `Check ${slot.seq || slot.label}`}
                            {slot.scheduled_at ? ` · ${formatKarachiTime(slot.scheduled_at)}` : ''}
                          </span>
                          {day.status !== 'holiday' &&
                          canEditCheckTime(day.date, fullDays) &&
                          (slot.hour_key || slot.scheduled_at) ? (
                            <button
                              type="button"
                              className="btn btn-ghost attendance-time-edit"
                              onClick={() => openTimeEdit(slot, day.date)}
                            >
                              Edit time
                            </button>
                          ) : null}
                          <span>
                            {checkStateLabel(slot.state)}
                            {slot.checked_in_at ? ` · in ${formatKarachiTime(slot.checked_in_at)}` : ''}
                            {slot.method ? ` · ${slot.method}` : ''}
                          </span>
                        </li>
                      ))}
                      {!(day.slots || []).length && <li className="muted">No checks recorded.</li>}
                    </ul>
                  </li>
                ))}
                {(history.days || []).length === 0 && (
                  <li className="muted">No daily records yet this month.</li>
                )}
              </ol>
            ) : (
              <ol className="attendance-day-list">
                {(history.days || []).map((day) => (
                  <li key={day.date} className={`attendance-day ${day.status}`}>
                    <span className="attendance-day-date">{day.date}</span>
                    <span className="attendance-day-status">{dayStatusLabel(day.status)}</span>
                    {day.work_label ? (
                      <span className="muted"> · work {day.work_label}</span>
                    ) : day.duration_label ? (
                      <span className="muted"> · {day.duration_label}</span>
                    ) : null}
                    {history.employee?.breaks_enabled && day.break_minutes > 0 ? (
                      <span className="muted"> · break {day.break_label}</span>
                    ) : null}
                    {history.employee?.breaks_enabled && (day.breaks || []).length > 0 ? (
                      <ShiftHoursDetail
                        workLabel={day.work_label}
                        breakLabel={day.break_label}
                        firstCheckIn={day.first_check_in}
                        checkedOutAt={day.checked_out_at}
                        breaks={day.breaks}
                        showBreak
                      />
                    ) : null}
                  </li>
                ))}
                {(history.days || []).length === 0 && (
                  <li className="muted">No daily records yet this month.</li>
                )}
              </ol>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setDayFaceChecks(null);
                  setHistory(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {ceo && dayFaceChecks && (
        <div
          className="modal-backdrop modal-backdrop-stack"
          onClick={() => setDayFaceChecks(null)}
        >
          <div className="modal-card history-card" onClick={(e) => e.stopPropagation()}>
            <h2>Face check — {dayFaceChecks.date}</h2>
            <p className="muted">{dayFaceChecks.name || 'Remote employee'}</p>
            {(dayFaceChecks.captures || []).length === 0 ? (
              <p className="muted">No face check photos for this day.</p>
            ) : (
              <div className="face-check-grid">
                {dayFaceChecks.captures.map((shot) => (
                  <article key={shot.id} className="face-check-card">
                    <FaceCheckShot
                      captureId={shot.id}
                      cacheKey={shot.captured_at || shot.id}
                      name={dayFaceChecks.name}
                      onOpen={setPhotoPreview}
                    />
                    <div className="face-check-meta">
                      <span className={`badge ${shot.status || ''}`}>{shot.status || 'saved'}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDayFaceChecks(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {timeEdit.userId && (
        <div
          className="modal-backdrop modal-backdrop-stack"
          onClick={() => setTimeEdit(EMPTY_TIME_EDIT)}
        >
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submitTimeEdit}>
            <h2>Edit check time</h2>
            <p className="muted">
              {timeEdit.name} — {timeEdit.label}. Times are Pakistan time.
            </p>
            {error && <p className="error">{error}</p>}
            <label>
              Scheduled time
              <input
                type="datetime-local"
                required
                value={timeEdit.scheduled_at}
                onChange={(e) => setTimeEdit((m) => ({ ...m, scheduled_at: e.target.value }))}
              />
            </label>
            {timeEdit.hasCheckIn && (
              <label>
                Check-in time
                <input
                  type="datetime-local"
                  value={timeEdit.checked_in_at}
                  onChange={(e) => setTimeEdit((m) => ({ ...m, checked_in_at: e.target.value }))}
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTimeEdit(EMPTY_TIME_EDIT)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save time'}
              </button>
            </div>
          </form>
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
              {onsiteManual.user.name} —{' '}
              {fullDays
                ? 'Any previous or upcoming date. Status follows their shift.'
                : 'only today or yesterday. Status follows their shift.'}
            </p>
            {error && <p className="error">{error}</p>}
            <label>
              Check-in time
              <input
                type="datetime-local"
                required
                min={fullDays ? undefined : `${yesterdayKey}T00:00`}
                max={fullDays ? undefined : `${todayKey}T23:59`}
                value={onsiteManual.checked_in_at}
                onChange={(e) => {
                  const raw = e.target.value;
                  const day = dateForAdminFilter(raw.slice(0, 10), fullDays);
                  const time = raw.includes('T') ? raw.slice(raw.indexOf('T') + 1) : '09:00';
                  setOnsiteManual((m) => ({ ...m, checked_in_at: `${day}T${time}` }));
                }}
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
      <PhotoLightbox
        open={Boolean(photoPreview?.src)}
        src={photoPreview?.src}
        alt={photoPreview?.alt}
        onClose={() => setPhotoPreview(null)}
      />
    </div>
  );
}
