/**
 * Send one test message through the shared Brevo SMTP helper.
 * Usage: npm run test:mail -- you@example.com
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sendMail, getFrom } = require('../lib/mailer');

async function main() {
  const to = String(process.argv[2] || '').trim();
  if (!to || !to.includes('@')) {
    console.error('Usage: npm run test:mail -- recipient@example.com');
    process.exit(1);
  }

  try {
    const info = await sendMail({
      to,
      subject: 'Textured Lab Portal mail test',
      text: 'This is a test message from the Portal TL mail helper.',
      html: '<p>This is a test message from the Portal TL mail helper.</p>',
    });
    console.log('ok', { to, from: getFrom(), id: info?.id || info?.messageId || null });
  } catch (err) {
    console.error('failed', {
      code: err.code || null,
      responseCode: err.responseCode || null,
      message: String(err.message || 'send failed').slice(0, 180),
    });
    process.exitCode = 1;
  }
}

main();
