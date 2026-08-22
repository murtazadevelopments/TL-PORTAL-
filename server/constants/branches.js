const BRANCH_OPTIONS = ['Head Office', 'Unit', 'Branch', 'Amir Chamber'];

function normalizeBranch(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return BRANCH_OPTIONS.includes(trimmed) ? trimmed : undefined;
}

module.exports = { BRANCH_OPTIONS, normalizeBranch };
