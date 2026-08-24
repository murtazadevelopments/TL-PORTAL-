import { CLOCK_HOUR_OPTIONS, clockToHour24, hour24ToClock } from '../utils/clockHours';
import './ClockHourSelect.css';

export default function ClockHourSelect({ label, value, onChange, isEnd = false }) {
  const { clock, period } = hour24ToClock(value, isEnd);

  function setClock(nextClock) {
    onChange(clockToHour24(nextClock, period, isEnd));
  }

  function setPeriod(nextPeriod) {
    onChange(clockToHour24(clock, nextPeriod, isEnd));
  }

  return (
    <div className="clock-hour-select">
      <span className="clock-hour-select-label">{label}</span>
      <div className="clock-hour-select-row">
        <select
          className="clock-hour-select-hour"
          value={clock}
          onChange={(e) => setClock(Number(e.target.value))}
          aria-label={`${label} hour`}
        >
          {CLOCK_HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <div className="clock-hour-period" role="group" aria-label={`${label} AM or PM`}>
          <button
            type="button"
            className={period === 'AM' ? 'active' : ''}
            onClick={() => setPeriod('AM')}
          >
            AM
          </button>
          <button
            type="button"
            className={period === 'PM' ? 'active' : ''}
            onClick={() => setPeriod('PM')}
          >
            PM
          </button>
        </div>
      </div>
    </div>
  );
}
