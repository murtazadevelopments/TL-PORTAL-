const {
  clientIp,
  clientUserAgent,
  lookupGeoFromIp,
  isPrivateOrLocalIp,
} = require('../utils/requestMeta');
const { describeDevice, hintsFromRequest } = require('../utils/deviceLabel');
const { recordLoginLog } = require('../controllers/loginLogsController');
const { notifyUserLogin } = require('./notifications');

function loginIp(req) {
  const fromReq = clientIp(req);
  if (fromReq && !isPrivateOrLocalIp(fromReq)) return fromReq;
  const hinted = String(req.body?.deviceHints?.publicIp || '').trim();
  if (hinted && !isPrivateOrLocalIp(hinted)) return hinted;
  return fromReq;
}

/**
 * Persist a login log and send the login email. Never throws.
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
    await notifyUserLogin(user, {
      ip,
      userAgent,
      locationLabel: geo.label,
      device,
      geo,
    });
  } catch (err) {
    console.warn('recordSuccessfulLogin failed:', err.message || err);
  }
}

module.exports = { recordSuccessfulLogin };
