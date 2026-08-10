import { useState } from 'react';
import './PasswordInput.css';

function PasswordInput({
  name = 'password',
  value,
  onChange,
  required = false,
  minLength,
  autoComplete = 'current-password',
  label = 'Password',
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="password-field">
      {label}
      <div className="password-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 6a9.8 9.8 0 0 1 9.5 6 9.8 9.8 0 0 1-19 0A9.8 9.8 0 0 1 12 6Zm0 2a7.8 7.8 0 0 0-7.3 4 7.8 7.8 0 0 0 14.6 0A7.8 7.8 0 0 0 12 8Zm0 1.5A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5Z"
              />
              <path
                fill="currentColor"
                d="M3.3 3.3a1 1 0 0 1 1.4 0l16 16a1 1 0 0 1-1.4 1.4l-16-16a1 1 0 0 1 0-1.4Z"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 6a9.8 9.8 0 0 1 9.5 6 9.8 9.8 0 0 1-19 0A9.8 9.8 0 0 1 12 6Zm0 2a7.8 7.8 0 0 0-7.3 4 7.8 7.8 0 0 0 14.6 0A7.8 7.8 0 0 0 12 8Zm0 1.5A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5Z"
              />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}

export default PasswordInput;
