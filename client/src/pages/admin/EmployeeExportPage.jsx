import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import { describeEmployeeScope } from '../../utils/employeeScope';
import './AdminDashboard.css';

function describeAssignment(scope, ceo) {
  if (ceo) return 'CEO: every branch, team, and shift.';
  return describeEmployeeScope(scope);
}

function describeActiveFilters({ branch, team, shift }) {
  const parts = [
    team ? `Team: ${team}` : 'Team: all assigned teams',
    branch ? `Branch: ${branch}` : 'Branch: all assigned branches',
    shift ? `Shift: ${shift}` : 'Shift: all shifts',
  ];
  return parts.join(' · ');
}

function parseDownloadName(res, format) {
  const headerName = String(res.headers['x-export-filename'] || '').trim();
  if (headerName) return headerName;
  const disposition = String(res.headers['content-disposition'] || '');
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* keep scanning */
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return format === 'pdf' ? 'TL All Teams All Branches All Shifts.pdf' : 'TL All Teams All Branches All Shifts.xls';
}

async function downloadBlob(format, filters) {
  try {
    const res = await api.get('/api/admin/employees/export', {
      params: {
        format,
        branch: filters.branch || undefined,
        team: filters.team || undefined,
        shift: filters.shift || undefined,
      },
      responseType: 'blob',
    });
    const type = String(res.headers['content-type'] || '');
    if (type.includes('application/json')) {
      const text = await res.data.text();
      let message = 'Export failed.';
      try {
        message = JSON.parse(text)?.message || message;
      } catch {
        /* keep default */
      }
      throw new Error(message);
    }
    const filename = parseDownloadName(res, format);
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return filename;
  } catch (err) {
    const data = err.response?.data;
    if (data instanceof Blob) {
      const text = await data.text();
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed.message || 'Export failed.');
      } catch (inner) {
        if (inner.message && inner.message !== 'Export failed.') throw inner;
      }
    }
    throw err;
  }
}

export default function EmployeeExportPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [options, setOptions] = useState({
    branches: [],
    teams: [],
    shifts: [],
    scope: { type: 'all' },
    ceo: false,
  });
  const [branch, setBranch] = useState('');
  const [team, setTeam] = useState('');
  const [shift, setShift] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [columns, setColumns] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filenameBase, setFilenameBase] = useState('TL All Teams All Branches All Shifts');

  const canExport = hasPermission(permissions, 'employees:export', role);
  const filters = useMemo(() => ({ branch, team, shift }), [branch, team, shift]);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/employees/export-options');
      setOptions({
        branches: Array.isArray(data?.branches) ? data.branches : [],
        teams: Array.isArray(data?.teams) ? data.teams : [],
        shifts: Array.isArray(data?.shifts) ? data.shifts : [],
        scope: data?.scope || { type: 'all' },
        ceo: Boolean(data?.ceo),
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load export options.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async (nextFilters) => {
    setPreviewLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/employees/export-preview', {
        params: {
          branch: nextFilters.branch || undefined,
          team: nextFilters.team || undefined,
          shift: nextFilters.shift || undefined,
        },
      });
      setColumns(Array.isArray(data?.columns) ? data.columns : []);
      setEmployees(Array.isArray(data?.employees) ? data.employees : []);
      setFilenameBase(data?.filenameBase || 'TL All Teams All Branches All Shifts');
    } catch (err) {
      setEmployees([]);
      setError(err.response?.data?.message || 'Failed to load employee preview.');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!canAccessAdmin(data.role) || !hasPermission(data.permissions, 'employees:export', data.role)) {
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
    if (!checking && canExport) loadOptions();
  }, [checking, canExport, loadOptions]);

  useEffect(() => {
    if (checking || !canExport) return undefined;
    const timer = setTimeout(() => {
      loadPreview(filters);
    }, 150);
    return () => clearTimeout(timer);
  }, [checking, canExport, filters, loadPreview]);

  async function handleExport(format) {
    if (!canExport) return;
    setExporting(format);
    setError('');
    setSuccess('');
    try {
      const filename = await downloadBlob(format, filters);
      setSuccess(`${filename} downloaded.`);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Export failed.');
    } finally {
      setExporting('');
    }
  }

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <p className="muted">Checking access…</p>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel employee-export-page">
      <h1>Export employees</h1>
      <p className="muted">
        Download current employee records as an editable Excel workbook or a PDF. Documents (photos,
        CNIC images, CVs, employment forms) are never included.
      </p>
      <p className="muted">{describeAssignment(options.scope, options.ceo)}</p>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      <div className="export-filters">
        <label>
          Branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={loading}>
            <option value="">All assigned branches</option>
            {options.branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select value={team} onChange={(e) => setTeam(e.target.value)} disabled={loading}>
            <option value="">All assigned teams</option>
            {options.teams.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Shift
          <select value={shift} onChange={(e) => setShift(e.target.value)} disabled={loading}>
            <option value="">All shifts</option>
            {options.shifts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="export-filter-summary">{describeActiveFilters(filters)}</p>
      <p className="export-filename-hint">
        File name: <strong>{filenameBase}.xls</strong> / <strong>{filenameBase}.pdf</strong>
      </p>

      <div className="export-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(exporting) || loading || previewLoading || employees.length === 0}
          onClick={() => handleExport('xlsx')}
        >
          {exporting === 'xlsx' ? 'Preparing Excel…' : 'Download Excel'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={Boolean(exporting) || loading || previewLoading || employees.length === 0}
          onClick={() => handleExport('pdf')}
        >
          {exporting === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </div>

      <div className="export-preview-head">
        <h2>Employees in this download</h2>
        <p className="muted">
          {previewLoading
            ? 'Updating list…'
            : `${employees.length} ${employees.length === 1 ? 'employee' : 'employees'} match the filters above.`}
        </p>
      </div>

      <div className="table-shell export-preview-table">
        {previewLoading && employees.length === 0 && (
          <div className="admin-loading">
            <div className="spinner" />
            Loading employees…
          </div>
        )}

        {!previewLoading && employees.length === 0 && (
          <div className="admin-empty">No employees match these filters.</div>
        )}

        {employees.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((row, index) => (
                <tr key={`${row.employee_id || 'row'}-${index}`}>
                  {columns.map((col) => (
                    <td key={col.key}>{row[col.key] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
