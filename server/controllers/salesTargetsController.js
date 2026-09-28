const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { isCeoRole } = require('../middleware/permissions');
const {
  normalizeScope,
  scopeWhereClause,
  employeeMatchesScope,
} = require('../utils/employeeScope');
const { ensureSalesTargetsSchema } = require('../utils/ensureSalesTargetsSchema');
const { ensureStaffKindColumn } = require('../utils/staffKind');
const { ensureBlockedColumn } = require('../utils/accountStatus');
const { employeeHasSalesAgentDashboard, isSalesRosterPerson, SALES_ROSTER_SQL } = require('../utils/salesTeams');
const { notifySalesPinOtp } = require('../services/notifications');

function currentPeriod(tz = process.env.APP_TIMEZONE || 'Asia/Karachi') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

function salesScope(req) {
  if (isCeoRole(req.user?.role)) return { type: 'all' };
  const scope = normalizeScope(req.user?.permissionScopes?.['sales:targets']);
  if (scope.type !== 'team' || !scope.values?.length) {
    return { type: 'team', values: [] };
  }
  return scope;
}

function parseMoney(raw) {
  if (raw == null || raw === '') return { missing: true };
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 1e12) {
    return { error: 'Enter a valid amount (0 or more).' };
  }
  return { value: Math.round(n * 100) / 100 };
}

function daysInPeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return 0;
  const [y, m] = String(period).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dailyTargetAmount(target, period) {
  const days = daysInPeriod(period);
  const n = Number(target);
  if (!days || !Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / days) * 100) / 100;
}

function splitEvenly(total, days) {
  const count = Math.max(0, Number(days) || 0);
  if (!count) return [];
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / count);
  let rem = cents - base * count;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    out.push((base + extra) / 100);
  }
  return out;
}

function karachiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = Number(parts.find((p) => p.type === 'day')?.value || 0);
  return { period: `${year}-${month}`, day };
}

function dayStatus({ target, achieved, period, day }) {
  const t = Number(target) || 0;
  const a = Number(achieved) || 0;
  if (t > 0 && a >= t) return 'completed';
  const today = karachiToday();
  if (period < today.period || (period === today.period && day < today.day)) return 'missed';
  if (period === today.period && day === today.day) return 'today';
  return 'upcoming';
}

function mapDay(row, period) {
  const target = row.target_amount == null ? 0 : Number(row.target_amount);
  const achieved = row.achieved_amount == null ? 0 : Number(row.achieved_amount);
  const day = Number(row.day_number);
  return {
    day,
    date: `${period}-${String(day).padStart(2, '0')}`,
    target_amount: target,
    achieved_amount: achieved,
    remaining: Math.max(0, Math.round((target - achieved) * 100) / 100),
    status: dayStatus({ target, achieved, period, day }),
  };
}

async function listDailyRows(userId, period) {
  const { rows } = await pool.query(
    `
      SELECT day_number, target_amount, achieved_amount
      FROM sales_agent_daily_targets
      WHERE user_id = $1 AND period = $2
      ORDER BY day_number ASC
    `,
    [userId, period]
  );
  return rows;
}

async function rebuildDailySplits(userId, period, monthlyTarget, updatedBy) {
  const days = daysInPeriod(period);
  if (!days || monthlyTarget == null || !(Number(monthlyTarget) > 0)) return;
  const prev = await listDailyRows(userId, period);
  const achievedByDay = new Map(prev.map((row) => [Number(row.day_number), Number(row.achieved_amount || 0)]));
  const splits = splitEvenly(monthlyTarget, days);
  await pool.query(`DELETE FROM sales_agent_daily_targets WHERE user_id = $1 AND period = $2`, [userId, period]);
  const values = [];
  const params = [];
  splits.forEach((amount, index) => {
    const day = index + 1;
    const offset = params.length;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
    params.push(userId, period, day, amount, achievedByDay.get(day) || 0, updatedBy);
  });
  await pool.query(
    `
      INSERT INTO sales_agent_daily_targets
        (user_id, period, day_number, target_amount, achieved_amount, updated_by)
      VALUES ${values.join(', ')}
    `,
    params
  );
}

