/**
 * Best-effort human device names from User-Agent + Client Hints.
 *
 * Honest limits:
 * - MacBook Pro vs Air is NOT available in any standard browser API.
 *   We can only say Mac / Apple Silicon Mac / Intel Mac.
 * - iPhone 14 vs 15 vs 16 is usually hidden by Apple.
 * - Android often exposes a model code (SM-S901B) which we map to
 *   a marketing name (Samsung Galaxy S22). Chrome UA-reduction may
 *   hide it unless Client Hints / userAgentData.model is present.
 */

const SAMSUNG_MODELS = {
  'SM-G973': 'Samsung Galaxy S10',
  'SM-G975': 'Samsung Galaxy S10+',
  'SM-G970': 'Samsung Galaxy S10e',
  'SM-G980': 'Samsung Galaxy S20',
  'SM-G981': 'Samsung Galaxy S20 5G',
  'SM-G985': 'Samsung Galaxy S20+',
  'SM-G986': 'Samsung Galaxy S20+ 5G',
  'SM-G988': 'Samsung Galaxy S20 Ultra',
  'SM-G991': 'Samsung Galaxy S21',
  'SM-G996': 'Samsung Galaxy S21+',
  'SM-G998': 'Samsung Galaxy S21 Ultra',
  'SM-S901': 'Samsung Galaxy S22',
  'SM-S906': 'Samsung Galaxy S22+',
  'SM-S908': 'Samsung Galaxy S22 Ultra',
  'SM-S911': 'Samsung Galaxy S23',
  'SM-S916': 'Samsung Galaxy S23+',
  'SM-S918': 'Samsung Galaxy S23 Ultra',
  'SM-S921': 'Samsung Galaxy S24',
  'SM-S926': 'Samsung Galaxy S24+',
  'SM-S928': 'Samsung Galaxy S24 Ultra',
  'SM-S931': 'Samsung Galaxy S25',
  'SM-S936': 'Samsung Galaxy S25+',
  'SM-S938': 'Samsung Galaxy S25 Ultra',
  'SM-F711': 'Samsung Galaxy Z Flip3',
  'SM-F721': 'Samsung Galaxy Z Flip4',
  'SM-F731': 'Samsung Galaxy Z Flip5',
  'SM-F741': 'Samsung Galaxy Z Flip6',
  'SM-F926': 'Samsung Galaxy Z Fold3',
  'SM-F936': 'Samsung Galaxy Z Fold4',
  'SM-F946': 'Samsung Galaxy Z Fold5',
  'SM-F956': 'Samsung Galaxy Z Fold6',
  'SM-A155': 'Samsung Galaxy A15',
  'SM-A156': 'Samsung Galaxy A15 5G',
  'SM-A256': 'Samsung Galaxy A25 5G',
  'SM-A356': 'Samsung Galaxy A35 5G',
  'SM-A556': 'Samsung Galaxy A55 5G',
  'SM-A145': 'Samsung Galaxy A14',
  'SM-A146': 'Samsung Galaxy A14 5G',
  'SM-A546': 'Samsung Galaxy A54 5G',
  'SM-A346': 'Samsung Galaxy A34 5G',
  'SM-A057': 'Samsung Galaxy A05',
  'SM-A065': 'Samsung Galaxy A06',
  'SM-A165': 'Samsung Galaxy A16',
  'SM-A366': 'Samsung Galaxy A36 5G',
  'SM-A566': 'Samsung Galaxy A56 5G',
  'SM-X210': 'Samsung Galaxy Tab A9',
  'SM-X216': 'Samsung Galaxy Tab A9',
  'SM-X610': 'Samsung Galaxy Tab S9 FE',
  'SM-X710': 'Samsung Galaxy Tab S9',
  'SM-X810': 'Samsung Galaxy Tab S9+',
  'SM-X910': 'Samsung Galaxy Tab S9 Ultra',
};

function cleanHint(value, max = 80) {
  if (value == null) return '';
  return String(value)
    .replace(/["']/g, '')
    .trim()
    .slice(0, max);
}

function headerHint(req, name) {
  const raw = req?.headers?.[name] || req?.headers?.[name.toLowerCase()];
  return cleanHint(raw);
}

function sanitizeClientHints(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const formFactor = Array.isArray(raw.formFactor)
    ? raw.formFactor[0]
    : raw.formFactor;
  return {
    model: cleanHint(raw.model, 80),
    platform: cleanHint(raw.platform, 40),
    platformVersion: cleanHint(raw.platformVersion, 32),
    architecture: cleanHint(raw.architecture, 20),
    formFactor: cleanHint(formFactor, 40),
    mobile: Boolean(raw.mobile),
  };
}

function hintsFromRequest(req) {
  const body = sanitizeClientHints(req?.body?.deviceHints);
  const headers = {
    model: headerHint(req, 'sec-ch-ua-model'),
    platform: headerHint(req, 'sec-ch-ua-platform'),
    platformVersion: headerHint(req, 'sec-ch-ua-platform-version'),
    architecture: headerHint(req, 'sec-ch-ua-arch'),
    formFactor: headerHint(req, 'sec-ch-ua-form-factors'),
    mobile: /"?\?1"?/.test(String(req?.headers?.['sec-ch-ua-mobile'] || '')),
  };
  return {
    model: body.model || headers.model,
    platform: body.platform || headers.platform,
    platformVersion: body.platformVersion || headers.platformVersion,
    architecture: body.architecture || headers.architecture,
    formFactor: body.formFactor || headers.formFactor,
    mobile: body.mobile || headers.mobile,
  };
}

function samsungNameFromCode(code) {
  if (!code) return null;
  const upper = String(code).toUpperCase();
  const match = upper.match(/^(SM-[A-Z0-9]{3,8})/);
  if (!match) return null;
  const full = match[1];
  if (SAMSUNG_MODELS[full]) return SAMSUNG_MODELS[full];
  const family = full.slice(0, 7);
  if (SAMSUNG_MODELS[family]) return SAMSUNG_MODELS[family];
  return null;
}

function modelFromUserAgent(ua) {
  const s = String(ua || '');

  const sm = s.match(/\b(SM-[A-Z0-9]+)\b/i);
  if (sm) {
    return samsungNameFromCode(sm[1]) || `Samsung ${sm[1].toUpperCase()}`;
  }

  const pixel = s.match(/\bPixel (?:Tablet|\d[\w.]{0,12})\b/i);
  if (pixel) return `Google ${pixel[0]}`;

  const oneplus = s.match(/\b(ONEPLUS[A-Z0-9]+|CPH\d{4})\b/i);
  if (oneplus) return `OnePlus ${oneplus[1]}`;

  const androidModel = s.match(/Android [^;]+; (?!K\b)([^;)]+?)(?:\s+Build\/|;|\))/i);
  if (androidModel) {
    const token = androidModel[1].trim();
    if (token && token.length >= 2 && token.toUpperCase() !== 'K') {
      return samsungNameFromCode(token) || token;
    }
  }

  return null;
}

