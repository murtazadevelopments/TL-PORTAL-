function clock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export default function ShiftHoursDetail({
  workLabel,
  breakLabel,
  firstCheckIn,
  checkedOutAt,
  breaks = [],
  onBreak = false,
  showBreak = false,
}) {
  const sessions = showBreak && Array.isArray(breaks) ? breaks : [];
  return (
    <div className="shift-hours-detail">
      <div className={`shift-hours-totals${showBreak ? '' : ' is-work-only'}`}>
        <p>
          <span>Working</span>
          <strong>{workLabel || '—'}</strong>
        </p>
        {showBreak ? (
          <p>
            <span>Break</span>
            <strong>{breakLabel || '0m'}</strong>
          </p>
        ) : null}
      </div>
      <ul className="shift-hours-log">
        {firstCheckIn ? (
          <li>
            <span>Started work</span>
            <strong>{clock(firstCheckIn)}</strong>
          </li>
        ) : (
          <li className="muted">No work start yet this shift.</li>
        )}
        {sessions.map((row, i) => (
          <li key={row.id || `${row.started_at}-${i}`}>
            <span>
              Break {i + 1}
              {row.open || onBreak ? ' · now' : ''}
            </span>
            <strong>
              {clock(row.started_at)}
              {row.ended_at || row.open ? ` – ${row.open ? 'now' : clock(row.ended_at)}` : ''}
              {row.minutes_label ? ` · ${row.minutes_label}` : ''}
            </strong>
          </li>
        ))}
        {checkedOutAt ? (
          <li>
            <span>Checked out</span>
            <strong>{clock(checkedOutAt)}</strong>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
