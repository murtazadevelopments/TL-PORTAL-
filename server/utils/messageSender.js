const ANONYMOUS_ADMIN_LABEL = 'HR';

function isCeoRole(role) {
  return String(role || '').toLowerCase() === 'ceo';
}

/**
 * Public identity on employee-facing messages and emails.
 * CEO stays visible; admins (and anyone else) are shown as HR.
 */
function publicSenderLabel(sender) {
  if (isCeoRole(sender?.role)) {
    const label = String(sender?.name || sender?.username || 'CEO').trim();
    return label || 'CEO';
  }
  return ANONYMOUS_ADMIN_LABEL;
}

function redactMessageSender(row) {
  if (!row) return row;
  const role = String(row.sender_role || '').toLowerCase();
  if (role === 'ceo') {
    return {
      ...row,
      sender_name: row.sender_name || row.sender_username || 'CEO',
      sender_username: null,
    };
  }
  return {
    ...row,
    sender_id: null,
    sender_name: ANONYMOUS_ADMIN_LABEL,
    sender_username: null,
    sender_role: 'admin',
  };
}

module.exports = {
  ANONYMOUS_ADMIN_LABEL,
  isCeoRole,
  publicSenderLabel,
  redactMessageSender,
};
