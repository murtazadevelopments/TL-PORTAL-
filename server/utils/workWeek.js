/**
 * Calendar helpers in Asia/Karachi. dateKey is YYYY-MM-DD.
 * Sunday is a company-wide holiday.
 */
function weekdayKarachi(dateKey) {
  const key = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const noon = new Date(`${key}T12:00:00+05:00`);
  if (!Number.isFinite(noon.getTime())) return null;
  return noon.getUTCDay();
}

function isSundayDateKey(dateKey) {
  return weekdayKarachi(dateKey) === 0;
}

function sundayKeysInMonth(monthKey, untilDateKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const keys = [];
  for (let day = 1; day <= last; day += 1) {
    const key = `${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`;
    if (untilDateKey && key > untilDateKey) break;
    if (isSundayDateKey(key)) keys.push(key);
  }
  return keys;
}

module.exports = { weekdayKarachi, isSundayDateKey, sundayKeysInMonth };
