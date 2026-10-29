const pool = require('../config/db');
const { sendEmailSafe } = require('./email');
const {
  resolveNewSignupRecipientEmail,
  logEmail,
} = require('./notificationSettings');
const { notifyAfterResponse } = require('../utils/notifyAfterResponse');
const { isBranchManagerDesignation } = require('../constants/designations');

async function getAdminEmails() {
  const fromEnv = String(process.env.ADMIN_NOTIFY_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const { rows } = await pool.query(
    `SELECT email FROM users WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'ceo', 'manager') AND email IS NOT NULL`
  );
  const fromDb = rows.map((r) => String(r.email).trim().toLowerCase()).filter(Boolean);

  return [...new Set([...fromEnv, ...fromDb])];
}

async function getCeoEmails() {
  const { rows } = await pool.query(
    `
      SELECT email
      FROM users
      WHERE LOWER(TRIM(role)) = 'ceo'
        AND is_active IS NOT FALSE
        AND NULLIF(TRIM(email), '') IS NOT NULL
    `
  );
  return [
    ...new Set(rows.map((r) => String(r.email).trim().toLowerCase()).filter(Boolean)),
  ];
}

async function notifyCeoIfBranchManagerWork(
  actorId,
  { action, targetName, targetId, details } = {}
) {
  if (!actorId) return null;
  const { rows } = await pool.query(
    `
      SELECT id, name, username, email, designation, branch, department, role
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [actorId]
  );
  const actor = rows[0];
  if (!actor) return null;
  if (String(actor.role || '').trim().toLowerCase() === 'ceo') return null;
  if (!isBranchManagerDesignation(actor.designation)) return null;

  const actorEmail = String(actor.email || '').trim().toLowerCase();
  const to = (await getCeoEmails()).filter((email) => email && email !== actorEmail);
  if (!to.length) {
    console.warn('[branch-manager-ceo] SKIP — no CEO email on file');
    return null;
  }

  const who = actor.name || actor.username || `User ${actor.id}`;
  const actionLabel = action || 'updated employee data';
  const target = targetName || (targetId ? `employee #${targetId}` : 'an employee');
  const detailHtml =
    Array.isArray(details) && details.length
      ? `<ul>${details.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';

  return sendEmailSafe({
    emailType: 'branch_manager_activity',
    to,
    subject: `Branch Manager update: ${who} — ${actionLabel}`,
    html: `
      <p>A Branch Manager changed employee data on Textured Lab Portal.</p>
      <ul>
        <li><strong>Branch Manager:</strong> ${escapeHtml(who)}</li>
        <li><strong>Username:</strong> ${escapeHtml(actor.username || '')}</li>
        <li><strong>Designation:</strong> ${escapeHtml(actor.designation || 'Branch Manager')}</li>
        <li><strong>Office:</strong> ${escapeHtml(actor.branch || '—')}</li>
        <li><strong>Team:</strong> ${escapeHtml(actor.department || '—')}</li>
        <li><strong>Action:</strong> ${escapeHtml(actionLabel)}</li>
        <li><strong>Employee:</strong> ${escapeHtml(target)}</li>
      </ul>
      ${detailHtml}
      <p>Sent ${escapeHtml(formatTimestamp())}.</p>
    `,
  });
}

function queueCeoBranchManagerNotice(req, payload) {
  const actorId = req?.user?.id;
  if (!actorId) return;
  void notifyAfterResponse('branch-manager-ceo', actorId, () =>
    notifyCeoIfBranchManagerWork(actorId, payload)
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function firstName(fullName) {
  const part = String(fullName || '')
    .trim()
    .split(/\s+/)[0];
  return part || 'there';
}

async function notifyApp(userId, payload = {}, opts = {}) {
  if (!userId) return { sent: 0 };
  const { sendPushToUserSafe } = require('./pushNotifications');
  // Unique tags so each update shows as its own notification (unless collapse=true).
  const baseTag = String(payload.tag || 'portal-update').trim() || 'portal-update';
  const tag = payload.collapse
    ? baseTag
    : `${baseTag}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const result = await sendPushToUserSafe(
    userId,
    {
      title: payload.title || 'Textured Lab Portal',
      body: payload.body || '',
      url: payload.url || '/account/messages',
      tag,
    },
    {
      requireEnabled: false,
      ttl: opts.ttl,
      urgency: opts.urgency || 'high',
    }
  );
  console.log(
    `[push] user=${userId} tag=${tag} sent=${result?.sent || 0} skipped=${Boolean(result?.skipped)} disabled=${Boolean(result?.disabled)} error=${result?.error || ''}`
  );
  return result;
}

function formatTimestamp(value = new Date()) {
  try {
    return new Date(value).toLocaleString('en-PK', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi',
    });
  } catch {
    return String(value);
  }
}

/**
 * Feature A — notify designated recipient(s) of a new signup.
 * Primary: notification_settings.new_signup_recipient → users.email
 * Also: any admin with permission notifications:signup_recipient
 */
async function notifyDesignatedNewSignup(user) {
  console.log(`[signup-notify] start for new user id=${user?.id} username=${user?.username}`);
  const emails = new Set();

  // 1) Primary: notification_settings
  try {
    const designated = await resolveNewSignupRecipientEmail();
    if (designated?.email) {
      emails.add(designated.email);
      console.log(
        `[signup-notify] settings recipient=${designated.email} (source=${designated.source}, userId=${designated.userId || 'n/a'})`
      );
    } else {
      console.warn(
        '[signup-notify] notification_settings.new_signup_recipient missing or unresolved'
      );
    }
  } catch (err) {
    console.error('[signup-notify] settings lookup failed:', err.message || err);
  }

  // 2) Admins granted the signup-notification permission
  try {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT u.email
        FROM users u
        INNER JOIN admin_permissions ap ON ap.user_id = u.id
        WHERE u.is_active = true
          AND u.email IS NOT NULL
          AND ap.permission_key = 'notifications:signup_recipient'
      `
    );
    for (const row of rows) {
      const email = String(row.email || '')
        .trim()
        .toLowerCase();
      if (email) emails.add(email);
    }
    console.log(`[signup-notify] permission holders added; total recipients=${emails.size}`);
  } catch (err) {
    console.warn('[signup-notify] permission lookup failed:', err.message);
  }

  if (!emails.size) {
    console.warn(
      '[signup-notify] SKIP — no recipients (set notification_settings or grant notifications:signup_recipient)'
    );
    await logEmail({
      emailType: 'new_signup_recipient',
      recipient: null,
      meta: { ok: false, skipped: true, reason: 'no_recipients', userId: user?.id },
    });
    return null;
  }

  const when = formatTimestamp(user.created_at || new Date());
  const to = [...emails];
  const { frontendBaseUrl } = require('../utils/frontendUrl');
  const approveUrl = `${frontendBaseUrl()}/admin/employees?status=pending`;
  const employment =
    user.employment_type === 'remote'
      ? 'Remote'
      : user.employment_type === 'onsite'
        ? 'Onsite'
        : user.employment_type || '—';
  const who = user.name || user.username || 'A candidate';
  const subject = `Pending approval: ${who} (${user.username || 'new account'})`;
  const text = [
    'A portal account is waiting for approval.',
    '',
    `Name: ${who}`,
    `Username: ${user.username || '—'}`,
    `Email: ${user.email || '—'}`,
    `Team: ${user.department || '—'}`,
    `Employment type: ${employment}`,
    `Signed up: ${when}`,
    '',
    `Open pending employees: ${approveUrl}`,
  ].join('\n');

  const result = await sendEmailSafe({
    emailType: 'new_signup_recipient',
    to,
    subject,
    text,
    html: `
      <p>A portal account is waiting for approval.</p>
      <p>
        Name: ${escapeHtml(who)}<br/>
        Username: ${escapeHtml(user.username || '—')}<br/>
        Email: ${escapeHtml(user.email || '—')}<br/>
        Team: ${escapeHtml(user.department || '—')}<br/>
        Employment type: ${escapeHtml(employment)}<br/>
        Signed up: ${escapeHtml(when)}
      </p>
      <p><a href="${escapeHtml(approveUrl)}">Open pending employees</a></p>
    `,
  });

  return result;
}

/** @deprecated Prefer notifyDesignatedNewSignup — kept for any callers expecting admin blast */
async function notifyAdminsNewSignup(user) {
  return notifyDesignatedNewSignup(user);
}

async function notifyUserSignup(user) {
  const to = String(user?.email || '')
    .trim()
    .toLowerCase();
  if (!to) {
    console.warn(`[signup-notify] skip welcome — user id=${user?.id} has no email`);
    return null;
  }
  await sendEmailSafe({
    emailType: 'user_signup',
    to,
    subject: 'Your Textured Lab Portal account is pending approval',
    text: [
      `Hi ${user.name || ''},`,
      '',
      'Your Textured Lab Portal account was created and is waiting for admin approval.',
      `Username: ${user.username || ''}`,
      '',
      'You can sign in after an administrator activates the account. You will get another email when that happens.',
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>Your Textured Lab Portal account was created and is waiting for admin approval.</p>
      <p>Username: <strong>${escapeHtml(user.username || '')}</strong></p>
      <p>You can sign in after an administrator activates the account. You will get another email when that happens.</p>
    `,
  });
}

