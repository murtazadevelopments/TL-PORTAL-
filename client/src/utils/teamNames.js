export function teamNameFrom(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.name || value.department || value.team || '').trim();
}

export function uniqueTeamNames(list) {
  const seen = new Map();
  for (const item of list || []) {
    const name = teamNameFrom(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function mergeTeamNames(...lists) {
  return uniqueTeamNames(lists.flatMap((list) => list || []));
}

export function matchesTeamFilter(row, team) {
  const wanted = String(team || '').trim().toLowerCase();
  if (!wanted || wanted === 'all') return true;
  return teamNameFrom(row.department || row.team).toLowerCase() === wanted;
}
