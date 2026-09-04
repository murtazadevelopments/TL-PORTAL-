import { joinTimeAmPm, splitTimeAmPm } from '../utils/timeAmPm';

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export default function TimeAmPmInput({ value, onChange, disabled, id }) {
  const { hour12, minutes, period } = splitTimeAmPm(value);

  function emit(nextHour, nextMin, nextPeriod) {
    onChange?.(joinTimeAmPm(nextHour, nextMin, nextPeriod));
  }

  return (
    <div className="time-ampm" id={id}>
      <select
        aria-label="Hour"
        value={hour12}
        disabled={disabled}
        onChange={(e) => emit(Number(e.target.value), minutes, period)}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="time-ampm-sep" aria-hidden="true">
        :
      </span>
      <select
        aria-label="Minutes"
        value={minutes}
        disabled={disabled}
        onChange={(e) => emit(hour12, Number(e.target.value), period)}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        className="time-ampm-period"
        value={period}
        disabled={disabled}
        onChange={(e) => emit(hour12, minutes, e.target.value)}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
