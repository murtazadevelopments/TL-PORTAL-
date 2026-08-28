const {
  clientIp,
  clientUserAgent,
  lookupGeoFromIp,
  isPrivateOrLocalIp,
} = require('../utils/requestMeta');
const { describeDevice, hintsFromRequest } = require('../utils/deviceLabel');
const { recordLoginLog } = require('../controllers/loginLogsController');
const { notifyUserLogin } = require('./notifications');
const { sendPushToUserSafe } = require('./pushNotifications');

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
  const fromReq = clientIp(req);
  if (fromReq && !isPrivateOrLocalIp(fromReq)) return fromReq;
  const hinted = String(req.body?.deviceHints?.publicIp || '').trim();
  if (hinted && !isPrivateOrLocalIp(hinted)) return hinted;
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
    const geo = await lookupGeoFromIp(ip);
    await recordLoginLog({
      userId: user.id,
      employeeId: user.employee_id,
      employeeName: user.name,
      username: user.username,
      ipAddress: ip,
      location: geo.label,
      userAgent,
      device,
      city: geo.city,
      area: geo.area,
      country: geo.country,
      latitude: geo.latitude,
      longitude: geo.longitude,
    });
    const loginMeta = {
      ip,
      userAgent,
      locationLabel: geo.label,
      device,
      geo,
    };
    // Email and mobile push are independent so a failed mailbox still alerts
    // on a phone that has notifications enabled.
    await Promise.all([
      notifyUserLogin(user, loginMeta).catch((err) => {
        console.warn('login email failed:', err.message || err);
      }),
      sendPushToUserSafe(user.id, {
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
