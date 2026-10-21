export function teamNameFrom(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.name || value.department || value.team || '').trim();
}

export function mergeTeamNames(...lists) {
  const names = [];
  for (const list of lists) {
    for (const item of list || []) {
      const name = teamNameFrom(item);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function matchesTeamFilter(row, team) {
  const wanted = String(team || '').trim();
  if (!wanted || wanted === 'all') return true;
  return teamNameFrom(row.department || row.team) === wanted;
}
