const PORTAL_SENDER_LABEL = 'Textured Lab Portal';

function publicSenderLabel() {
  return PORTAL_SENDER_LABEL;
}

function normalizeFromStyle(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase() === 'name'
    ? 'name'
    : 'portal';
}

function canChooseMessageFrom(role) {
  const r = String(role || '')
    .trim()
    .toLowerCase();
  return r === 'ceo' || r === 'manager';
}

function resolveFromStyle(role, raw) {
  if (canChooseMessageFrom(role) && normalizeFromStyle(raw) === 'name') return 'name';
  return 'portal';
}

function senderDisplayName(fromStyle, sender) {
  if (normalizeFromStyle(fromStyle) === 'name') {
    const name = String(sender?.name || sender?.username || '').trim();
    if (name) return name;
  }
  return PORTAL_SENDER_LABEL;
}

function redactMessageSender(row) {
  if (!row) return row;
  const fromName = normalizeFromStyle(row.from_style) === 'name';
  const hasImage = Boolean(row.image_path);
  return {
    ...row,
    sender_id: fromName ? row.sender_id : null,
    sender_name: fromName
      ? String(row.sender_name || row.sender_username || PORTAL_SENDER_LABEL).trim() ||
        PORTAL_SENDER_LABEL
      : PORTAL_SENDER_LABEL,
    sender_username: fromName ? row.sender_username : null,
    sender_role: fromName ? row.sender_role : null,
    image_path: undefined,
    image_mime: undefined,
    has_image: hasImage,
    image_url: hasImage ? `/api/messages/${row.id}/image` : null,
  };
}

module.exports = {
  PORTAL_SENDER_LABEL,
  publicSenderLabel,
  canChooseMessageFrom,
  resolveFromStyle,
  senderDisplayName,
  redactMessageSender,
};
