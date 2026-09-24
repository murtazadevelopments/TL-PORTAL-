export function formatPeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return period || '—';
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    d
  );
}

export function formatAmount(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function shiftPeriod(period, delta) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return period;
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isRecentlyAdded(iso, days = 14) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
}

export function statusLabel(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress') return 'In progress';
  return 'No target';
}

export function summarizeAgents(agents) {
  const list = Array.isArray(agents) ? agents : [];
  const withTarget = list.filter((a) => a.target_amount != null && a.target_amount > 0);
  const targetTotal = withTarget.reduce((s, a) => s + Number(a.target_amount || 0), 0);
  const achievedTotal = withTarget.reduce((s, a) => s + Number(a.achieved_amount || 0), 0);
  return {
    agent_count: list.length,
    assigned_count: withTarget.length,
    completed_count: withTarget.filter((a) => a.status === 'completed').length,
    target_total: targetTotal,
    achieved_total: achievedTotal,
    remaining_total: Math.max(0, Math.round((targetTotal - achievedTotal) * 100) / 100),
    percent: targetTotal > 0 ? Math.min(999, Math.round((achievedTotal / targetTotal) * 1000) / 10) : 0,
  };
}

export function ProgressRing({ percent = 0, size = 132, label }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);
  return (
    <div className="sales-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="sales-ring-track" cx="60" cy="60" r={r} />
        <circle
          className="sales-ring-value"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="sales-ring-label">
        <strong>{Math.round(p)}%</strong>
        {label ? <span>{label}</span> : null}
      </div>
    </div>
  );
}
