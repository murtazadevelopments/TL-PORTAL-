import { useState } from 'react';
import './PasswordInput.css';

function EyeIcon({ off }) {
  return off ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 6c5.2 0 9.2 3.4 10.5 6-1.3 2.6-5.3 6-10.5 6S2.8 14.6 1.5 12C2.8 9.4 6.8 6 12 6Zm0 2.2A3.8 3.8 0 1 0 15.8 12 3.8 3.8 0 0 0 12 8.2Zm0 1.8A2 2 0 1 1 10 12a2 2 0 0 1 2-2Z"
      />
      <path
        fill="currentColor"
        d="M4.2 3.8a1 1 0 0 1 1.4 0L20.2 18.4a1 1 0 1 1-1.4 1.4L4.2 5.2a1 1 0 0 1 0-1.4Z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 6c5.2 0 9.2 3.4 10.5 6-1.3 2.6-5.3 6-10.5 6S2.8 14.6 1.5 12C2.8 9.4 6.8 6 12 6Zm0 2.2A3.8 3.8 0 1 0 15.8 12 3.8 3.8 0 0 0 12 8.2Zm0 1.8A2 2 0 1 1 10 12a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

function PasswordInput({
  name = 'password',
  value,
  onChange,
  required = false,
  requiredMark = false,
  minLength,
  autoComplete = 'current-password',
  label = 'Password',
  disabled = false,
  inputMode,
  autoFocus = false,
  maxLength,
  id,
}) {
  const [visible, setVisible] = useState(false);
  const field = (
    <div className="password-input-wrap">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        <EyeIcon off={visible} />
      </button>
    </div>
  );

  if (label === false) return field;

  return (
    <label className="password-field">
      <span>
        {label}
        {requiredMark ? (
          <span className="req-mark" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {field}
    </label>
  );
}

export default PasswordInput;
