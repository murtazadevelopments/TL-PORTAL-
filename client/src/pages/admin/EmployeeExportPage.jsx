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
    const disposition = String(res.headers['content-disposition'] || '');
    const matched = disposition.match(/filename="([^"]+)"/);
    const fallback = format === 'pdf' ? 'TL-employees.pdf' : 'TL-employees.xls';
    const filename = matched?.[1] || fallback;
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const canExport = hasPermission(permissions, 'employees:export', role);

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

  const filters = useMemo(() => ({ branch, team, shift }), [branch, team, shift]);

  async function handleExport(format) {
    if (!canExport) return;
    setExporting(format);
    setError('');
    setSuccess('');
    try {
      await downloadBlob(format, filters);
      setSuccess(format === 'pdf' ? 'PDF downloaded.' : 'Excel file downloaded.');
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

      <div className="export-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(exporting) || loading}
          onClick={() => handleExport('xlsx')}
        >
          {exporting === 'xlsx' ? 'Preparing Excel…' : 'Download Excel'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={Boolean(exporting) || loading}
          onClick={() => handleExport('pdf')}
        >
          {exporting === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </div>
    </div>
  );
}
