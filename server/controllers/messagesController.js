const pool = require('../config/db');
const { sendEmailSafe } = require('../services/email');
const { writeAuditLog } = require('../utils/auditLog');
const { sendPushToUserSafe } = require('../services/pushNotifications');
const { publicSenderLabel, redactMessageSender } = require('../utils/messageSender');

const DELIVERY = new Set(['portal', 'email', 'both']);
const AUDIENCE = new Set(['user', 'all', 'team', 'branch']);

const RECIPIENT_BASE_WHERE = `
  is_active IS DISTINCT FROM FALSE
  AND LOWER(TRIM(COALESCE(status, ''))) IN ('active', 'pending', '')
`;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeDelivery(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

async function loadAudienceRecipients(body) {
  const audienceType = String(body.audienceType || body.audience_type || 'user')
    .trim()
    .toLowerCase();

  if (!AUDIENCE.has(audienceType)) {
    const err = new Error('audienceType must be user, all, team, or branch.');
    err.status = 400;
    throw err;
  }

  if (audienceType === 'user') {
    const recipientId = Number(body.recipientId ?? body.recipient_id);
    if (!Number.isFinite(recipientId) || recipientId <= 0) {
      const err = new Error('recipientId is required for an individual message.');
      err.status = 400;
      throw err;
    }
    const { rows } = await pool.query(
      `
        SELECT id, name, username, email, department, branch, is_active
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [recipientId]
    );
    if (!rows[0]) {
      const err = new Error('Recipient not found.');
      err.status = 404;
      throw err;
    }
    if (rows[0].is_active === false) {
      const err = new Error('Cannot message a deactivated account.');
      err.status = 400;
      throw err;
    }
    return {
      audienceType,
      label: rows[0].name || rows[0].username || `User ${recipientId}`,
      recipients: rows,
    };
  }

  if (audienceType === 'all') {
    const { rows } = await pool.query(
      `
        SELECT id, name, username, email, department, branch
        FROM users
        WHERE ${RECIPIENT_BASE_WHERE}
        ORDER BY name ASC NULLS LAST
      `
    );
    return { audienceType, label: 'All employees', recipients: rows };
  }

  if (audienceType === 'team') {
    const team = String(body.team || body.department || '').trim();
    if (!team) {
      const err = new Error('team is required when audienceType is team.');
      err.status = 400;
      throw err;
    }
    const { rows } = await pool.query(
      `
        SELECT id, name, username, email, department, branch
        FROM users
        WHERE ${RECIPIENT_BASE_WHERE}
          AND LOWER(TRIM(COALESCE(department, ''))) = LOWER(TRIM($1))
        ORDER BY name ASC NULLS LAST
      `,
      [team]
    );
    return { audienceType, label: `Team: ${team}`, recipients: rows };
  }

  // branch
  const branch = String(body.branch || '').trim();
  if (!branch) {
    const err = new Error('branch is required when audienceType is branch.');
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, department, branch
      FROM users
      WHERE ${RECIPIENT_BASE_WHERE}
        AND LOWER(TRIM(COALESCE(branch, ''))) = LOWER(TRIM($1))
      ORDER BY name ASC NULLS LAST
    `,
    [branch]
  );
  return { audienceType, label: `Branch: ${branch}`, recipients: rows };
}

async function deliverOneMessage({
  sender,
  recipient,
  subject,
  messageBody,
  deliveryMethod,
  emailIfPushUndelivered = false,
  pushPayload = null,
}) {
  const { rows } = await pool.query(
    `
      INSERT INTO messages (
        sender_id, recipient_id, subject, body, delivery_method
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id, sender_id, recipient_id, subject, body, delivery_method,
        email_sent_at, read_at, created_at
    `,
    [sender.id, recipient.id, subject || null, messageBody, deliveryMethod]
  );

  let message = rows[0];
  let emailSent = false;
  let emailError = null;

  const push = await notifyRecipientPush(
    recipient,
    subject,
    messageBody,
    message.id,
    pushPayload
  );

  const pushDelivered = Number(push?.sent) > 0;
  const wantEmail =
    deliveryMethod === 'email' ||
    deliveryMethod === 'both' ||
    (emailIfPushUndelivered && !pushDelivered);

  if (wantEmail) {
    if (!recipient.email) {
      emailError = 'No email on file';
    } else {
      const senderLabel = publicSenderLabel(sender);
      const mailSubject =
        subject || `Message from ${senderLabel} — Textured Lab Portal`;
      const safeBody = escapeHtml(messageBody).replace(/\n/g, '<br />');
      const greeting = escapeHtml(recipient.name || recipient.username || 'there');
      const result = await sendEmailSafe({
        to: recipient.email,
        subject: mailSubject,
        text:
          `Hi ${recipient.name || recipient.username || 'there'},\n\n` +
          `You have a new message from ${senderLabel} on the Textured Lab Portal:\n\n` +
          (subject ? `${subject}\n\n` : '') +
          `${messageBody}\n\n` +
          'You can also read this in the portal under My Account → Messages.\n',
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
            <p>Hi ${greeting},</p>
            <p>You have a new message from <strong>${escapeHtml(senderLabel)}</strong>
            on the Textured Lab Portal:</p>
            ${subject ? `<p><strong>${escapeHtml(subject)}</strong></p>` : ''}
            <div style="padding:12px 14px;border-left:3px solid #3dff7a;background:#f6f8fb">
              ${safeBody}
            </div>
            <p style="margin-top:16px;color:#555;font-size:13px">
              You can also read this in the portal under <em>My Account → Messages</em>.
            </p>
          </div>
        `,
        emailType: 'admin_message',
      });

      if (result) {
        emailSent = true;
        const { rows: updated } = await pool.query(
          `
            UPDATE messages
            SET email_sent_at = NOW()
            WHERE id = $1
            RETURNING
              id, sender_id, recipient_id, subject, body, delivery_method,
              email_sent_at, read_at, created_at
          `,
          [message.id]
        );
        message = updated[0] || message;
      } else {
        emailError = 'Email send failed';
      }
    }
  }

  return { message, emailSent, emailError, pushSent: Number(push?.sent) || 0 };
}

async function notifyRecipientPush(recipient, subject, messageBody, messageId, extra = null) {
  if (!recipient?.id) return { sent: 0 };
  const preview = String(messageBody || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return sendPushToUserSafe(
    recipient.id,
    {
      title: extra?.title || subject || 'New portal message',
      body: extra?.body || preview || 'You have a new message in Textured Lab Portal.',
      url: extra?.url || `/account/messages`,
      tag: extra?.tag || `message-${messageId || recipient.id}`,
    },
    extra?.pushOpts || { requireEnabled: false, urgency: extra?.urgency || 'high' }
  );
}

/**
 * GET /api/admin/messages/recipients
 */
async function listMessageRecipients(req, res) {
  try {
    const { rows: recipients } = await pool.query(
      `
        SELECT id, name, username, employee_id, email, role, department, branch
        FROM users
        WHERE ${RECIPIENT_BASE_WHERE}
        ORDER BY name ASC NULLS LAST, username ASC
      `
    );

    let teams = [];
    try {
      const { rows } = await pool.query(
        `SELECT id, name FROM teams ORDER BY name ASC`
      );
      teams = rows;
    } catch {
      /* teams table optional */
    }

    // Also include departments present on users but missing from catalog
    const deptSet = new Set(teams.map((t) => String(t.name).trim().toLowerCase()));
    for (const r of recipients) {
      const d = String(r.department || '').trim();
      if (d && !deptSet.has(d.toLowerCase())) {
        teams.push({ id: null, name: d });
        deptSet.add(d.toLowerCase());
      }
    }
    teams.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const branchSet = new Set();
    const branches = [];
    for (const r of recipients) {
      const b = String(r.branch || '').trim();
      if (b && !branchSet.has(b.toLowerCase())) {
        branchSet.add(b.toLowerCase());
        branches.push(b);
      }
    }
    branches.sort((a, b) => a.localeCompare(b));

    return res.json({
      recipients,
      teams,
      branches,
      counts: {
        all: recipients.length,
        byTeam: teams.reduce((acc, t) => {
          acc[t.name] = recipients.filter(
            (r) =>
              String(r.department || '').trim().toLowerCase() ===
              String(t.name).trim().toLowerCase()
          ).length;
          return acc;
        }, {}),
        byBranch: branches.reduce((acc, b) => {
          acc[b] = recipients.filter(
            (r) =>
              String(r.branch || '').trim().toLowerCase() === b.toLowerCase()
          ).length;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    console.error('listMessageRecipients error:', err);
    return res.status(500).json({ message: 'Server error loading recipients.' });
  }
}

/**
 * POST /api/admin/messages
 * Body: {
 *   audienceType: 'user'|'all'|'team'|'branch',
 *   recipientId?, team?, branch?,
 *   subject, body, deliveryMethod
 * }
 */
async function sendAdminMessage(req, res) {
  try {
    const body = req.body || {};
    const subject = body.subject != null ? String(body.subject).trim() : '';
    const messageBody = String(body.body || '').trim();
    const deliveryMethod = normalizeDelivery(
      body.deliveryMethod ?? body.delivery_method
    );

    if (!messageBody) {
      return res.status(400).json({ message: 'Message body is required.' });
    }
    if (!DELIVERY.has(deliveryMethod)) {
      return res.status(400).json({
        message: 'deliveryMethod must be portal, email, or both.',
      });
    }

    let audience;
    try {
      audience = await loadAudienceRecipients(body);
    } catch (err) {
      return res.status(err.status || 400).json({ message: err.message });
    }

    if (!audience.recipients.length) {
      return res.status(400).json({
        message: `No employees found for “${audience.label}”.`,
      });
    }

    const { rows: senderRows } = await pool.query(
      `
        SELECT id, name, username, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const sender = senderRows[0] || {
      id: req.user.id,
      name: req.user.name,
      username: req.user.username,
      role: req.user.role,
    };

    const created = [];
    let emailsSent = 0;
    let emailFailures = 0;

    for (const recipient of audience.recipients) {
      // Don't message yourself in bulk "all"
      if (String(recipient.id) === String(req.user.id) && audience.audienceType !== 'user') {
        continue;
      }
      const result = await deliverOneMessage({
        sender,
        recipient,
        subject,
        messageBody,
        deliveryMethod,
      });
      created.push(result.message);
      if (result.emailSent) emailsSent += 1;
      if (result.emailError) emailFailures += 1;
    }

    if (!created.length) {
      return res.status(400).json({
        message: 'No recipients left to message after filters.',
      });
    }

    try {
      await writeAuditLog({
        actorId: req.user.id,
        actorUsername: req.user.username || null,
        action: 'message_sent',
        targetTable: 'messages',
        targetId: created[0].id,
        reason: `Message to ${audience.label} (${created.length} recipient(s)) via ${deliveryMethod}${
          subject ? ` — ${subject}` : ''
        }`,
      });
    } catch (auditErr) {
      console.error('message audit log failed:', auditErr.message || auditErr);
    }

    const plural = created.length === 1 ? 'employee' : 'employees';
    let emailNote = '';
    if (deliveryMethod === 'email' || deliveryMethod === 'both') {
      emailNote =
        emailFailures > 0
          ? ` ${emailsSent} email(s) sent, ${emailFailures} skipped/failed.`
          : ` ${emailsSent} email(s) sent.`;
    }

    return res.status(201).json({
      message: `Message sent to ${created.length} ${plural}.${emailNote}`,
      audienceType: audience.audienceType,
      audienceLabel: audience.label,
      sentCount: created.length,
      emailsSent,
      emailFailures,
      data: created[0],
      emailSent: emailsSent > 0,
      emailError:
        emailFailures > 0
          ? `${emailFailures} recipient(s) did not receive email; portal copies were still saved.`
          : null,
    });
  } catch (err) {
    console.error('sendAdminMessage error:', err);
    return res.status(500).json({ message: 'Server error sending message.' });
  }
}

/**
 * GET /api/messages?limit=&offset=
 */
async function listMyMessages(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows } = await pool.query(
      `
        SELECT
          m.id, m.sender_id, m.recipient_id, m.subject, m.body,
          m.delivery_method, m.email_sent_at, m.read_at, m.created_at,
          u.name AS sender_name,
          u.username AS sender_username,
          u.role AS sender_role
        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.recipient_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [req.user.id, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM messages WHERE recipient_id = $1`,
      [req.user.id]
    );

    return res.json({
      messages: rows.map(redactMessageSender),
      total: countRows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('listMyMessages error:', err);
    return res.status(500).json({ message: 'Server error loading messages.' });
  }
}

/**
 * GET /api/messages/unread-count
 */
async function unreadCount(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM messages
        WHERE recipient_id = $1 AND read_at IS NULL
      `,
      [req.user.id]
    );
    return res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    console.error('unreadCount error:', err);
    return res.status(500).json({ message: 'Server error counting unread messages.' });
  }
}

/**
 * PATCH /api/messages/:id/read
 */
async function markMessageRead(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid message id.' });
    }

    const { rows: existing } = await pool.query(
      `SELECT id, recipient_id, read_at FROM messages WHERE id = $1 LIMIT 1`,
      [id]
    );
    const row = existing[0];
    if (!row) {
      return res.status(404).json({ message: 'Message not found.' });
    }
    if (String(row.recipient_id) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You cannot mark this message as read.' });
    }

    if (row.read_at) {
      return res.json({
        id: row.id,
        read_at: row.read_at,
        alreadyRead: true,
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE messages
        SET read_at = NOW()
        WHERE id = $1 AND recipient_id = $2
        RETURNING id, read_at
      `,
      [id, req.user.id]
    );

    return res.json({
      id: rows[0].id,
      read_at: rows[0].read_at,
      alreadyRead: false,
    });
  } catch (err) {
    console.error('markMessageRead error:', err);
    return res.status(500).json({ message: 'Server error updating message.' });
  }
}

module.exports = {
  listMessageRecipients,
  sendAdminMessage,
  listMyMessages,
  unreadCount,
  markMessageRead,
  deliverOneMessage,
};
