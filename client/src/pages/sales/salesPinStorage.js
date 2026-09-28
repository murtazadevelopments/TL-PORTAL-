const KEY = 'tl-sales-pin';

export function readStoredSalesPin() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function storeSalesPin(pin) {
  try {
    if (pin) sessionStorage.setItem(KEY, pin);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
