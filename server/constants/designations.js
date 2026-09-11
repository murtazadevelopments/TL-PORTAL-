const DESIGNATION_OPTIONS = [
  'Sales Agent',
  'Team Lead',
  'Supervisor',
  'Sub Supervisor',
  'Branch Manager',
  'Assistant Team Lead',
  'Unit Head',
  '2D Artist',
  '3D Artist',
  '2D Animator',
  '3D Animator',
  '2D Rigger',
  'Web Developer',
  'Production Head',
];

const TEAM_LEAD_LIKE_DESIGNATIONS = [
  'Team Lead',
  'Assistant Team Lead',
  'Supervisor',
  'Sub Supervisor',
  'Branch Manager',
  'Unit Head',
  'Production Head',
];

function normalizeDesignation(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
}

const TEAM_LEAD_LIKE_NORMALIZED = new Set(
  TEAM_LEAD_LIKE_DESIGNATIONS.map((label) => normalizeDesignation(label))
);

function isCatalogDesignation(value) {
  const n = normalizeDesignation(value);
  if (!n) return false;
  return DESIGNATION_OPTIONS.some((opt) => normalizeDesignation(opt) === n);
}

function catalogDesignationLabel(value) {
  const n = normalizeDesignation(value);
  return DESIGNATION_OPTIONS.find((opt) => normalizeDesignation(opt) === n) || null;
}

/**
 * New values must be in the catalog. Existing free-text titles may be kept until changed.
 */
function isAllowedDesignation(value, { current } = {}) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (isCatalogDesignation(trimmed)) return true;
  const cur = String(current || '').trim();
  return Boolean(cur) && normalizeDesignation(trimmed) === normalizeDesignation(cur);
}

module.exports = {
  DESIGNATION_OPTIONS,
  TEAM_LEAD_LIKE_DESIGNATIONS,
  TEAM_LEAD_LIKE_NORMALIZED,
  normalizeDesignation,
  isCatalogDesignation,
  catalogDesignationLabel,
  isAllowedDesignation,
};
