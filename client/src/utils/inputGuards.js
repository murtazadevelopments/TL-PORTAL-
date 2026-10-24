const INTEGER_NAME_RE =
  /(cnic|contact_number|emergency_contact_number|phone|mobile|pin|otp|salary|account_number|remote_check_count|work_start_hour|work_end_hour|qty|quantity|amount)/i;
const TEXT_NAME_RE =
  /^(name|full_name|bank_name|account_title|team|designation|department|branch|reference_person_name|emergency_contact_name|subject)$/i;
const USERNAME_NAME_RE = /^(username)$/i;

function fieldKind(el) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return null;
  if (el.disabled || el.readOnly) return null;
  const type = String(el.type || 'text').toLowerCase();
  const name = String(el.name || el.id || '');
  if (
    ['file', 'hidden', 'checkbox', 'radio', 'range', 'color', 'date', 'time', 'datetime-local', 'month', 'week', 'button', 'submit', 'reset'].includes(
      type
    )
  ) {
    return null;
  }
  if (type === 'password' || /password/i.test(name)) return null;
  const explicit = String(el.dataset.inputKind || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (el instanceof HTMLTextAreaElement) return 'mixed';
  if (USERNAME_NAME_RE.test(name)) return 'username';
  if (type === 'email' || name === 'email') return 'email';
  if (type === 'search') return 'mixed';
  if (INTEGER_NAME_RE.test(name) || type === 'tel') return 'integer';
  if (el.inputMode === 'decimal' || el.step === 'any' || el.step === '0.01') return 'decimal';
  if (type === 'number' || el.inputMode === 'numeric') return 'integer';
  if (TEXT_NAME_RE.test(name)) return 'text';
  return 'mixed';
}

export function filterInputValue(kind, value) {
  const raw = String(value ?? '');
  switch (kind) {
    case 'integer':
      return raw.replace(/\D/g, '');
    case 'decimal':
      return raw
        .replace(/[^\d.]/g, '')
        .replace(/(\..*)\./g, '$1');
    case 'text':
      return raw.replace(/[0-9]/g, '');
    case 'username':
      return raw.toLowerCase().replace(/[^a-z0-9._]/g, '');
    case 'email':
      return raw.toLowerCase().replace(/[^\w.@+-]/g, '');
    default:
      return raw;
  }
}

function applyFilteredValue(el, next) {
  if (el.value === next) return;
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function installInputGuards() {
  if (typeof document === 'undefined' || document.documentElement.dataset.inputGuards === '1') {
    return;
  }
  document.documentElement.dataset.inputGuards = '1';

  document.addEventListener(
    'beforeinput',
    (event) => {
      const el = event.target;
      const kind = fieldKind(el);
      if (!kind || kind === 'mixed' || event.data == null) return;
      if (filterInputValue(kind, event.data) !== event.data) event.preventDefault();
    },
    true
  );

  document.addEventListener(
    'paste',
    (event) => {
      const el = event.target;
      const kind = fieldKind(el);
      if (!kind || kind === 'mixed') return;
      const pasted = event.clipboardData?.getData('text') ?? '';
      const filtered = filterInputValue(kind, pasted);
      if (filtered === pasted) return;
      event.preventDefault();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      applyFilteredValue(el, filterInputValue(kind, el.value.slice(0, start) + filtered + el.value.slice(end)));
    },
    true
  );

  document.addEventListener(
    'input',
    (event) => {
      const el = event.target;
      const kind = fieldKind(el);
      if (!kind || kind === 'mixed') return;
      const filtered = filterInputValue(kind, el.value);
      if (filtered !== el.value) applyFilteredValue(el, filtered);
    },
    true
  );
}

export { fieldKind, installInputGuards };
