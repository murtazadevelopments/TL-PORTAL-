function calendarYmd(now = new Date(), tz = process.env.APP_TIMEZONE || 'Asia/Karachi') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
  };
}

function addCalendarDays(ymd, days) {
  const dt = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + Number(days || 0)));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function dobMonthDay(dob) {
  if (!dob) return null;
  const dt = new Date(dob);
  if (Number.isFinite(dt.getTime())) {
    const ymd = calendarYmd(dt);
    return { month: ymd.month, day: ymd.day };
  }
  const text = String(dob).slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { month: Number(match[2]), day: Number(match[3]) };
}

function dobMatchesYmd(dob, ymd) {
  const md = dobMonthDay(dob);
  if (!md || !ymd) return false;
  return md.month === Number(ymd.month) && md.day === Number(ymd.day);
}

function isBirthdayToday(dob, now = new Date()) {
  return dobMatchesYmd(dob, calendarYmd(now));
}

function birthdayKey(now = new Date()) {
  const ymd = calendarYmd(now);
  const mm = String(ymd.month).padStart(2, '0');
  const dd = String(ymd.day).padStart(2, '0');
  return `${ymd.year}-${mm}-${dd}`;
}

module.exports = {
  calendarYmd,
  addCalendarDays,
  dobMonthDay,
  dobMatchesYmd,
  isBirthdayToday,
  birthdayKey,
};