async function notifyAccountApproved(user) {
  if (!user?.id && !user?.email) return null;
  const { frontendBaseUrl } = require('../utils/frontendUrl');
  const loginUrl = `${frontendBaseUrl()}/`;

  const [result] = await Promise.all([
    user.email
      ? sendEmailSafe({
          emailType: 'account_approved',
          to: user.email,
          subject: 'Your Textured Lab Portal account has been approved',
          text: `Hi ${user.name || ''},\n\nYour Textured Lab Portal account has been approved. You can now sign in:\n${loginUrl}\n\nUsername: ${user.username || ''}\n`,
          html: `
        <p>Hi ${escapeHtml(user.name || '')},</p>
        <p>Your Textured Lab Portal account has been <strong>approved</strong>. You can now sign in.</p>
        <p>Username: <strong>${escapeHtml(user.username || '')}</strong></p>
        <p><a href="${escapeHtml(loginUrl)}">Sign in to Textured Lab Portal</a></p>
      `,
        }).then(async (emailResult) => {
          await logEmail({
            emailType: 'account_approved',
            recipient: user.email,
            meta: { userId: user.id, ok: Boolean(emailResult) },
          });
          return emailResult;
        })
      : Promise.resolve(null),
    notifyApp(user.id, {
      title: 'Account approved',
      body: 'Your portal account is approved. You can sign in now.',
      url: '/',
      tag: 'account-approved',
    }),
  ]);

  return result;
}

