const pool = require('../config/db');
const { writeAuditLog } = require('../utils/auditLog');
const {
  normalizeScope,
  scopeWhereClause,
  employeeMatchesScope,
} = require('../utils/employeeScope');
const { zonedParts } = require('../utils/attendanceWindows');
const { isSundayDateKey } = require('../utils/workWeek');
const { statusForCheckIn } = require('../utils/onsiteShiftStatus');
const {
  ATTENDANCE_SUMMARY_COLUMNS,
  buildAttendanceExcelXml,
  buildAttendancePdf,
  buildAttendanceBaseName,
  displayAttendanceRows,
} = require('../utils/attendanceExportFiles');

function isCeo(req) {
  return String(req.user?.role || '').toLowerCase() === 'ceo';
}

function exportScope(req) {
  if (isCeo(req)) return { type: 'all' };
  return normalizeScope(req.user?.permissionScopes?.['attendance:export']);
}

function cleanFilter(value) {
  const text = String(value || '').trim();
  return text && text.toLowerCase() !== 'all' ? text : '';
}

function assertFilterAllowed(scope, field, value) {
  if (!value) return null;
  const s = normalizeScope(scope);
  if (s.type === 'all') return null;
  if (field === 'branch' && s.type === 'branch' && !s.values.includes(value)) {
    return 'That branch is outside your export assignment.';
  }
  if (field === 'team' && s.type === 'team' && !s.values.includes(value)) {
    return 'That team is outside your export assignment.';
  }
  return null;
}

