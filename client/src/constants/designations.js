/** Job titles shown on Add / Edit employee. */
export const DESIGNATION_OPTIONS = [
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

/** Same Team Leader Dashboard access as Team Lead (sidebar + full category view). */
export const TEAM_LEAD_LIKE_DESIGNATIONS = [
  'Team Lead',
  'Assistant Team Lead',
  'Supervisor',
  'Sub Supervisor',
  'Branch Manager',
  'Unit Head',
  'Production Head',
];

export function isCatalogDesignation(value) {
  return DESIGNATION_OPTIONS.includes(String(value || '').trim());
}