async function notifyUsernameReminder(userOrUsers) {
  const list = (Array.isArray(userOrUsers) ? userOrUsers : [userOrUsers]).filter(
    (u) => u && String(u.username || '').trim() !== ''
  );
  if (!list.length) {
    console.warn('[forgot-username] skip email — no non-empty username on matched accounts');
    return null;
  }

  const email = list[0].email;
  if (!email) {
    console.warn('[forgot-username] skip email — matched account has no email');
    return null;
  }

  const usernames = [...new Set(list.map((u) => String(u.username).trim()))];
  const greetingName = escapeHtml(list[0].name || '');

  const usernameBlock =
    usernames.length === 1
      ? `<p>Your username is: <strong>${escapeHtml(usernames[0])}</strong></p>`
      : `<p>We found more than one account for this email. Your usernames are:</p>
         <ul>${usernames.map((u) => `<li><strong>${escapeHtml(u)}</strong></li>`).join('')}</ul>`;

  const textBlock =
    usernames.length === 1
      ? `Your username is: ${usernames[0]}`
      : `Your usernames are:\n${usernames.map((u) => `- ${u}`).join('\n')}`;

  return sendEmailSafe({
    emailType: 'forgot_username',
    to: email,
    subject: 'Your Textured Lab Portal username',
    text: `Hi ${list[0].name || ''},\n\n${textBlock}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>Hi ${greetingName},</p>
      ${usernameBlock}
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

async function notifySalesPinOtp(user, otp) {
  if (!user?.email) return null;
  return sendEmailSafe({
    to: user.email,
    subject: 'Your sales PIN reset code',
    emailType: 'sales_pin_otp',
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>Use this one-time code to change your sales PIN. It expires in 10 minutes.</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${escapeHtml(otp)}</p>
      <p>If you did not request this, you can ignore this email. Do not share the code.</p>
    `,
  });
}