async function ensureDailySplits(userId, period, monthlyTarget, updatedBy, monthlyAchieved) {
  const days = daysInPeriod(period);
  const existing = await listDailyRows(userId, period);
  if (existing.length === days) return existing;
  await rebuildDailySplits(userId, period, monthlyTarget, updatedBy);
  if (Number(monthlyAchieved) > 0) {
    await allocateDailyAchieved(userId, period, monthlyAchieved, updatedBy);
  }
  return listDailyRows(userId, period);
}

async function allocateDailyAchieved(userId, period, achieved, updatedBy) {
  const rows = await listDailyRows(userId, period);
  if (!rows.length) return;
  let left = Math.round(Number(achieved || 0) * 100);
  for (let i = 0; i < rows.length; i += 1) {
    const cap = Math.round(Number(rows[i].target_amount || 0) * 100);
    let take = Math.min(Math.max(0, left), cap);
    left -= take;
    if (i === rows.length - 1 && left > 0) {
      take += left;
      left = 0;
    }
    await pool.query(
      `
        UPDATE sales_agent_daily_targets
        SET achieved_amount = $4, updated_by = $5, updated_at = NOW()
        WHERE user_id = $1 AND period = $2 AND day_number = $3
      `,
      [userId, period, rows[i].day_number, take / 100, updatedBy]
    );
  }
}

