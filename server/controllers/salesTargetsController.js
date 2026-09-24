const bcrypt = require('bcryptjs');
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

function mapAgent(row) {
  const target = row.target_amount == null ? null : Number(row.target_amount);
  const achieved = row.achieved_amount == null ? 0 : Number(row.achieved_amount);
  const pct = target && target > 0 ? Math.min(999, Math.round((achieved / target) * 1000) / 10) : 0;
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
    achieved_amount: achieved,
    percent: pct,
    remaining: target == null ? null : Math.max(0, Math.round((target - achieved) * 100) / 100),
    status,
    target_updated_at: row.target_updated_at || row.updated_at || null,
    period: row.period || null,
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
      targetTotal > 0 ? Math.min(999, Math.round((achievedTotal / targetTotal) * 1000) / 10) : 0,
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
      'SELECT password, sales_pin_hash FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (user.sales_pin_hash) {
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
      'UPDATE users SET sales_pin_hash = $1, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]
    );

    return res.json({ message: 'Sales PIN saved.', salesPinConfigured: true });
  } catch (err) {
    console.error('setSalesPin error:', err);
    return res.status(500).json({ message: 'Server error saving sales PIN.' });
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

    const agents = rows.map(mapAgent);
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

async function getMySalesTarget(req, res) {
  try {
    await ensureSalesTargetsSchema();
    const { rows: meRows } = await pool.query(
      `SELECT id, employee_id, name, department, designation, role FROM users WHERE id = $1 LIMIT 1`,
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

module.exports = {
  setSalesPin,
  listSalesTargets,
  upsertSalesTarget,
  getMySalesTarget,
  currentPeriod,
};
