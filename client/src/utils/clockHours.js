export const CLOCK_HOUR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function hour24ToClock(hour, isEnd = false) {
  const h = Number(hour);
  if (!Number.isFinite(h)) {
    return isEnd ? { clock: 6, period: 'PM' } : { clock: 9, period: 'AM' };
  }
  if (isEnd && (h === 24 || h === 0)) return { clock: 12, period: 'AM' };
  if (!isEnd && h === 0) return { clock: 12, period: 'AM' };
  if (h === 12) return { clock: 12, period: 'PM' };
  if (h > 12) return { clock: h - 12, period: 'PM' };
  return { clock: h, period: 'AM' };
}

export function clockToHour24(clock, period, isEnd = false) {
  const c = Number(clock);
  const p = String(period || 'AM').toUpperCase();
  if (c === 12 && p === 'AM') return isEnd ? 24 : 0;
  if (c === 12 && p === 'PM') return 12;
  if (p === 'PM') return c + 12;
  return c;
}

export function hour24ToLabel(hour) {
  const { clock, period } = hour24ToClock(hour, hour === 24);
  return `${clock}:00 ${period}`;
}

export function hoursRangeLabel(startHour, endHour) {
  if (startHour == null || endHour == null) return '';
  return `${hour24ToLabel(startHour)}–${hour24ToLabel(endHour)}`;
}

export function pickHourFromPayload(obj, kind) {
  for (const [key, value] of Object.entries(obj || {})) {
    const compact = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact.includes('work') || !compact.includes('hour')) continue;
    if (kind === 'start' && !compact.includes('start')) continue;
    if (kind === 'end' && !compact.includes('end')) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