async function syncMonthlyFromDaily(userId, period, updatedBy) {
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(target_amount), 0) AS target_amount,
        COALESCE(SUM(achieved_amount), 0) AS achieved_amount
      FROM sales_agent_daily_targets
      WHERE user_id = $1 AND period = $2
    `,
    [userId, period]
  );
  const target = Number(rows[0]?.target_amount || 0);
  const achieved = Number(rows[0]?.achieved_amount || 0);
  await pool.query(
    `
      INSERT INTO sales_agent_targets (user_id, period, target_amount, achieved_amount, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id, period)
      DO UPDATE SET
        target_amount = EXCLUDED.target_amount,
        achieved_amount = EXCLUDED.achieved_amount,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `,
    [userId, period, target, achieved, updatedBy]
  );
}

function mapAgent(row) {
  const target = row.target_amount == null ? null : Number(row.target_amount);
  const achieved = row.achieved_amount == null ? 0 : Number(row.achieved_amount);
  const period = row.period || null;
  const days = daysInPeriod(period);
  const pct = target && target > 0 ? Math.round((achieved / target) * 1000) / 10 : 0;
  let status = 'not_set';
  if (target && target > 0) {
    status = achieved >= target ? 'completed' : 'in_progress';
  }
  return {
    id: row.id,
    employee_id: row.employee_id,
    name: row.name,
    department: row.department,
    designation: row.designation,
    target_amount: target,
    daily_target: dailyTargetAmount(target, period),
    period_days: days || null,
    achieved_amount: achieved,
    percent: pct,
    remaining: target == null ? null : Math.max(0, Math.round((target - achieved) * 100) / 100),
    status,
    target_updated_at: row.target_updated_at || row.updated_at || null,
    period,
    created_at: row.created_at || null,
    account_status: row.status || null,
  };
}

function summarize(agents) {
  const withTarget = agents.filter((a) => a.target_amount != null && a.target_amount > 0);
  const targetTotal = withTarget.reduce((s, a) => s + a.target_amount, 0);
  const achievedTotal = withTarget.reduce((s, a) => s + a.achieved_amount, 0);
  const completed = withTarget.filter((a) => a.status === 'completed').length;
  return {
    agent_count: agents.length,
    assigned_count: withTarget.length,
    completed_count: completed,
    target_total: targetTotal,
    achieved_total: achievedTotal,
    remaining_total: Math.max(0, Math.round((targetTotal - achievedTotal) * 100) / 100),
    percent:
      targetTotal > 0 ? Math.round((achievedTotal / targetTotal) * 1000) / 10 : 0,
  };
}

async function setSalesPin(req, res) {
  try {
    await ensureSalesTargetsSchema();
    const newPin = String(req.body?.sales_pin ?? req.body?.new_sales_pin ?? '').trim();
    if (!/^\d{4,8}$/.test(newPin)) {
      return res.status(400).json({ message: 'Sales PIN must be 4–8 digits.' });
    }

    const { rows } = await pool.query(
      'SELECT password, sales_pin_hash, sales_pin_change_until FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const otpWindow =
      user.sales_pin_change_until && new Date(user.sales_pin_change_until).getTime() > Date.now();

    if (otpWindow) {
      /* verified email OTP — allowed to set a new PIN */
    } else if (user.sales_pin_hash) {
      const current = String(req.body?.current_sales_pin ?? '').trim();
      if (!current || !(await bcrypt.compare(current, user.sales_pin_hash))) {
        return res.status(403).json({
          message: 'Current sales PIN is incorrect.',
          code: 'SALES_PIN_INVALID',
        });
      }
    } else {
      const password = String(req.body?.current_password ?? '').trim();
      if (!password || !(await bcrypt.compare(password, user.password))) {
        return res.status(403).json({
          message: 'Account password is required to create your sales PIN.',
          code: 'SALES_PIN_PASSWORD_REQUIRED',
        });
      }
    }

    const hash = await bcrypt.hash(newPin, 10);
    await pool.query(
      `
        UPDATE users
        SET sales_pin_hash = $1,
            sales_pin_otp_hash = NULL,
            sales_pin_otp_expires_at = NULL,
            sales_pin_change_until = NULL,
            updated_at = NOW()
        WHERE id = $2
      `,
      [hash, req.user.id]
    );

    return res.json({ message: 'Sales PIN saved.', salesPinConfigured: true });
  } catch (err) {
    console.error('setSalesPin error:', err);
    return res.status(500).json({ message: 'Server error saving sales PIN.' });
  }
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return 'your email';
  const shown = name.length <= 2 ? `${name.slice(0, 1)}*` : `${name[0]}***${name[name.length - 1]}`;
  return `${shown}@${domain}`;
}

async function requestSalesPinOtp(req, res) {
  try {
    await ensureSalesTargetsSchema();
    const { rows } = await pool.query(
      `
        SELECT id, name, email, sales_pin_otp_expires_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const email = String(user.email || '').trim();
    if (!email) {
      return res.status(400).json({ message: 'Add an email on your profile before resetting the sales PIN.' });
    }

    if (
      user.sales_pin_otp_expires_at &&
      new Date(user.sales_pin_otp_expires_at).getTime() > Date.now() + 9 * 60 * 1000
    ) {
      return res.status(429).json({
        message: 'A code was already sent. Wait a minute before requesting another.',
        email_hint: maskEmail(email),
      });
    }

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `
        UPDATE users
        SET sales_pin_otp_hash = $1,
            sales_pin_otp_expires_at = $2,
            sales_pin_change_until = NULL,
            updated_at = NOW()
        WHERE id = $3
      `,
      [otpHash, expiresAt, user.id]
    );

    const sent = await notifySalesPinOtp(user, otp);
    if (!sent) {
      return res.status(500).json({ message: 'Could not send the code. Try again in a minute.' });
    }

    return res.json({
      message: 'We sent a 6-digit code to your email. It expires in 10 minutes.',
      email_hint: maskEmail(email),
      expires_in: 600,
    });
  } catch (err) {
    console.error('requestSalesPinOtp error:', err);
    return res.status(500).json({ message: 'Server error sending PIN reset code.' });
  }
}

