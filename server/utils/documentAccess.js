/**
 * Central download gate for GET /api/documents/:userId/:docType.
 *
 * Rules:
 * - cnic_front / cnic_back: CEO, admin with documents:view, or HR viewing subordinate staff
 *   (streamed in-portal only; query-token links are rejected in the controller)
 * - cv / employment_form: CEO, or admin with documents:view
 * - profile (and anything else): existing defaults (self or admin/ceo)
 */

const { loadAdminPermissions } = require('../middleware/permissions');

function isCnicDocType(docType) {
  const t = String(docType || '').toLowerCase();
  return t === 'cnic' || t === 'cnic_front' || t === 'cnic_back';
}

async function hasHrAddEmployeePermission(requester) {
  const role = String(requester?.role || '').toLowerCase();
  if (role === 'ceo') return true;
  if (role !== 'admin') return false;
  let perms = Array.isArray(requester.permissions) ? requester.permissions : [];
  if (!perms.length && requester?.id) {
    perms = await loadAdminPermissions(requester.id);
  }
  return perms.includes('hr:add_employee') || perms.includes('*');
}

function isStaffExtraDocType(docType) {
  const t = String(docType || '').toLowerCase();
  return t === 'staff_extra_1' || t === 'staff_extra_2';
}

async function hasDocumentsViewPermission(requester) {
  const role = String(requester?.role || '').toLowerCase();
  if (role === 'ceo') return true;
  if (role !== 'admin') return false;
  let perms = Array.isArray(requester.permissions) ? requester.permissions : [];
  if (!perms.length && requester?.id) {
    perms = await loadAdminPermissions(requester.id);
  }
  return perms.includes('documents:view') || perms.includes('*');
}

/**
 * @param {string} documentType
 * @param {{ id?: number|string, role?: string, permissions?: string[] }} user
 * @param {{ targetUserId?: number|string }} [context]
 * @returns {Promise<boolean>}
 */
async function canDownloadDocument(documentType, user, context = {}) {
  const docType = String(documentType || '').trim().toLowerCase();
  const role = String(user?.role || '').toLowerCase();
  const targetUserId = context.targetUserId;
  const isSelf =
    targetUserId != null && String(user?.id) === String(targetUserId);

  if (isCnicDocType(docType)) {
    if (context.staffKind === 'lower' && (await hasHrAddEmployeePermission(user))) {
      return true;
    }
    return hasDocumentsViewPermission(user);
  }

  if (isStaffExtraDocType(docType)) {
    if (context.staffKind === 'lower' && (await hasHrAddEmployeePermission(user))) {
      return true;
    }
    return false;
  }

  if (docType === 'cv' || docType === 'employment_form') {
    return hasDocumentsViewPermission(user);
  }

  if (docType === 'profile') {
    if (isSelf) return true;
    if (role === 'ceo' || role === 'admin') return true;
    return false;
  }

  // Unknown / future types: keep prior sensitive-doc default (self or docs permission)
  if (isSelf) return true;
  return hasDocumentsViewPermission(user);
}

module.exports = {
  canDownloadDocument,
  hasDocumentsViewPermission,
  isCnicDocType,
};
