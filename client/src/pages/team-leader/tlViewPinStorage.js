const KEY = 'tl-view-pin';

export function readStoredTlViewPin() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function storeTlViewPin(pin) {
  try {
    if (pin) sessionStorage.setItem(KEY, pin);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
