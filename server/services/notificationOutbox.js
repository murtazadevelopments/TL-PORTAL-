const pool = require('../config/db');
const { sendEmail } = require('./email');
const { logEmail } = require('./notificationSettings');
const { buildRemoteAttendanceNotice } = require('./notifications');
const { getFrom } = require('../lib/mailer');

const SEND_TIMEOUT_MS = 15000;
const CLAIM_LEASE_SECONDS = 120;
const BATCH_SIZE = 20;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 5;
const STALE_AFTER_MS = 15 * 60 * 1000;

function backoffMs(attemptAfterFailure) {
  if (attemptAfterFailure <= 1) return 30 * 1000;
  if (attemptAfterFailure === 2) return 2 * 60 * 1000;
  return 10 * 60 * 1000;
}

function challengeSnapshot(challenge) {
  return {
    kind: challenge.kind,
    seq: challenge.seq,
    scheduled_at: challenge.scheduled_at,
  };
}

async function enqueueAttendanceReminder(person, challenge, now = new Date(), options = {}) {
  const reset = options.reset === true;
  const channels = [];
  if (person?.email) channels.push('email');
  if (person?.id) channels.push('push');
  if (!channels.length) return { queued: false, channels: 0 };

  const payload = JSON.stringify(challengeSnapshot(challenge));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const channel of channels) {
      await client.query(
        `
          INSERT INTO notification_outbox (
            challenge_id, user_id, channel, payload, status, next_attempt_at
          )
          VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
          ON CONFLICT (challenge_id, channel) DO NOTHING
        `,
        [challenge.id, person.id, channel, payload, now]
      );
      if (reset) {
        await client.query(
          `
            UPDATE notification_outbox
            SET status = 'pending',
                attempts = 0,
                next_attempt_at = $3,
                last_error = NULL,
                sent_at = NULL,
                payload = $4::jsonb,
                user_id = $2
            WHERE challenge_id = $1
              AND channel = $5
              AND status <> 'pending'
          `,
          [challenge.id, person.id, now, payload, channel]
        );
      }
    }
    const updated = await client.query(
      `
        UPDATE attendance_challenges
        SET notified_at = $2, status = 'notified'
        WHERE id = $1
          AND notified_at IS NULL
          AND status = 'pending'
        RETURNING id
      `,
      [challenge.id, now]
    );
    await client.query('COMMIT');
    return { queued: Boolean(updated.rows[0]), channels: channels.length };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function ensureEmailRow(row) {
  const { rows: users } = await pool.query(
    `SELECT id, email FROM users WHERE id = $1 LIMIT 1`,
    [row.user_id]
  );
  if (!users[0]?.email) return;
  await pool.query(
    `
      INSERT INTO notification_outbox (
        challenge_id, user_id, channel, payload, status, next_attempt_at
      )
      VALUES ($1, $2, 'email', $3::jsonb, 'pending', NOW())
      ON CONFLICT (challenge_id, channel) DO NOTHING
    `,
    [row.challenge_id, row.user_id, JSON.stringify(row.payload || {})]
  );
}

function staleReason(challenge, now) {
  if (!challenge) return 'challenge missing';
  if (['missed', 'verified', 'late'].includes(challenge.status)) return `challenge ${challenge.status}`;
  const absentAt = challenge.absent_at ? new Date(challenge.absent_at) : null;
  if (absentAt && !Number.isNaN(absentAt.getTime()) && absentAt.getTime() <= now.getTime()) {
    return 'challenge expired';
  }
  const scheduledAt = challenge.scheduled_at ? new Date(challenge.scheduled_at) : null;
  if (
    scheduledAt &&
    !Number.isNaN(scheduledAt.getTime()) &&
    now.getTime() - scheduledAt.getTime() > STALE_AFTER_MS
  ) {
    return 'due more than 15 minutes ago';
  }
  return '';
}

async function loadDeliveryContext(row) {
  const { rows: challenges } = await pool.query(
    `
      SELECT id, user_id, kind, seq, scheduled_at, absent_at, status
      FROM attendance_challenges
      WHERE id = $1
      LIMIT 1
    `,
    [row.challenge_id]
  );
  const { rows: users } = await pool.query(
    `SELECT id, name, email FROM users WHERE id = $1 LIMIT 1`,
    [row.user_id]
  );
  return { challenge: challenges[0] || null, user: users[0] || null };
}

function pushGone(result) {
  const results = Array.isArray(result?.results) ? result.results : [];
  if (!results.length) return true;
  if (Number(result?.sent) > 0) return false;
  return results.every((item) => item.status === 404 || item.status === 410);
}