function friendlyOs(ua, hints = {}) {
  const s = String(ua || '');
  const platform = String(hints.platform || '').toLowerCase();
  const ver = String(hints.platformVersion || '');
  const major = parseInt(ver, 10);

  if (platform === 'android' || /Android/i.test(s)) {
    const m = s.match(/Android\s+([\d.]+)/i);
    const androidVer = Number.isFinite(major) && major > 0 ? String(major) : m?.[1];
    return androidVer ? `Android ${androidVer}` : 'Android';
  }
  if (platform === 'ios' || /iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s) || /iPad/i.test(hints.model || '')) return 'iPad';
  if (platform === 'windows' || /Windows NT/i.test(s)) {
    if (Number.isFinite(major) && major >= 13) return 'Windows 11';
    if (Number.isFinite(major) && major === 10) return 'Windows 10';
    if (/Windows NT 10\.0/.test(s)) return 'Windows 10/11';
    if (/Windows NT 6\.1/.test(s)) return 'Windows 7';
    return 'Windows';
  }
  if (platform === 'macos' || /Mac OS X/i.test(s)) return 'macOS';
  if (platform === 'chrome os' || /CrOS/i.test(s)) return 'Chrome OS';
  if (/Linux/i.test(s)) return 'Linux';
  return hints.platform || null;
}

function friendlyBrowser(ua) {
  const s = String(ua || '');
  if (/Edg\//i.test(s)) return 'Edge';
  if (/OPR\/|Opera/i.test(s)) return 'Opera';
  if (/SamsungBrowser/i.test(s)) return 'Samsung Internet';
  if (/Firefox\//i.test(s)) return 'Firefox';
  if (/CriOS/i.test(s)) return 'Chrome';
  if (/FxiOS/i.test(s)) return 'Firefox';
  if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) return 'Chrome';
  if (/Safari\//i.test(s) && !/Chrome|Chromium|CriOS/i.test(s)) return 'Safari';
  return 'Browser';
}

function macHardware(hints = {}) {
  const arch = String(hints.architecture || '').toLowerCase();
  if (arch === 'arm' || arch === 'arm64') return 'Apple Silicon Mac';
  if (arch === 'x86' || arch === 'x86_64') return 'Intel Mac';
  return 'Mac';
}

function resolveHardware(ua, hints = {}) {
  const model = cleanHint(hints.model);
  if (model) return samsungNameFromCode(model) || model;

  const fromUa = modelFromUserAgent(ua);
  if (fromUa) return fromUa;

  const s = String(ua || '');
  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (
    /Macintosh|Mac OS X|macOS/i.test(s) ||
    String(hints.platform || '').toLowerCase() === 'macos'
  ) {
    return macHardware(hints);
  }
  if (/Windows/i.test(s) || String(hints.platform || '').toLowerCase() === 'windows') {
    return /Mobile|Tablet/i.test(hints.formFactor || '') ? 'Windows tablet' : 'Windows PC';
  }
  if (/Android/i.test(s)) return 'Android device';
  if (/CrOS/i.test(s)) return 'Chromebook';
  return null;
}

/**
 * Example: "Samsung Galaxy S22 · Chrome on Android 14"
 *          "Apple Silicon Mac · Chrome on macOS"
 */
function describeDevice(ua, hints = {}) {
  const hardware = resolveHardware(ua, hints);
  const os = friendlyOs(ua, hints);
  const browser = friendlyBrowser(ua);

  if (!hardware && !os) return `${browser}`.trim() || 'Unknown device';

  if (hardware && os && String(hardware).toLowerCase().includes(String(os).split(' ')[0].toLowerCase())) {
    return `${hardware} · ${browser}`;
  }
  if (hardware) return `${hardware} · ${browser} on ${os || 'unknown OS'}`;
  return `${browser} on ${os}`;
}

module.exports = {
  describeDevice,
  hintsFromRequest,
  sanitizeClientHints,
};