async function verifySalesPinOtp(req, res) {
  try {
    await ensureSalesTargetsSchema();
    const otp = String(req.body?.otp || req.body?.code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit code from your email.' });
    }

    const { rows } = await pool.query(
      `
        SELECT sales_pin_otp_hash, sales_pin_otp_expires_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const user = rows[0];
    if (
      !user?.sales_pin_otp_hash ||
      !user.sales_pin_otp_expires_at ||
      new Date(user.sales_pin_otp_expires_at).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: 'That code is invalid or expired. Request a new one.',
        code: 'SALES_PIN_OTP_INVALID',
      });
    }

    const ok = await bcrypt.compare(otp, user.sales_pin_otp_hash);
    if (!ok) {
      return res.status(400).json({
        message: 'That code is invalid or expired. Request a new one.',
        code: 'SALES_PIN_OTP_INVALID',
      });
    }

    const changeUntil = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `
        UPDATE users
        SET sales_pin_otp_hash = NULL,
            sales_pin_otp_expires_at = NULL,
            sales_pin_change_until = $1,
            updated_at = NOW()
        WHERE id = $2
      `,
      [changeUntil, req.user.id]
    );

    return res.json({
      message: 'Code confirmed. Set a new sales PIN now.',
      change_until: changeUntil.toISOString(),
    });
  } catch (err) {
    console.error('verifySalesPinOtp error:', err);
    return res.status(500).json({ message: 'Server error verifying the code.' });
  }
}

async function listSalesTargets(req, res) {
  try {
    await ensureSalesTargetsSchema();
    await ensureStaffKindColumn();
    await ensureBlockedColumn();
    const periodRaw = String(req.query.period || '').trim();
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : currentPeriod();
    const scope = salesScope(req);
    const scoped = scopeWhereClause(scope, 2);

    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.employee_id,
          u.name,
          u.department,
          u.designation,
          t.target_amount,
          t.achieved_amount,
          t.updated_at AS target_updated_at,
          u.created_at,
          u.status
        FROM users u
        LEFT JOIN sales_agent_targets t
          ON t.user_id = u.id AND t.period = $1
        WHERE u.is_active = true
          AND u.blocked_at IS NULL
          AND LOWER(TRIM(COALESCE(u.role, ''))) <> 'ceo'
          AND COALESCE(u.staff_kind, 'portal') <> 'lower'
          ${SALES_ROSTER_SQL}
          ${scoped.sql}
        ORDER BY COALESCE(NULLIF(TRIM(u.department), ''), '—') ASC,
                 u.created_at DESC NULLS LAST,
                 COALESCE(NULLIF(TRIM(u.name), ''), u.employee_id) ASC
      `,
      [period, ...scoped.params]
    );

    const agents = rows.map((row) => mapAgent({ ...row, period }));
    return res.json({
      period,
      scope,
      summary: summarize(agents),
      agents,
    });
  } catch (err) {
    console.error('listSalesTargets error:', err);
    return res.status(500).json({ message: 'Server error loading sales targets.' });
  }
}

async function upsertSalesTarget(req, res) {
  try {
    await ensureSalesTargetsSchema();
    await ensureStaffKindColumn();
    await ensureBlockedColumn();

    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ message: 'Invalid agent.' });
    }

    const periodRaw = String(req.body?.period || '').trim();
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : currentPeriod();
    const hasTarget = Object.prototype.hasOwnProperty.call(req.body || {}, 'target_amount');
    const hasAchieved = Object.prototype.hasOwnProperty.call(req.body || {}, 'achieved_amount');
    if (!hasTarget && !hasAchieved) {
      return res.status(400).json({ message: 'Provide a target or an achieved amount.' });
    }

    let nextTarget;
    let nextAchieved;
    if (hasTarget) {
      const parsed = parseMoney(req.body.target_amount);
      if (parsed.error || parsed.missing) {
        return res.status(400).json({ message: parsed.error || 'Enter a target amount.' });
      }
      if (parsed.value <= 0) {
        return res.status(400).json({ message: 'Target must be greater than 0.' });
      }
      nextTarget = parsed.value;
    }
    if (hasAchieved) {
      const parsed = parseMoney(req.body.achieved_amount);
      if (parsed.error || parsed.missing) {
        return res.status(400).json({ message: parsed.error || 'Enter the achieved amount.' });
      }
      nextAchieved = parsed.value;
    }

    const { rows: people } = await pool.query(
      `
        SELECT id, employee_id, name, department, designation, role, is_active, blocked_at, staff_kind
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    const person = people[0];
    if (!person || person.is_active === false || person.blocked_at) {
      return res.status(404).json({ message: 'Agent not found in your assigned teams.' });
    }
    if (String(person.role || '').trim().toLowerCase() === 'ceo') {
      return res.status(400).json({ message: 'Cannot assign a sales target to the CEO.' });
    }
    if (String(person.staff_kind || 'portal') === 'lower') {
      return res.status(400).json({ message: 'This staff record is not a sales agent.' });
    }
    if (!isSalesRosterPerson(person)) {
      return res.status(400).json({
        message: 'Targets are only for sales executives and team leaders.',
      });
    }
    if (!employeeMatchesScope(person, salesScope(req))) {
      return res.status(403).json({ message: 'This agent is outside your assigned teams.' });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT target_amount, achieved_amount FROM sales_agent_targets WHERE user_id = $1 AND period = $2 LIMIT 1`,
      [userId, period]
    );
    const existing = existingRows[0];
    const currentTarget =
      existing?.target_amount == null ? null : Number(existing.target_amount);

    if (hasAchieved && (nextTarget ?? currentTarget) == null) {
      return res.status(400).json({
        message: 'Assign a target for this agent before logging achieved sales.',
      });
    }

    const targetToStore = nextTarget ?? currentTarget;
    const achievedToStore = nextAchieved ?? Number(existing?.achieved_amount || 0);

    const { rows: saved } = await pool.query(
      `
        INSERT INTO sales_agent_targets (user_id, period, target_amount, achieved_amount, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id, period)
        DO UPDATE SET
          target_amount = EXCLUDED.target_amount,
          achieved_amount = EXCLUDED.achieved_amount,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING target_amount, achieved_amount, updated_at, period
      `,
      [userId, period, targetToStore, achievedToStore, req.user.id]
    );

    if (hasTarget) {
      await rebuildDailySplits(userId, period, targetToStore, req.user.id);
    } else {
      await ensureDailySplits(userId, period, targetToStore, req.user.id, achievedToStore);
    }
    if (hasAchieved) {
      await allocateDailyAchieved(userId, period, achievedToStore, req.user.id);
    }

    return res.json({
      message: hasAchieved && !hasTarget ? 'Achieved amount saved.' : 'Target saved.',
      period,
      agent: mapAgent({
        ...person,
        ...saved[0],
        target_updated_at: saved[0].updated_at,
      }),
    });
  } catch (err) {
    console.error('upsertSalesTarget error:', err);
    return res.status(500).json({ message: 'Server error saving sales target.' });
  }
}