async function deliverRow(row) {
  const now = new Date();
  const { challenge, user } = await loadDeliveryContext(row);
  const reason = staleReason(challenge, now);
  if (reason) return { status: 'skipped', error: reason };
  if (!user) return { status: 'skipped', error: 'user missing' };

  const notice = buildRemoteAttendanceNotice(user, challenge || row.payload || {});
  if (row.channel === 'email') {
    if (!user.email) return { status: 'skipped', error: 'no email' };
    let data;
    try {
      data = await sendEmail({
        to: user.email,
        subject: notice.email.subject,
        html: notice.email.html,
        emailType: notice.email.emailType,
        timeoutMs: SEND_TIMEOUT_MS,
      });
    } catch (err) {
      await logEmail({
        emailType: notice.email.emailType,
        recipient: user.email,
        meta: {
          ok: false,
          error: err.message || String(err),
          subject: notice.email.subject,
          from: getFrom(),
        },
      });
      throw err;
    }
    console.log(
      `[email] OK type=${notice.email.emailType} to=${user.email} id=${data?.id || 'n/a'} from=${getFrom()} provider=${data?.provider || 'n/a'} status=${data?.status || 'n/a'}`
    );
    await logEmail({
      emailType: notice.email.emailType,
      recipient: user.email,
      meta: { ok: true, id: data?.id || null, subject: notice.email.subject, provider: data?.provider || null },
    });
    return { status: 'sent', error: '' };
  }

  if (row.channel === 'push') {
    const { notifyApp } = require('./notifications');
    const result = await notifyApp(user.id, notice.push, {
      ttl: notice.push.ttl,
      urgency: notice.push.urgency,
      timeoutMs: SEND_TIMEOUT_MS,
    });
    if (result?.error) throw new Error(result.error);
    if (Number(result?.sent) > 0) return { status: 'sent', error: '' };
    if (pushGone(result)) {
      await ensureEmailRow(row);
      const detail = result?.results?.length
        ? 'push subscription expired'
        : 'no push subscription';
      return { status: 'skipped', error: detail };
    }
    const detail =
      (result?.results || []).map((item) => item.error || item.status).filter(Boolean).join('; ') ||
      'push failed';
    throw new Error(detail);
  }

  return { status: 'skipped', error: `unknown channel ${row.channel}` };
}

async function claimBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        UPDATE notification_outbox
        SET next_attempt_at = NOW() + ($1::text || ' seconds')::interval
        WHERE id IN (
          SELECT id
          FROM notification_outbox
          WHERE status = 'pending'
            AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, challenge_id, user_id, channel, payload, status, attempts, next_attempt_at, last_error
      `,
      [String(CLAIM_LEASE_SECONDS), BATCH_SIZE]
    );
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function markSent(id) {
  await pool.query(
    `
      UPDATE notification_outbox
      SET status = 'sent', sent_at = NOW(), last_error = NULL
      WHERE id = $1 AND status = 'pending'
    `,
    [id]
  );
}

async function markSkipped(id, error) {
  await pool.query(
    `
      UPDATE notification_outbox
      SET status = 'skipped', last_error = $2
      WHERE id = $1 AND status = 'pending'
    `,
    [id, String(error || '').slice(0, 500)]
  );
}

async function markFailedAttempt(id, error) {
  const message = String(error || 'send failed').slice(0, 500);
  const { rows } = await pool.query(
    `
      UPDATE notification_outbox
      SET attempts = attempts + 1,
          last_error = $2,
          status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END,
          next_attempt_at = CASE
            WHEN attempts + 1 >= $3 THEN next_attempt_at
            WHEN attempts + 1 = 1 THEN NOW() + INTERVAL '30 seconds'
            WHEN attempts + 1 = 2 THEN NOW() + INTERVAL '2 minutes'
            ELSE NOW() + INTERVAL '10 minutes'
          END
      WHERE id = $1 AND status = 'pending'
      RETURNING attempts, status
    `,
    [id, message, MAX_ATTEMPTS]
  );
  return rows[0] || { attempts: 0, status: 'pending' };
}

function logOutbox(row, status, attempt, started, error) {
  console.log(
    `[outbox] id=${row.id} user=${row.user_id} channel=${row.channel} status=${status} attempt=${attempt} ms=${Date.now() - started} error=${error || ''}`
  );
}

async function processClaimed(row) {
  const started = Date.now();
  try {
    const outcome = await deliverRow(row);
    if (outcome.status === 'sent') {
      await markSent(row.id);
      logOutbox(row, 'sent', Number(row.attempts) + 1, started, '');
      return;
    }
    if (outcome.status === 'skipped') {
      await markSkipped(row.id, outcome.error);
      logOutbox(row, 'skipped', Number(row.attempts) + 1, started, outcome.error);
      return;
    }
    const saved = await markFailedAttempt(row.id, outcome.error || 'send failed');
    logOutbox(row, saved.status, saved.attempts, started, outcome.error);
  } catch (err) {
    const saved = await markFailedAttempt(row.id, err.message || err);
    logOutbox(row, saved.status, saved.attempts, started, err.message || err);
  }
}

async function runOutboxBatch() {
  const claimed = await claimBatch();
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const slice = claimed.slice(i, i + CONCURRENCY);
    await Promise.allSettled(slice.map((row) => processClaimed(row)));
  }
  return claimed.length;
}

async function listOutbox(status) {
  const params = [];
  let where = `status IN ('failed', 'pending')`;
  if (status && ['pending', 'sent', 'failed', 'skipped'].includes(status)) {
    params.push(status);
    where = `status = $1`;
  }
  const { rows } = await pool.query(
    `
      SELECT id, challenge_id, user_id, channel, status, attempts,
             next_attempt_at, last_error, sent_at, created_at
      FROM notification_outbox
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    params
  );
  return rows;
}

module.exports = {
  SEND_TIMEOUT_MS,
  backoffMs,
  enqueueAttendanceReminder,
  runOutboxBatch,
  listOutbox,
  staleReason,
};