function formatMonthLabel(monthKey) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthKey;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function generateRecentMonths(count = 12) {
  const today = zonedParts().dateKey;
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const months = [];

  for (let i = 0; i < count; i += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push({
      value: key,
      label: formatMonthLabel(key),
    });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

function buildMonthDays(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [];

  for (let d = 1; d <= lastDay; d += 1) {
    const dateKey = `${match[1]}-${match[2]}-${String(d).padStart(2, '0')}`;
    const dt = new Date(Date.UTC(year, month - 1, d));
    const dayOfWeek = dt.getUTCDay();
    days.push({
      dateKey,
      day: d,
      isSunday: dayOfWeek === 0,
      weekdayShort: weekdays[dayOfWeek],
    });
  }
  return days;
}

function attachmentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function recordExportLog({ actorId, format, dataLimit, rowCount }) {
  try {
    const { rows: people } = await pool.query(
      `SELECT name, username, employee_id FROM users WHERE id = $1 LIMIT 1`,
      [actorId]
    );
    const person = people[0] || {};
    await pool.query(
      `
        CREATE TABLE IF NOT EXISTS employee_export_logs (
          id BIGSERIAL PRIMARY KEY,
          actor_id BIGINT,
          actor_name TEXT,
          actor_username TEXT,
          actor_employee_id TEXT,
          format TEXT NOT NULL,
          data_limit TEXT NOT NULL,
          row_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS employee_export_logs_created_at_idx
          ON employee_export_logs (created_at DESC);
      `
    );
    await pool.query(
      `
        INSERT INTO employee_export_logs (
          actor_id, actor_name, actor_username, actor_employee_id,
          format, data_limit, row_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        actorId || null,
        person.name || null,
        person.username || null,
        person.employee_id || null,
        format,
        dataLimit,
        Number(rowCount) || 0,
      ]
    );
  } catch (err) {
    console.warn('recordExportLog failed:', err.message || err);
  }
}

function readFilters(req) {
  const scope = exportScope(req);
  const parts = zonedParts();
  const currentMonth = parts.dateKey.slice(0, 7);
  const rawMonth = String(req.query.month || currentMonth).trim();
  const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : currentMonth;

  const filters = {
    month,
    branch: cleanFilter(req.query.branch),
    team: cleanFilter(req.query.team || req.query.department),
    shift: cleanFilter(req.query.shift),
  };

  const blocked =
    assertFilterAllowed(scope, 'branch', filters.branch) ||
    assertFilterAllowed(scope, 'team', filters.team);

  return { scope, filters, blocked };
}

function describeAttendanceFilters(filters, scope) {
  const parts = [];
  parts.push(`Month: ${formatMonthLabel(filters.month)}`);

  const s = normalizeScope(scope);
  if (s.type === 'branch') parts.push(`Assigned branch: ${s.values.join(', ')}`);
  if (s.type === 'team') parts.push(`Assigned team: ${s.values.join(', ')}`);

  if (filters.team) parts.push(`Team: ${filters.team}`);
  if (filters.branch) parts.push(`Branch: ${filters.branch}`);
  if (filters.shift) parts.push(`Shift: ${filters.shift}`);
  return parts.join(' · ');
}

/**
 * Load attendance summary and daily records for all employees based on filters.
 */
async function loadAttendanceData(scope, filters) {
  const scoped = scopeWhereClause(scope, 1);
  const params = [...scoped.params];
  let sql = `
    FROM users
    WHERE is_active = true
      AND COALESCE(status, 'active') = 'active'
      AND COALESCE(staff_kind, 'portal') <> 'lower'
      ${scoped.sql}
  `;

  let i = 1 + scoped.params.length;
  if (filters.branch) {
    sql += ` AND COALESCE(TRIM(branch), '') = $${i}`;
    params.push(filters.branch);
    i += 1;
  }
  if (filters.team) {
    sql += ` AND COALESCE(TRIM(department), '') = $${i}`;
    params.push(filters.team);
    i += 1;
  }
  if (filters.shift) {
    sql += ` AND COALESCE(TRIM(shift), '') = $${i}`;
    params.push(filters.shift);
    i += 1;
  }

  const { rows: people } = await pool.query(
    `
      SELECT id, employee_id, username, name, email, department, designation, branch, shift,
             COALESCE(NULLIF(TRIM(employment_type), ''), 'onsite') AS employment_type,
             to_char(date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
             work_start_hour, work_end_hour, is_active, status
      ${sql}
      ORDER BY branch NULLS LAST, department NULLS LAST, name ASC, employee_id ASC
    `,
    params
  );

  const allowedPeople = people.filter((p) => employeeMatchesScope(p, scope));
  const daysInMonth = buildMonthDays(filters.month);
  const todayKey = zonedParts().dateKey;
  const isPastMonth = filters.month < todayKey.slice(0, 7);

  const onsiteIds = allowedPeople
    .filter((p) => p.employment_type !== 'remote')
    .map((p) => p.id);
  const remoteIds = allowedPeople
    .filter((p) => p.employment_type === 'remote')
    .map((p) => p.id);

  // Load shifts for onsite employees live status calculation
  const { rows: shiftRows } = await pool.query(
    `SELECT name, start_time, late_after, absent_after FROM shifts`
  ).catch(() => ({ rows: [] }));
  const shiftsMap = new Map(
    shiftRows.map((s) => [String(s.name || '').trim().toLowerCase(), s])
  );

  // 1. Batch load onsite attendance
  let onsiteRecords = [];
  if (onsiteIds.length) {
    const { rows } = await pool.query(
      `
        SELECT user_id,
               to_char(work_date, 'YYYY-MM-DD') AS work_date,
               checked_in_at, status, method, shift_name, status_overridden
        FROM onsite_attendance
        WHERE to_char(work_date, 'YYYY-MM') = $1
          AND user_id = ANY($2::int[])
      `,
      [filters.month, onsiteIds]
    );
    onsiteRecords = rows;
  }
  const onsiteMap = new Map();
  for (const r of onsiteRecords) {
    const key = `${r.user_id}:${r.work_date}`;
    onsiteMap.set(key, r);
  }

  // 2. Batch load remote attendance (days, logs)
  let remoteDayRows = [];
  let remoteLogRows = [];
  if (remoteIds.length) {
    const [daysRes, logsRes] = await Promise.all([
      pool.query(
        `
          SELECT user_id, date_key, status, first_check_in, note
          FROM attendance_days
          WHERE date_key LIKE $1
            AND user_id = ANY($2::int[])
        `,
        [`${filters.month}-%`, remoteIds]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `
          SELECT user_id, hour_key, status, method, checked_in_at
          FROM attendance_logs
          WHERE hour_key LIKE $1
            AND user_id = ANY($2::int[])
        `,
        [`${filters.month}-%`, remoteIds]
      ).catch(() => ({ rows: [] })),
    ]);
    remoteDayRows = daysRes.rows;
    remoteLogRows = logsRes.rows;
  }

  const remoteDaysMap = new Map();
  for (const r of remoteDayRows) {
    const key = `${r.user_id}:${r.date_key}`;
    remoteDaysMap.set(key, r);
  }

  const remoteLogsMap = new Map();
  for (const r of remoteLogRows) {
    const dateKey = String(r.hour_key || '').slice(0, 10);
    const key = `${r.user_id}:${dateKey}`;
    if (!remoteLogsMap.has(key)) remoteLogsMap.set(key, []);
    remoteLogsMap.get(key).push(r);
  }

  // Process attendance for each employee
  const records = [];
  for (const person of allowedPeople) {
    const isRemote = person.employment_type === 'remote';
    const doj = person.date_of_joining || '';
    const shift = person.shift
      ? shiftsMap.get(String(person.shift).trim().toLowerCase())
      : null;

    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let holidayCount = 0;
    let workingDaysCount = 0;
    const dailyCodes = {};

    for (const day of daysInMonth) {
      const dateKey = day.dateKey;
      const isPastOrToday = isPastMonth || dateKey <= todayKey;
      const notJoinedYet = doj && dateKey < doj;

      if (notJoinedYet) {
        dailyCodes[dateKey] = '-';
        continue;
      }

      if (day.isSunday) {
        holidayCount += 1;
        dailyCodes[dateKey] = 'H';
        continue;
      }

      // Non-Sunday working day
      if (isPastOrToday) {
        workingDaysCount += 1;
      }

      if (isRemote) {
        // Remote attendance evaluation
        const dayRecord = remoteDaysMap.get(`${person.id}:${dateKey}`);
        const logs = remoteLogsMap.get(`${person.id}:${dateKey}`) || [];

        if (dayRecord?.status === 'leave') {
          leaveCount += 1;
          dailyCodes[dateKey] = 'Lv';
        } else if (dayRecord?.status === 'present' || dayRecord?.status === 'verified') {
          presentCount += 1;
          dailyCodes[dateKey] = 'P';
        } else if (dayRecord?.status === 'late') {
          lateCount += 1;
          dailyCodes[dateKey] = 'L';
        } else if (dayRecord?.status === 'absent' || dayRecord?.status === 'missed') {
          absentCount += 1;
          dailyCodes[dateKey] = 'A';
        } else if (logs.some((l) => ['verified', 'present'].includes(l.status))) {
          presentCount += 1;
          dailyCodes[dateKey] = 'P';
        } else if (logs.some((l) => l.status === 'late')) {
          lateCount += 1;
          dailyCodes[dateKey] = 'L';
        } else {
          // No record
          if (dateKey > todayKey) {
            dailyCodes[dateKey] = '-';
          } else if (dateKey === todayKey) {
            dailyCodes[dateKey] = '-';
          } else {
            absentCount += 1;
            dailyCodes[dateKey] = 'A';
          }
        }
      } else {
        // Onsite attendance evaluation
        const onsiteRow = onsiteMap.get(`${person.id}:${dateKey}`);
        if (onsiteRow) {
          let rowStatus = onsiteRow.status;
          if (!onsiteRow.status_overridden && shift && onsiteRow.checked_in_at) {
            try {
              const calc = statusForCheckIn(new Date(onsiteRow.checked_in_at), shift);
              rowStatus = calc.status;
            } catch {
              /* keep original status */
            }
          }

          if (rowStatus === 'on_time') {
            presentCount += 1;
            dailyCodes[dateKey] = 'P';
          } else if (rowStatus === 'late') {
            lateCount += 1;
            dailyCodes[dateKey] = 'L';
          } else if (rowStatus === 'absent') {
            absentCount += 1;
            dailyCodes[dateKey] = 'A';
          } else {
            dailyCodes[dateKey] = '-';
          }
        } else {
          // No onsite check-in record
          if (dateKey > todayKey) {
            dailyCodes[dateKey] = '-';
          } else if (dateKey === todayKey) {
            dailyCodes[dateKey] = '-';
          } else {
            absentCount += 1;
            dailyCodes[dateKey] = 'A';
          }
        }
      }
    }

    const attendedDays = presentCount + lateCount;
    const attendanceRate =
      workingDaysCount > 0
        ? Math.min(100, Math.round((attendedDays / workingDaysCount) * 100))
        : 100;

    records.push({
      id: person.id,
      employee_id: person.employee_id || '—',
      name: person.name || person.username || '—',
      department: person.department || '—',
      branch: person.branch || '—',
      shift: person.shift || '—',
      total_days: daysInMonth.length,
      working_days: workingDaysCount,
      present_days: presentCount,
      late_days: lateCount,
      absent_days: absentCount,
      leave_days: leaveCount,
      holiday_days: holidayCount,
      attendance_rate: attendanceRate,
      daily_codes: dailyCodes,
    });
  }

  return {
    records,
    daysInMonth,
  };
}

/**
 * GET /api/admin/attendance/export-options
 */
async function getAttendanceExportOptions(req, res) {
  try {
    const scope = exportScope(req);
    const monthsList = generateRecentMonths(18);

    // Also fetch any recorded months from DB
    const [onsiteMonthsRes, remoteMonthsRes] = await Promise.all([
      pool.query(`SELECT DISTINCT to_char(work_date, 'YYYY-MM') AS month FROM onsite_attendance`),
      pool.query(`SELECT DISTINCT substr(date_key, 1, 7) AS month FROM attendance_days`),
    ]).catch(() => [{ rows: [] }, { rows: [] }]);

    const seenMonths = new Set(monthsList.map((m) => m.value));
    for (const r of [...onsiteMonthsRes.rows, ...remoteMonthsRes.rows]) {
      if (r.month && /^\d{4}-\d{2}$/.test(r.month) && !seenMonths.has(r.month)) {
        seenMonths.add(r.month);
        monthsList.push({
          value: r.month,
          label: formatMonthLabel(r.month),
        });
      }
    }
    monthsList.sort((a, b) => b.value.localeCompare(a.value));

    // Get branches, teams, shifts from active employees
    const scoped = scopeWhereClause(scope, 1);
    const distinct = await pool.query(
      `
        SELECT
          NULLIF(TRIM(branch), '') AS branch,
          NULLIF(TRIM(department), '') AS team,
          NULLIF(TRIM(shift), '') AS shift
        FROM users
        WHERE is_active = true
          AND COALESCE(staff_kind, 'portal') <> 'lower'
          ${scoped.sql}
      `,
      scoped.params
    );

    const branches = new Set();
    const teams = new Set();
    const shifts = new Set();
    for (const row of distinct.rows) {
      if (row.branch) branches.add(row.branch);
      if (row.team) teams.add(row.team);
      if (row.shift) shifts.add(row.shift);
    }
    if (scope.type === 'branch') scope.values.forEach((v) => branches.add(v));
    if (scope.type === 'team') scope.values.forEach((v) => teams.add(v));

    return res.json({
      scope,
      ceo: isCeo(req),
      months: monthsList,
      branches: [...branches].sort((a, b) => a.localeCompare(b)),
      teams: [...teams].sort((a, b) => a.localeCompare(b)),
      shifts: [...shifts].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    console.error('getAttendanceExportOptions error:', err);
    return res.status(500).json({ message: 'Server error loading export options.' });
  }
}

/**
 * GET /api/admin/attendance/export-preview
 */
async function listAttendanceExportPreview(req, res) {
  try {
    const { scope, filters, blocked } = readFilters(req);
    if (blocked) {
      return res.status(403).json({ message: blocked });
    }

    const { records } = await loadAttendanceData(scope, filters);
    const filenameBase = buildAttendanceBaseName(filters, filters.month);

    return res.json({
      count: records.length,
      month: filters.month,
      monthLabel: formatMonthLabel(filters.month),
      filenameBase,
      columns: ATTENDANCE_SUMMARY_COLUMNS.map(({ key, label }) => ({ key, label })),
      records: displayAttendanceRows(records),
    });
  } catch (err) {
    console.error('listAttendanceExportPreview error:', err);
    return res.status(500).json({ message: 'Server error loading attendance export preview.' });
  }
}

/**
 * GET /api/admin/attendance/export
 */
async function exportAttendance(req, res) {
  try {
    const { scope, filters, blocked } = readFilters(req);
    if (blocked) {
      return res.status(403).json({ message: blocked });
    }

    const format = String(req.query.format || 'xlsx')
      .trim()
      .toLowerCase();
    if (format !== 'xlsx' && format !== 'excel' && format !== 'pdf') {
      return res.status(400).json({ message: 'format must be xlsx or pdf.' });
    }

    const { records, daysInMonth } = await loadAttendanceData(scope, filters);
    const filtersLabel = describeAttendanceFilters(filters, scope);
    const filenameBase = buildAttendanceBaseName(filters, filters.month);

    const { rows: actorRows } = await pool.query(
      `SELECT name, username FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const generatedBy =
      String(actorRows[0]?.name || actorRows[0]?.username || '').trim() || 'Unknown';

    const meta = {
      title: 'Textured Lab Monthly Attendance Export',
      month: formatMonthLabel(filters.month),
      monthKey: filters.month,
      filters: filtersLabel,
      generatedAt: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
      generatedBy,
    };

    // Log export
    try {
      const limitLabel = [
        `Month: ${filters.month}`,
        filters.branch ? `Branch: ${filters.branch}` : '',
        filters.team ? `Team: ${filters.team}` : '',
        filters.shift ? `Shift: ${filters.shift}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      await recordExportLog({
        actorId: req.user.id,
        format: `${format.toUpperCase()} Attendance`,
        dataLimit: limitLabel,
        rowCount: records.length,
      });

      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'attendance_data_exported',
        targetTable: 'onsite_attendance',
        targetId: req.user.id,
        reason: `${format.toUpperCase()} Attendance · ${records.length} records · ${limitLabel}`,
      });
    } catch (auditErr) {
      console.warn('attendance_data_exported audit failed:', auditErr.message || auditErr);
    }

    if (format === 'pdf') {
      const pdfName = `${filenameBase}.pdf`;
      const buffer = await buildAttendancePdf(records, daysInMonth, meta);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', attachmentDisposition(pdfName));
      res.setHeader('X-Export-Filename', pdfName);
      return res.send(buffer);
    }

    const excelName = `${filenameBase}.xls`;
    const xml = buildAttendanceExcelXml(records, daysInMonth, meta);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentDisposition(excelName));
    res.setHeader('X-Export-Filename', excelName);
    return res.send(xml);
  } catch (err) {
    console.error('exportAttendance error:', err);
    return res.status(500).json({ message: 'Server error exporting attendance records.' });
  }
}

module.exports = {
  getAttendanceExportOptions,
  listAttendanceExportPreview,
  exportAttendance,
};