async function resetSalesTarget(req, res) {
  try {
    await ensureSalesTargetsSchema();
    await ensureStaffKindColumn();
    await ensureBlockedColumn();

    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ message: 'Invalid agent.' });
    }

    const periodRaw = String(req.query.period || req.body?.period || '').trim();
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : currentPeriod();

    const { rows: people } = await pool.query(
      `
        SELECT id, employee_id, name, department, designation, role, is_active, blocked_at, staff_kind, created_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    const person = people[0];
    if (!person || person.is_active === false || person.blocked_at) {
      return res.status(404).json({ message: 'Agent not found in your assigned teams.' });
    }
    if (String(person.role || '').trim().toLowerCase() === 'ceo') {
      return res.status(400).json({ message: 'Cannot reset a sales target for the CEO.' });
    }
    if (!isSalesRosterPerson(person) || String(person.staff_kind || 'portal') === 'lower') {
      return res.status(400).json({ message: 'This staff record is not a sales agent.' });
    }
    if (!employeeMatchesScope(person, salesScope(req))) {
      return res.status(403).json({ message: 'This agent is outside your assigned teams.' });
    }

    await pool.query(
      `DELETE FROM sales_agent_daily_targets WHERE user_id = $1 AND period = $2`,
      [userId, period]
    );
    await pool.query(
      `DELETE FROM sales_agent_targets WHERE user_id = $1 AND period = $2`,
      [userId, period]
    );

    return res.json({
      message: 'Target reset.',
      period,
      agent: mapAgent({
        ...person,
        target_amount: null,
        achieved_amount: 0,
        period,
        target_updated_at: null,
      }),
    });
  } catch (err) {
    console.error('resetSalesTarget error:', err);
    return res.status(500).json({ message: 'Server error resetting sales target.' });
  }
}

async function getMySalesTarget(req, res) {
  try {
    await ensureSalesTargetsSchema();
    const { rows: meRows } = await pool.query(
      `SELECT id, username, employee_id, name, department, designation, role FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const me = meRows[0];
    if (!me) return res.status(404).json({ message: 'Account not found.' });
    const allowed = await employeeHasSalesAgentDashboard(me);
    if (!allowed) {
      return res.status(403).json({
        message: 'Sales targets are only for sales executives and team leaders on assigned teams.',
        code: 'SALES_TARGET_NOT_ASSIGNED',
      });
    }

    const period = currentPeriod();
    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.employee_id,
          u.name,
          u.department,
          u.designation,
          t.period,
          t.target_amount,
          t.achieved_amount,
          t.updated_at AS target_updated_at
        FROM users u
        LEFT JOIN sales_agent_targets t ON t.user_id = u.id
        WHERE u.id = $1
        ORDER BY t.period DESC NULLS LAST
        LIMIT 12
      `,
      [req.user.id]
    );

    const history = rows.filter((row) => row.period).map(mapAgent);
    const current = history.find((row) => row.period === period) || {
      ...mapAgent({ ...me, target_amount: null, achieved_amount: 0, period }),
      period,
    };

    return res.json({ period, current, history });
  } catch (err) {
    console.error('getMySalesTarget error:', err);
    return res.status(500).json({ message: 'Server error loading your sales target.' });
  }
}

async function loadSupervisedAgent(req, userId) {
  if (!Number.isInteger(userId) || userId < 1) {
    return { status: 400, message: 'Invalid agent.' };
  }
  const { rows: people } = await pool.query(
    `
      SELECT id, employee_id, name, department, designation, role, is_active, blocked_at, staff_kind
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  const person = people[0];
  if (!person || person.is_active === false || person.blocked_at) {
    return { status: 404, message: 'Agent not found in your assigned teams.' };
  }
  if (String(person.role || '').trim().toLowerCase() === 'ceo') {
    return { status: 400, message: 'Cannot assign a sales target to the CEO.' };
  }
  if (!isSalesRosterPerson(person) || String(person.staff_kind || 'portal') === 'lower') {
    return { status: 400, message: 'This staff record is not a sales agent.' };
  }
  if (!employeeMatchesScope(person, salesScope(req))) {
    return { status: 403, message: 'This agent is outside your assigned teams.' };
  }
  return { person };
}

