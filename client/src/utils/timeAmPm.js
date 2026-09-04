function parseHhMm(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return { hours24: 9, minutes: 0 };
  const hours24 = Math.min(23, Math.max(0, Number(m[1])));
  const minutes = Math.min(59, Math.max(0, Number(m[2])));
  return { hours24, minutes };
}

export function splitTimeAmPm(value) {
  const { hours24, minutes } = parseHhMm(value);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return { hour12, minutes, period };
}

export function joinTimeAmPm(hour12, minutes, period) {
  let h = Number(hour12);
  const min = Math.min(59, Math.max(0, Number(minutes) || 0));
  if (!Number.isFinite(h) || h < 1 || h > 12) h = 12;
  const isPm = String(period).toUpperCase() === 'PM';
  let hours24 = h % 12;
  if (isPm) hours24 += 12;
  return `${String(hours24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function formatTimeAmPm(value) {
  if (value == null || value === '') return '—';
  const { hour12, minutes, period } = splitTimeAmPm(value);
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}
