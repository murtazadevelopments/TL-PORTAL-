const pool = require('../config/db');
const {
  clientIp,
  clientUserAgent,
  geoFromLoginHints,
  hintedPublicIp,
  isPrivateOrLocalIp,
} = require('../utils/requestMeta');
const { describeDevice, hintsFromRequest } = require('../utils/deviceLabel');
const { recordLoginLog } = require('../controllers/loginLogsController');
const { notifyUserLogin, notifyApp } = require('./notifications');

function formatLoginWhen() {
  try {
    return new Date().toLocaleString('en-PK', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi',
    });
  } catch {
    return new Date().toISOString();
  }
}

function loginPushBody({ device, geo, locationLabel }) {
  const place =
    [geo?.city, geo?.country].filter(Boolean).join(', ') ||
    String(locationLabel || '').trim();
  const bits = [device, place, formatLoginWhen()].filter(Boolean);
  const detail = bits.join(' · ');
  return `If this wasn't you, open Security and change your password. ${detail}`.slice(
    0,
    220
  );
}

function loginIp(req) {
  const hinted = hintedPublicIp(req.body?.deviceHints);
  if (hinted) return hinted;
  const fromReq = clientIp(req);
  if (fromReq && !isPrivateOrLocalIp(fromReq)) return fromReq;
  return fromReq;
}

/**
 * Persist a login log, then email and/or mobile push. Never throws.
 */
async function recordSuccessfulLogin(req, user) {
  try {
    const ip = loginIp(req);
    const userAgent = clientUserAgent(req);
    const hints = hintsFromRequest(req);
    const device = describeDevice(userAgent, hints);
    const geoPromise = geoFromLoginHints(req.body?.deviceHints, ip).catch((err) => {
      console.warn('login geo failed:', err.message || err);
      return { label: '', city: null, area: null, country: null, latitude: null, longitude: null, source: null };
    });
    const logPromise = recordLoginLog({
      userId: user.id,
      employeeId: user.employee_id,
      employeeName: user.name,
      username: user.username,
      ipAddress: ip,
      location: null,
      userAgent,
      device,
      city: null,
      area: null,
      country: null,
      latitude: null,
      longitude: null,
      locationSource: null,
    });
    const [geo, logRow] = await Promise.all([geoPromise, logPromise]);
    const loginMeta = {
      ip,
      userAgent,
      locationLabel: geo.label,
      device,
      geo,
    };
    await Promise.all([
      logRow?.id
        ? pool.query(
            `
              UPDATE login_logs
              SET location = $2, city = $3, area = $4, country = $5,
                  latitude = $6, longitude = $7, location_source = $8
              WHERE id = $1
            `,
            [
              logRow.id,
              geo.label || null,
              geo.city || null,
              geo.area || null,
              geo.country || null,
              geo.latitude ?? null,
              geo.longitude ?? null,
              geo.source || (geo.latitude != null ? 'gps' : 'ip'),
            ]
          )
        : Promise.resolve(),
      notifyUserLogin(user, loginMeta).catch((err) => {
        console.warn('login email failed:', err.message || err);
      }),
      notifyApp(user.id, {
        title: 'New login to your account',
        body: loginPushBody({
          device,
          geo,
          locationLabel: geo.label,
        }),
        url: '/account/security',
        tag: 'login-alert',
      }),
    ]);
  } catch (err) {
    console.warn('recordSuccessfulLogin failed:', err.message || err);
  }
}

module.exports = { recordSuccessfulLogin };