async function monthlyRow(userId, period) {
  const { rows } = await pool.query(
    `SELECT target_amount, achieved_amount, updated_at, period FROM sales_agent_targets WHERE user_id = $1 AND period = $2 LIMIT 1`,
    [userId, period]
  );
  return rows[0] || null;
}

async function getAgentDailyTargets(req, res) {
  try {
    await ensureSalesTargetsSchema();
    await ensureStaffKindColumn();
    await ensureBlockedColumn();
    const userId = Number(req.params.userId);
    const loaded = await loadSupervisedAgent(req, userId);
    if (loaded.status) return res.status(loaded.status).json({ message: loaded.message });
    const periodRaw = String(req.query.period || '').trim();
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : currentPeriod();
    const monthly = await monthlyRow(userId, period);
    const monthlyTarget = monthly?.target_amount == null ? null : Number(monthly.target_amount);
    if (!(monthlyTarget > 0)) {
      return res.status(400).json({ message: 'Assign a monthly target before opening daily targets.' });
    }
    const rows = await ensureDailySplits(
      userId,
      period,
      monthlyTarget,
      req.user.id,
      monthly?.achieved_amount
    );
    return res.json({
      period,
      period_days: daysInPeriod(period),
      agent: mapAgent({ ...loaded.person, ...monthly, period, target_updated_at: monthly?.updated_at }),
      days: rows.map((row) => mapDay(row, period)),
    });
  } catch (err) {
    console.error('getAgentDailyTargets error:', err);
    return res.status(500).json({ message: 'Server error loading daily targets.' });
  }
}

