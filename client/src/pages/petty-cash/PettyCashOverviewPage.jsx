import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import api from '../../api/client';
import { useAuthUser } from '../../context/AuthUserContext';
import { canOverseePettyCash } from '../../utils/permissions';
import PettyCashLedger from './PettyCashLedger';
import './PettyCashDashboard.css';

function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function HoldersList() {
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/petty-cash/holders');
      setHolders(Array.isArray(data.holders) ? data.holders : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load assignees.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="petty-page">
      <h1>Petty cash</h1>
      <p className="petty-sub">
        Open each assigned person’s personal dashboard. Admins only see their own ledger.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {loading ? (
        <p className="petty-empty">Loading…</p>
      ) : holders.length === 0 ? (
        <p className="petty-empty">
          No one has the Petty cash permission yet. Assign it from Assign Roles.
        </p>
      ) : (
        <div className="petty-holders">
          {holders.map((row) => (
            <Link
              key={row.id}
              className="petty-holder-card"
              to={`/admin/petty-cash/${row.id}`}
            >
              <div>
                <div className="petty-holder-name">{row.name}</div>
                <div className="petty-holder-meta">
                  {row.employee_id ? `ID ${row.employee_id} · ` : ''}
                  {row.entry_count} item{row.entry_count === 1 ? '' : 's'}
                  {` · Used ${formatMoney(row.used_amount)} · Pending ${formatMoney(row.pending_amount)}`}
                </div>
              </div>
              <div className="petty-holder-balance">{formatMoney(row.pending_amount)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PettyCashOverviewPage() {
  const navigate = useNavigate();
  const { userId } = useParams();
  const { user, role, loading } = useAuthUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    if (!canOverseePettyCash(role)) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setReady(true);
  }, [loading, user, role, navigate]);

  if (!ready) return null;

  if (userId) {
    return (
      <PettyCashLedger
        mode="holder"
        holderUserId={userId}
        backTo="/admin/petty-cash"
      />
    );
  }

  return <HoldersList />;
}
