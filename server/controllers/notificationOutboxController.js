const { listOutbox } = require('../services/notificationOutbox');

async function listNotificationOutbox(req, res) {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const rows = await listOutbox(status);
    return res.json({ rows });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ message: 'notification_outbox is not created yet.' });
    }
    console.error('listNotificationOutbox error:', err);
    return res.status(500).json({ message: 'Server error loading the notification outbox.' });
  }
}

module.exports = { listNotificationOutbox };
