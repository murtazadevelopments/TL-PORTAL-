import { useEffect } from 'react';

const EVENT = 'tl-success-popup';

export function showSuccess(message) {
  const text = String(message || '').trim();
  if (!text || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message: text } }));
}

export function useFlashSuccess(message) {
  useEffect(() => {
    if (message) showSuccess(message);
  }, [message]);
}

export function subscribeSuccessPopup(handler) {
  const onEvent = (event) => handler(event.detail?.message || '');
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