async function notifyTPinOtp(user, otp) {
  if (!user?.email) return null;
  return sendEmailSafe({
    to: user.email,
    subject: 'Your T-Pin reset code',
    emailType: 't_pin_otp',
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>Use this one-time code to change your Team Leader Dashboard T-Pin. It expires in 10 minutes.</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${escapeHtml(otp)}</p>
      <p>If you did not request this, you can ignore this email. Do not share the code.</p>
    `,
  });
}

async function notifyTlViewPinOtp(user, otp) {
  if (!user?.email) return null;
  return sendEmailSafe({
    to: user.email,
    subject: 'Your viewer PIN reset code',
    emailType: 'tl_view_pin_otp',
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>Use this one-time code to change your Team Leader Dashboard viewer PIN. It expires in 10 minutes.</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${escapeHtml(otp)}</p>
      <p>If you did not request this, you can ignore this email. Do not share the code.</p>
    `,
  });
}

async function notifyPasswordReset(user, resetUrl) {
  const to = String(user?.email || '')
    .trim()
    .toLowerCase();
  if (!to) {
    console.warn(`[forgot-password] skip email — user id=${user?.id} has no email`);
    return null;
  }
  await sendEmailSafe({
    emailType: 'password_reset',
    to,
    subject: `Reset your Textured Lab Portal password (${user.username || 'account'})`,
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>We received a password reset request for username <strong>${escapeHtml(
        user.username || ''
      )}</strong>. Click the link below (expires in 1 hour):</p>
      <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

const SENSITIVE_KEYS = new Set([
  'password',
  'account_number',
  'iban',
  'bank_name',
  'account_title',
  'salary',
]);

function summarizeChanges(before, after, keys) {
  const changed = [];
  for (const key of keys) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    const aNorm = a == null ? '' : String(a);
    const bNorm = b == null ? '' : String(b);
    if (aNorm === bNorm) continue;
    if (SENSITIVE_KEYS.has(key)) {
      changed.push(`${key.replace(/_/g, ' ')} (updated)`);
    } else {
      changed.push(`${key.replace(/_/g, ' ')}`);
    }
  }
  return changed;
}

async function notifyEmployeeAdminUpdated(employee, changedFields) {
  if (!employee?.id && !employee?.email) return;
  const list =
    changedFields.length > 0
      ? `<ul>${changedFields.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      : '<p>Your profile information was updated.</p>';

  await Promise.all([
    employee.email
      ? sendEmailSafe({
          to: employee.email,
          subject: 'Your profile was updated by an administrator',
          html: `
        <p>Hi ${escapeHtml(employee.name || '')},</p>
        <p>An administrator updated your employee profile.</p>
        ${list}
        <p>Sensitive values (passwords, bank account numbers) are never included in emails.</p>
      `,
        })
      : Promise.resolve(null),
    notifyApp(employee.id, {
      title: 'Your profile was updated',
      body: 'An administrator updated your employee profile. Open the portal to review it.',
      url: '/account',
      tag: 'profile-updated',
    }),
  ]);
}

async function notifyAdminsEmployeeSelfUpdate() {
  return;
}

/**
 * Feature B — routine login notification to the user.
 */
async function notifyUserLogin(user, { ip, userAgent, locationLabel, device, geo } = {}) {
  if (!user?.email) return null;

  const when = formatTimestamp(new Date());
  const deviceLabel = escapeHtml(device || userAgent || 'Unknown device');
  const where = escapeHtml(locationLabel || 'Unknown location');
  const ipLabel = escapeHtml(ip || 'Unknown IP');
  const city = escapeHtml(geo?.city || '');
  const area = escapeHtml(geo?.area || '');
  const country = escapeHtml(geo?.country || '');
  const coords =
    geo?.latitude != null && geo?.longitude != null
      ? `${Number(geo.latitude).toFixed(4)}, ${Number(geo.longitude).toFixed(4)}`
      : '';

  const result = await sendEmailSafe({
    to: user.email,
    subject: 'New login to your Textured Lab Portal account',
    html: `
      <p>Hi ${escapeHtml(firstName(user.name))},</p>
      <p>You just logged in to your Textured Lab Portal account.</p>
      <ul>
        <li><strong>When:</strong> ${escapeHtml(when)}</li>
        <li><strong>IP address:</strong> ${ipLabel}</li>
        ${city ? `<li><strong>City:</strong> ${city}</li>` : ''}
        ${area ? `<li><strong>Area:</strong> ${area}</li>` : ''}
        ${country ? `<li><strong>Country:</strong> ${country}</li>` : ''}
        ${coords ? `<li><strong>Coordinates:</strong> ${escapeHtml(coords)}</li>` : ''}
        ${!city && !country ? `<li><strong>Approximate location:</strong> ${where}</li>` : ''}
        <li><strong>Device:</strong> ${deviceLabel}</li>
      </ul>
      <p>If this was you, no action is needed.</p>
    `,
  });

  await logEmail({
    emailType: 'login_notify',
    recipient: user.email,
    meta: { userId: user.id, ip: ip || null, ok: Boolean(result) },
  });

  return result;
}

function birthdayEmailWrap(inner) {
  return `
    <div style="background:#070910;padding:28px 16px;font-family:Nunito,Segoe UI,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#12182a;border:1px solid rgba(61,255,122,.35);border-radius:20px;padding:28px 24px;color:#c9d4e8;">
        ${inner}
      </div>
    </div>
  `;
}

function calendarYearNow() {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi',
        year: 'numeric',
      }).format(new Date())
    );
  } catch {
    return new Date().getFullYear();
  }
}

/**
 * Employee birthday — email + push at 12:00 AM Asia/Karachi on the day.
 */
async function notifyBirthday(user) {
  const who = firstName(user?.name);
  const year = calendarYearNow();
  let emailResult = null;
  if (user?.email) {
    emailResult = await sendEmailSafe({
      emailType: 'birthday',
      to: user.email,
      subject: `Happy Birthday, ${who}! 🎉`,
      html: birthdayEmailWrap(`
      <p style="margin:0 0 8px;letter-spacing:.14em;text-transform:uppercase;font-size:12px;color:#7ecbff;">Textured Lab</p>
      <h1 style="margin:0 0 12px;font-size:28px;color:#f4f8ff;">Happy Birthday, ${escapeHtml(who)}!</h1>
      <p style="line-height:1.6;margin:0 0 12px;">The whole Textured Lab family is celebrating you today. Thank you for the care, craft, and energy you bring to the lab.</p>
      <p style="line-height:1.6;margin:0 0 18px;">May this year be kind, bright, and full of work you are proud of. Enjoy your day — you have earned every wish.</p>
      <p style="margin:0;color:#3dff7a;"><strong>— Textured Lab</strong></p>
    `),
    });
  }

  let pushResult = { sent: 0 };
  if (user?.id) {
    pushResult = await notifyApp(user.id, {
      title: `Happy Birthday, ${who}!`,
      body: 'The Textured Lab family is celebrating you today.',
      url: '/account',
      tag: `birthday-${year}`,
      collapse: true,
    });
  }

  const emailOk = Boolean(emailResult);
  const pushOk = Number(pushResult?.sent) > 0;
  return {
    ok: emailOk || pushOk,
    emailOk,
    pushOk,
    email: emailResult,
    push: pushResult,
  };
}

/**
 * CEO reminder — sent 24 hours before (midnight the day before, Asia/Karachi).
 */
async function notifyCeoBirthdayTomorrow(user, { includeBirthdayPerson, to: toOverride } = {}) {
  const selfEmail = String(user?.email || '').trim().toLowerCase();
  let to = Array.isArray(toOverride) ? [...toOverride] : await getCeoEmails();
  if (!includeBirthdayPerson) {
    to = to.filter((email) => email && email !== selfEmail);
  }
  if (!to.length) {
    console.warn('[birthday-ceo] SKIP — no CEO email on file');
    return null;
  }

  const who = user?.name || user?.username || `Employee ${user?.id}`;
  return sendEmailSafe({
    emailType: 'birthday_ceo_preview',
    to,
    subject: `Tomorrow is ${who}'s birthday`,
    html: birthdayEmailWrap(`
      <p style="margin:0 0 8px;letter-spacing:.14em;text-transform:uppercase;font-size:12px;color:#7ecbff;">Birthday reminder</p>
      <h1 style="margin:0 0 12px;font-size:24px;color:#f4f8ff;">${escapeHtml(who)} has a birthday tomorrow</h1>
      <p style="margin:0 0 12px;line-height:1.6;">This is your 24-hour notice so you can wish them in time.</p>
      <ul style="padding-left:18px;line-height:1.7;">
        <li><strong>Name:</strong> ${escapeHtml(who)}</li>
        <li><strong>Employee ID:</strong> ${escapeHtml(user?.employee_id || '—')}</li>
        <li><strong>Team:</strong> ${escapeHtml(user?.department || '—')}</li>
        <li><strong>Branch:</strong> ${escapeHtml(user?.branch || '—')}</li>
      </ul>
      <p style="margin:0;color:#8b97ad;">They will receive their birthday email from Textured Lab at 12:00 AM on the day.</p>
    `),
  });
}

