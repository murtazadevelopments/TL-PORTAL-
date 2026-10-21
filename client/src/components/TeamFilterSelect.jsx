import useTeamOptions from '../hooks/useTeamOptions';
import { mergeTeamNames } from '../utils/teamNames';

export default function TeamFilterSelect({
  value = 'all',
  onChange,
  extraNames = [],
  className = 'filter-select',
  allLabel = 'All',
  disabled = false,
}) {
  const { names, loading } = useTeamOptions();
  const options = mergeTeamNames(names, extraNames);
  const current = value || 'all';

  return (
    <select
      className={className || undefined}
      value={current}
      disabled={disabled}
      aria-label="Filter by team"
      onChange={(e) => onChange?.(e.target.value)}
    >
      <option value="all">{allLabel}</option>
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      {current !== 'all' && !options.includes(current) && (
        <option value={current}>{current}</option>
      )}
      {loading && options.length === 0 ? <option disabled>Loading teams…</option> : null}
    </select>
  );
}