async function upsertAgentDailyTargets(req, res) {
  try {
    await ensureSalesTargetsSchema();
    await ensureStaffKindColumn();
    await ensureBlockedColumn();
    const userId = Number(req.params.userId);
    const loaded = await loadSupervisedAgent(req, userId);
    if (loaded.status) return res.status(loaded.status).json({ message: loaded.message });
    const periodRaw = String(req.body?.period || req.query.period || '').trim();
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : currentPeriod();
    const daysCount = daysInPeriod(period);
    const monthly = await monthlyRow(userId, period);
    const monthlyTarget = monthly?.target_amount == null ? null : Number(monthly.target_amount);
    if (!(monthlyTarget > 0)) {
      return res.status(400).json({ message: 'Assign a monthly target before editing daily targets.' });
    }
    await ensureDailySplits(userId, period, monthlyTarget, req.user.id, monthly?.achieved_amount);

    const incoming = Array.isArray(req.body?.days) ? req.body.days : null;
    if (!incoming || !incoming.length) {
      return res.status(400).json({ message: 'Provide daily target rows to save.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of incoming) {
        const day = Number(item?.day ?? item?.day_number);
        if (!Number.isInteger(day) || day < 1 || day > daysCount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Invalid day ${item?.day}.` });
        }
        let targetAmount;
        let achievedAmount;
        if (Object.prototype.hasOwnProperty.call(item, 'target_amount')) {
          const parsed = parseMoney(item.target_amount);
          if (parsed.error || parsed.missing) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: parsed.error || 'Enter a daily target.' });
          }
          targetAmount = parsed.value;
        }
        if (Object.prototype.hasOwnProperty.call(item, 'achieved_amount')) {
          const parsed = parseMoney(item.achieved_amount);
          if (parsed.error || parsed.missing) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: parsed.error || 'Enter daily achieved.' });
          }
          achievedAmount = parsed.value;
        }
        if (targetAmount == null && achievedAmount == null) continue;
        const sets = [];
        const params = [userId, period, day];
        if (targetAmount != null) {
          params.push(targetAmount);
          sets.push(`target_amount = $${params.length}`);
        }
        if (achievedAmount != null) {
          params.push(achievedAmount);
          sets.push(`achieved_amount = $${params.length}`);
        }
        params.push(req.user.id);
        sets.push(`updated_by = $${params.length}`, 'updated_at = NOW()');
        await client.query(
          `
            UPDATE sales_agent_daily_targets
            SET ${sets.join(', ')}
            WHERE user_id = $1 AND period = $2 AND day_number = $3
          `,
          params
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await syncMonthlyFromDaily(userId, period, req.user.id);
    const savedMonthly = await monthlyRow(userId, period);
    const rows = await listDailyRows(userId, period);
    return res.json({
      message: 'Daily targets saved.',
      period,
      agent: mapAgent({
        ...loaded.person,
        ...savedMonthly,
        period,
        target_updated_at: savedMonthly?.updated_at,
      }),
      days: rows.map((row) => mapDay(row, period)),
    });
  } catch (err) {
    console.error('upsertAgentDailyTargets error:', err);
    return res.status(500).json({ message: 'Server error saving daily targets.' });
  }
}

async function getMyDailyTargets(req, res) {
  try {
    await ensureSalesTargetsSchema();
    const { rows: meRows } = await pool.query(
      `SELECT id, username, employee_id, name, department, designation, role FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const me = meRows[0];
    if (!me) return res.status(404).json({ message: 'Account not found.' });
    const allowed = await employeeHasSalesAgentDashboard(me);
    if (!allowed) {
      return res.status(403).json({
        message: 'Sales targets are only for sales executives and team leaders on assigned teams.',
        code: 'SALES_TARGET_NOT_ASSIGNED',
      });
    }
    const periodRaw = String(req.query.period || '').trim();
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : currentPeriod();
    const monthly = await monthlyRow(me.id, period);
    const monthlyTarget = monthly?.target_amount == null ? null : Number(monthly.target_amount);
    if (!(monthlyTarget > 0)) {
      return res.json({
        period,
        period_days: daysInPeriod(period),
        agent: mapAgent({ ...me, target_amount: null, achieved_amount: 0, period }),
        days: [],
      });
    }
    const rows = await ensureDailySplits(me.id, period, monthlyTarget, me.id, monthly?.achieved_amount);
    return res.json({
      period,
      period_days: daysInPeriod(period),
      agent: mapAgent({ ...me, ...monthly, period, target_updated_at: monthly?.updated_at }),
      days: rows.map((row) => mapDay(row, period)),
    });
  } catch (err) {
    console.error('getMyDailyTargets error:', err);
    return res.status(500).json({ message: 'Server error loading your daily targets.' });
  }
}

module.exports = {
  setSalesPin,
  requestSalesPinOtp,
  verifySalesPinOtp,
  listSalesTargets,
  upsertSalesTarget,
  resetSalesTarget,
  getMySalesTarget,
  getAgentDailyTargets,
  upsertAgentDailyTargets,
  getMyDailyTargets,
  currentPeriod,
};