function remoteFaceEvent(challenge = {}) {
  const kind = String(challenge.kind || '').toLowerCase();
  const seq = Number(challenge.seq) || 0;
  if (kind === 'checkout') {
    return {
      key: 'sign_out',
      title: 'Signed out',
      subjectVerb: 'signed out',
    };
  }
  if (kind === 'start' || seq === 1) {
    return {
      key: 'sign_in',
      title: 'Signed in',
      subjectVerb: 'signed in',
    };
  }
  return {
    key: 'random',
    title: seq ? `Random face check ${seq}` : 'Random face check',
    subjectVerb: 'completed a random face check',
  };
}

async function notifyCeoRemoteFaceAttendance(user, challenge = {}) {
  const employment = String(user?.employment_type || '').trim().toLowerCase();
  if (employment && employment !== 'remote') return { sent: false, reason: 'not-remote' };

  const to = await getCeoEmails();
  if (!to.length) {
    console.warn('[ceo-remote-face] SKIP — no CEO email on file');
    return { sent: false, reason: 'no-ceo-email' };
  }

  const who = user?.name || user?.username || `User ${user?.id}`;
  const event = remoteFaceEvent(challenge);
  const status = String(challenge.status || 'verified').toLowerCase();
  const statusLabel = status === 'late' ? 'Late' : status === 'verified' ? 'On time' : status;
  const when = formatTimestamp(challenge.checkedInAt || new Date());
  const extra =
    event.key === 'sign_out' && challenge.durationLabel
      ? `<li><strong>Today’s duration:</strong> ${escapeHtml(challenge.durationLabel)}</li>`
      : '';

  const result = await sendEmailSafe({
    emailType: 'ceo_remote_face_attendance',
    to,
    subject: `Remote attendance: ${who} ${event.subjectVerb}`,
    html: `
      <p>A remote employee completed face attendance.</p>
      <ul>
        <li><strong>Event:</strong> ${escapeHtml(event.title)}</li>
        <li><strong>Name:</strong> ${escapeHtml(who)}</li>
        <li><strong>Username:</strong> ${escapeHtml(user?.username || '—')}</li>
        <li><strong>Employee ID:</strong> ${escapeHtml(user?.employee_id || '—')}</li>
        <li><strong>Designation:</strong> ${escapeHtml(user?.designation || '—')}</li>
        <li><strong>Status:</strong> ${escapeHtml(statusLabel)}</li>
        <li><strong>Time:</strong> ${escapeHtml(when)}</li>
        ${extra}
      </ul>
      <p>Sent to CEO only. This is a face attendance punch, not a portal login.</p>
    `,
  });

  await logEmail({
    emailType: 'ceo_remote_face_attendance',
    recipient: to.join(','),
    meta: {
      userId: user?.id,
      event: event.key,
      kind: challenge.kind || null,
      seq: challenge.seq || null,
      status,
      hourKey: challenge.hourKey || null,
      ok: Boolean(result),
    },
  });

  return result;
}

