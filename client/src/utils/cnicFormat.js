/** Pakistani CNIC display/storage format: XXXXX-XXXXXXX-X (13 digits). */
export const CNIC_FORMAT_PATTERN = /^\d{5}-\d{7}-\d$/;
export const CNIC_FORMAT_HINT = 'XXXXX-XXXXXXX-X';
export const CNIC_INVALID_MESSAGE = 'CNIC must be in format XXXXX-XXXXXXX-X.';

export function cnicDigits(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 13);
}

/** Formats while typing or converts stored digits to XXXXX-XXXXXXX-X without changing digits. */
export function formatCnic(value) {
  const digits = cnicDigits(value);
  if (!digits) return '';
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12, 13)}`;
}

export function isCompleteCnic(value) {
  return CNIC_FORMAT_PATTERN.test(String(value || '').trim()) || cnicDigits(value).length === 13;
}

export function normalizeCnicForSubmit(value) {
  const digits = cnicDigits(value);
  if (digits.length !== 13) return null;
  return formatCnic(digits);
}
