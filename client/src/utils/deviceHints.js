/**
 * Collect browser Client Hints for login logs.
 * MacBook Pro vs Air is never exposed; Android model often is.
 */
export async function collectDeviceHints() {
  const hints = {
    mobile: Boolean(navigator.userAgentData?.mobile),
    platform: navigator.userAgentData?.platform || navigator.platform || '',
  };

  try {
    const uaData = navigator.userAgentData;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      const high = await uaData.getHighEntropyValues([
        'model',
        'platform',
        'platformVersion',
        'architecture',
        'bitness',
        'formFactor',
      ]);
      hints.model = high.model || '';
      hints.platform = high.platform || hints.platform;
      hints.platformVersion = high.platformVersion || '';
      hints.architecture = high.architecture || '';
      hints.formFactor = Array.isArray(high.formFactor)
        ? high.formFactor[0]
        : high.formFactor || '';
      hints.mobile = Boolean(high.mobile ?? uaData.mobile);
    }
  } catch {
    /* private mode / unsupported */
  }

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2500);
    const res = await fetch('https://ipwho.is/', { signal: ac.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false && data.ip) {
        hints.publicIp = String(data.ip).slice(0, 64);
      }
    }
  } catch {
    /* offline / blocked */
  }

  return hints;
}