async function notifyAttendanceFailed(user, hourKey) {
  const emails = await getAdminEmails();
  if (!emails.length) return null;

  const who = user?.name || user?.username || `User ${user?.id}`;
  const result = await sendEmailSafe({
    to: emails,
    subject: `Attendance check-in failed: ${who}`,
    html: `
      <p>A remote employee failed face verification after multiple attempts.</p>
      <ul>
        <li><strong>Name:</strong> ${escapeHtml(who)}</li>
        <li><strong>Username:</strong> ${escapeHtml(user?.username)}</li>
        <li><strong>Hour:</strong> ${escapeHtml(hourKey)}</li>
      </ul>
      <p>No face image was stored. Review Attendance in the admin portal if a manual mark is needed.</p>
    `,
  });

  await logEmail({
    emailType: 'attendance_failed',
    recipient: emails.join(','),
    meta: { userId: user?.id, hourKey, ok: Boolean(result) },
  });

  return result;
}

async function notifyRemoteAttendanceCheck(user, challenge) {
  if (!user?.id && !user?.email) return { ok: false };
  const { frontendBaseUrl } = require('../utils/frontendUrl');
  const {
    START_ON_TIME_MINUTES,
    LATE_AFTER_MINUTES,
    ABSENT_AFTER_MINUTES,
    RESPOND_TARGET_MINUTES,
    formatClock,
  } = require('../utils/remoteCheckWindows');
  const checkUrl = `${frontendBaseUrl()}/attendance`;
  const isCheckout = String(challenge.kind || '') === 'checkout';
  const which = isCheckout
    ? 'check-out'
    : Number(challenge.seq) === 1
      ? 'shift-start check-in'
      : `availability check ${challenge.seq} of 5`;
  const when = formatClock(challenge.scheduled_at);
  const subject = isCheckout
    ? `Attendance check-out now`
    : `Attendance check-in now (${which})`;
  const html = `
      <p>Hi ${escapeHtml(firstName(user.name))},</p>
      <p>Please open the portal and complete your face ${isCheckout ? 'check-out' : 'check-in'} for this <strong>${escapeHtml(which)}</strong>${when ? ` (${escapeHtml(when)})` : ''}.</p>
      <ul>
        <li>Be on time if you check in within <strong>${START_ON_TIME_MINUTES} minutes</strong>.</li>
        <li>After ${LATE_AFTER_MINUTES} minutes you are marked <strong>late</strong>.</li>
        <li>After ${ABSENT_AFTER_MINUTES} minutes this check is <strong>absent</strong>.</li>
        <li>Please respond within <strong>${RESPOND_TARGET_MINUTES} minutes</strong>.</li>
      </ul>
      <p><a href="${escapeHtml(checkUrl)}">Open My Attendance</a></p>
    `;

  const [emailResult, pushResult] = await Promise.all([
    user.email
      ? sendEmailSafe({
          emailType: 'remote_attendance_check',
          to: user.email,
          subject,
          html,
        })
      : Promise.resolve(null),
    user.id
      ? notifyApp(
          user.id,
          {
            title: isCheckout ? 'Attendance check-out' : 'Attendance check-in',
            body: isCheckout
              ? `Check out now${when ? ` (${when})` : ''}.`
              : `Check in now (${which}). On time within ${START_ON_TIME_MINUTES} min; late after ${LATE_AFTER_MINUTES}; absent after ${ABSENT_AFTER_MINUTES}.`,
            url: '/attendance',
            tag: `attendance-check-${challenge.id}`,
          },
          { ttl: 40 * 60, urgency: 'high' }
        )
      : Promise.resolve({ sent: 0 }),
  ]);

  return {
    ok: Boolean(emailResult) || Number(pushResult?.sent) > 0,
    email: emailResult,
    push: pushResult,
  };
}

module.exports = {
  getAdminEmails,
  getCeoEmails,
  notifyCeoIfBranchManagerWork,
  queueCeoBranchManagerNotice,
  notifyAdminsNewSignup,
  notifyDesignatedNewSignup,
  notifyUserSignup,
  notifyAccountApproved,
  notifyUsernameReminder,
  notifyPasswordReset,
  notifySalesPinOtp,
  notifyTPinOtp,
  notifyTlViewPinOtp,
  notifyEmployeeAdminUpdated,
  notifyAdminsEmployeeSelfUpdate,
  notifyUserLogin,
  notifyBirthday,
  notifyCeoBirthdayTomorrow,
  notifyCeoRemoteFaceAttendance,
  notifyAttendanceFailed,
  notifyRemoteAttendanceCheck,
  notifyApp,
  summarizeChanges,
  firstName,
  formatTimestamp,
};
