const PORTAL_SENDER_LABEL = 'Textured Lab Portal';

/**
 * Public identity on employee-facing messages and emails.
 * Never expose the admin or CEO name on alerts or inbox copies.
 */
function publicSenderLabel() {
  return PORTAL_SENDER_LABEL;
}

function redactMessageSender(row) {
  if (!row) return row;
  return {
    ...row,
    sender_id: null,
    sender_name: PORTAL_SENDER_LABEL,
    sender_username: null,
    sender_role: null,
  };
}

module.exports = {
  PORTAL_SENDER_LABEL,
  publicSenderLabel,
  redactMessageSender,
};
