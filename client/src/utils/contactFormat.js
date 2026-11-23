/** Pakistani mobile format: 03XZ-YYYYYYY (11 digits). */
export const CONTACT_FORMAT_PATTERN = /^03\d{2}-\d{7}$/;
export const CONTACT_FORMAT_HINT = '03XZ-YYYYYYY';
export const CONTACT_INVALID_MESSAGE = 'Contact number must be in format 03XZ-YYYYYYY.';

export function contactDigits(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 11);
}

/** Formats while typing or converts stored digits to 03XZ-YYYYYYY without changing digits. */
export function formatContactNumber(value) {
  const digits = contactDigits(value);
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export function isCompleteContactNumber(value) {
  return CONTACT_FORMAT_PATTERN.test(String(value || '').trim()) || /^03\d{9}$/.test(contactDigits(value));
}

export function normalizeContactForSubmit(value) {
  const digits = contactDigits(value);
  if (!/^03\d{9}$/.test(digits)) return null;
  return formatContactNumber(digits);
}

/** Display/convert any 11-digit number to XXXX-XXXXXXX without changing digits. */
export function formatContactDisplay(value) {
  const digits = contactDigits(value);
  if (!digits) return '';
  if (digits.length !== 11) return formatContactNumber(digits) || String(value || '').trim();
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}
