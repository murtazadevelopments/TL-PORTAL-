const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { notifyTPinOtp, notifyTlViewPinOtp } = require('../services/notifications');
const {
  isCeoOrManagerRole,
  isTeamLeaderRole,
  hasTeamLeaderDashboardAccess,
  canViewAllTlCategories,
} = require('../utils/tlAccess');

const SECTIONS = new Set(['all', 'merchant']);
const ITEM_TYPES = new Set(['link', 'text', 'bank']);

let tPinOtpColumnsReady = false;
async function ensureTPinOtpSchema() {
  if (tPinOtpColumnsReady) return;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS t_pin_otp_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS t_pin_otp_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS t_pin_change_until TIMESTAMPTZ`);
  tPinOtpColumnsReady = true;
}

let viewPinColumnsReady = false;
async function ensureTlViewPinSchema() {
  if (viewPinColumnsReady) return;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_otp_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_otp_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_change_until TIMESTAMPTZ`);
  viewPinColumnsReady = true;
}

let itemUsernameReady = false;
async function ensureTlItemUsernameSchema() {
  if (itemUsernameReady) return;
  await pool.query(`ALTER TABLE tl_category_items ADD COLUMN IF NOT EXISTS username TEXT`);
  itemUsernameReady = true;
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return 'your email';
  const shown = name.length <= 2 ? `${name.slice(0, 1)}*` : `${name[0]}***${name[name.length - 1]}`;
  return `${shown}@${domain}`;
}

function normalizeSection(value) {
  const s = String(value || '')
    .trim()
    .toLowerCase();
  return SECTIONS.has(s) ? s : null;
}

async function loadUserAccessFlags(userId) {
  const { ensureDesignationsSchema } = require('../utils/designationsSchema');
  await ensureDesignationsSchema();
  await ensureTlViewPinSchema();
  const { rows } = await pool.query(
    `
      SELECT role, designation,
             t_pin_hash IS NOT NULL AS t_pin_configured,
             tl_view_pin_hash IS NOT NULL AS view_pin_configured
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function userHasAssignment(userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM tl_category_assignments WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return Boolean(rows[0]);
}

/**
 * GET /api/tl-dashboard/access
 */
async function getAccess(req, res) {
  try {
    const row = await loadUserAccessFlags(req.user.id);
    if (!row) {
      return res.status(404).json({ message: 'User not found.' });
    }

    req.user.role = row.role;
    const assigned = await userHasAssignment(req.user.id);
    const access = hasTeamLeaderDashboardAccess({
      role: row.role,
      designation: row.designation,
      assigned,
    });

    const canManage = isCeoOrManagerRole(row.role);
    return res.json({
      access,
      role: row.role,
      canManage,
      isTeamLeader: isTeamLeaderRole(row.role) || canViewAllTlCategories(row),
      tPinConfigured: Boolean(row.t_pin_configured) && canManage,
      requiresViewPin: Boolean(access),
      viewPinConfigured: Boolean(row.view_pin_configured) && Boolean(access),
    });
  } catch (err) {
    console.error('tl getAccess error:', err);
    return res.status(500).json({ message: 'Server error checking access.' });
  }
}

/**
 * GET /api/tl-dashboard?section=all|merchant
 */
async function listCategories(req, res) {
  try {
    await ensureTlItemUsernameSchema();
    const section = normalizeSection(req.query.section);
    if (!section) {
      return res.status(400).json({ message: 'section must be "all" or "merchant".' });
    }

    const row = await loadUserAccessFlags(req.user.id);
    if (!row) {
      return res.status(404).json({ message: 'User not found.' });
    }
    req.user.role = row.role;

    const canManage = isCeoOrManagerRole(row.role);
    const viewAll = canViewAllTlCategories(row);
    const assigned = viewAll ? true : await userHasAssignment(req.user.id);

    if (!hasTeamLeaderDashboardAccess({
      role: row.role,
      designation: row.designation,
      assigned,
    })) {
      return res.status(403).json({ message: 'You are not assigned to this dashboard.' });
    }

    let catRows;
    if (viewAll) {
      const result = await pool.query(
        `
          SELECT c.id, c.section, c.name, c.sort_order, c.created_at, c.updated_at
          FROM tl_categories c
          WHERE c.section = $1
          ORDER BY c.sort_order ASC, c.id ASC
        `,
        [section]
      );
      catRows = result.rows;
    } else {
      const result = await pool.query(
        `
          SELECT c.id, c.section, c.name, c.sort_order, c.created_at, c.updated_at
          FROM tl_categories c
          INNER JOIN tl_category_assignments a ON a.category_id = c.id
          WHERE c.section = $1 AND a.user_id = $2
          ORDER BY c.sort_order ASC, c.id ASC
        `,
        [section, req.user.id]
      );
      catRows = result.rows;
    }

    if (!catRows.length) {
      return res.json({ section, canManage, categories: [] });
    }

    const ids = catRows.map((c) => c.id);
    const { rows: itemRows } = await pool.query(
      `
        SELECT id, category_id, label, value, username, item_type, sort_order, created_at, updated_at
        FROM tl_category_items
        WHERE category_id = ANY($1::bigint[])
        ORDER BY sort_order ASC, id ASC
      `,
      [ids]
    );

    let assignmentMap = {};
    if (canManage) {
      const { rows: asg } = await pool.query(
        `
          SELECT a.category_id, a.user_id, u.name, u.username, u.email, u.role
          FROM tl_category_assignments a
          INNER JOIN users u ON u.id = a.user_id
          WHERE a.category_id = ANY($1::bigint[])
            AND u.is_active IS DISTINCT FROM FALSE
          ORDER BY u.name ASC NULLS LAST, u.username ASC
        `,
        [ids]
      );
      assignmentMap = asg.reduce((acc, row) => {
        if (!acc[row.category_id]) acc[row.category_id] = [];
        acc[row.category_id].push({
          id: row.user_id,
          name: row.name,
          username: row.username,
          email: row.email,
          role: row.role,
        });
        return acc;
      }, {});
    }

    const itemsByCat = itemRows.reduce((acc, row) => {
      if (!acc[row.category_id]) acc[row.category_id] = [];
      acc[row.category_id].push({
        id: row.id,
        label: row.label,
        value: row.value,
        username: row.username || '',
        item_type: row.item_type,
        sort_order: row.sort_order,
      });
      return acc;
    }, {});

    const categories = catRows.map((c) => ({
      id: c.id,
      section: c.section,
      name: c.name,
      sort_order: c.sort_order,
      items: itemsByCat[c.id] || [],
      assignees: canManage ? assignmentMap[c.id] || [] : undefined,
    }));

    return res.json({ section, canManage, categories });
  } catch (err) {
    console.error('tl listCategories error:', err);
    return res.status(500).json({ message: 'Server error loading dashboard.' });
  }
}

/**
 * GET /api/tl-dashboard/assignable-users
 */
async function listAssignableUsers(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, name, username, email, role, department
        FROM users
        WHERE is_active IS DISTINCT FROM FALSE
          AND LOWER(TRIM(role)) <> 'ceo'
          AND LOWER(TRIM(role)) <> 'manager'
          AND LOWER(TRIM(COALESCE(status, ''))) = 'active'
        ORDER BY name ASC NULLS LAST, username ASC
      `
    );
    return res.json(rows);
  } catch (err) {
    console.error('tl listAssignableUsers error:', err);
    return res.status(500).json({ message: 'Server error loading users.' });
  }
}

/**
 * POST /api/tl-dashboard/t-pin  { t_pin, current_password? , current_t_pin? }
 * First set: require account password. Change: require current T-Pin or a verified email OTP.
 */
async function setTPin(req, res) {
  try {
    await ensureTPinOtpSchema();
    const newPin = String(req.body?.t_pin ?? req.body?.new_t_pin ?? '').trim();
    if (!/^\d{4,8}$/.test(newPin)) {
      return res.status(400).json({ message: 'T-Pin must be 4–8 digits.' });
    }

    const { rows } = await pool.query(
      `
        SELECT password, t_pin_hash, t_pin_change_until
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const otpWindow =
      user.t_pin_change_until && new Date(user.t_pin_change_until).getTime() > Date.now();

    if (otpWindow) {
      /* verified email OTP — allowed to set a new T-Pin */
    } else if (user.t_pin_hash) {
      const current = String(req.body?.current_t_pin ?? '').trim();
      if (!current || !(await bcrypt.compare(current, user.t_pin_hash))) {
        return res.status(403).json({
          message: 'Current T-Pin is incorrect.',
          code: 'TPIN_INVALID',
        });
      }
    } else {
      const password = String(req.body?.current_password ?? '').trim();
      if (!password || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({
          message: 'Account password is required to create your T-Pin.',
        });
      }
    }

    const hash = await bcrypt.hash(newPin, 10);
    await pool.query(
      `
        UPDATE users
        SET t_pin_hash = $1,
            t_pin_otp_hash = NULL,
            t_pin_otp_expires_at = NULL,
            t_pin_change_until = NULL,
            updated_at = NOW()
        WHERE id = $2
      `,
      [hash, req.user.id]
    );

    return res.json({ message: 'T-Pin saved.', tPinConfigured: true });
  } catch (err) {
    console.error('tl setTPin error:', err);
    return res.status(500).json({ message: 'Server error saving T-Pin.' });
  }
}

async function requestTPinOtp(req, res) {
  try {
    await ensureTPinOtpSchema();
    const { rows } = await pool.query(
      `
        SELECT id, name, email, t_pin_otp_expires_at
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
      return res.status(400).json({
        message: 'Add an email on your profile before resetting the T-Pin.',
      });
    }

    if (
      user.t_pin_otp_expires_at &&
      new Date(user.t_pin_otp_expires_at).getTime() > Date.now() + 9 * 60 * 1000
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
        SET t_pin_otp_hash = $1,
            t_pin_otp_expires_at = $2,
            t_pin_change_until = NULL,
            updated_at = NOW()
        WHERE id = $3
      `,
      [otpHash, expiresAt, user.id]
    );

    const sent = await notifyTPinOtp(user, otp);
    if (!sent) {
      return res.status(500).json({ message: 'Could not send the code. Try again in a minute.' });
    }

    return res.json({
      message: 'We sent a 6-digit code to your email. It expires in 10 minutes.',
      email_hint: maskEmail(email),
      expires_in: 600,
    });
  } catch (err) {
    console.error('tl requestTPinOtp error:', err);
    return res.status(500).json({ message: 'Server error sending T-Pin reset code.' });
  }
}

async function verifyTPinOtp(req, res) {
  try {
    await ensureTPinOtpSchema();
    const otp = String(req.body?.otp || req.body?.code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit code from your email.' });
    }

    const { rows } = await pool.query(
      `
        SELECT t_pin_otp_hash, t_pin_otp_expires_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const user = rows[0];
    if (
      !user?.t_pin_otp_hash ||
      !user.t_pin_otp_expires_at ||
      new Date(user.t_pin_otp_expires_at).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: 'That code is invalid or expired. Request a new one.',
      });
    }

    const ok = await bcrypt.compare(otp, user.t_pin_otp_hash);
    if (!ok) {
      return res.status(400).json({
        message: 'That code is invalid or expired. Request a new one.',
      });
    }

    const changeUntil = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `
        UPDATE users
        SET t_pin_otp_hash = NULL,
            t_pin_otp_expires_at = NULL,
            t_pin_change_until = $1,
            updated_at = NOW()
        WHERE id = $2
      `,
      [changeUntil, req.user.id]
    );

    return res.json({
      message: 'Code confirmed. Set a new T-Pin now.',
      change_until: changeUntil.toISOString(),
    });
  } catch (err) {
    console.error('tl verifyTPinOtp error:', err);
    return res.status(500).json({ message: 'Server error verifying the code.' });
  }
}

async function createCategory(req, res) {
  try {
    const section = normalizeSection(req.body?.section);
    const name = String(req.body?.name || '').trim();
    if (!section) {
      return res.status(400).json({ message: 'section must be "all" or "merchant".' });
    }
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const { rows: ord } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tl_categories WHERE section = $1',
      [section]
    );

    const { rows } = await pool.query(
      `
        INSERT INTO tl_categories (section, name, sort_order, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING id, section, name, sort_order, created_at, updated_at
      `,
      [section, name, ord[0].next, req.user.id]
    );

    return res.status(201).json({
      ...rows[0],
      items: [],
      assignees: [],
    });
  } catch (err) {
    console.error('tl createCategory error:', err);
    return res.status(500).json({ message: 'Server error creating category.' });
  }
}

async function updateCategory(req, res) {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid category id.' });
    }
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const { rows } = await pool.query(
      `
        UPDATE tl_categories
        SET name = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, section, name, sort_order, created_at, updated_at
      `,
      [name, id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Category not found.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('tl updateCategory error:', err);
    return res.status(500).json({ message: 'Server error updating category.' });
  }
}

async function deleteCategory(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid category id.' });
    }
    const { rowCount } = await pool.query('DELETE FROM tl_categories WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ message: 'Category not found.' });
    return res.json({ message: 'Category deleted.' });
  } catch (err) {
    console.error('tl deleteCategory error:', err);
    return res.status(500).json({ message: 'Server error deleting category.' });
  }
}

async function createItem(req, res) {
  try {
    await ensureTlItemUsernameSchema();
    const categoryId = Number(req.params.id);
    const label = String(req.body?.label || '').trim();
    const value = String(req.body?.value || '').trim();
    const username = String(req.body?.username || '').trim();
    const itemType = String(req.body?.item_type || req.body?.itemType || 'text')
      .trim()
      .toLowerCase();

    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: 'Invalid category id.' });
    }
    if (!label || !value) {
      return res.status(400).json({ message: 'Label and value are required.' });
    }
    if (!ITEM_TYPES.has(itemType)) {
      return res.status(400).json({ message: 'item_type must be link, text, or bank.' });
    }

    const { rows: cat } = await pool.query(
      'SELECT id FROM tl_categories WHERE id = $1',
      [categoryId]
    );
    if (!cat[0]) return res.status(404).json({ message: 'Category not found.' });

    const { rows: ord } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tl_category_items WHERE category_id = $1',
      [categoryId]
    );

    const { rows } = await pool.query(
      `
        INSERT INTO tl_category_items (category_id, label, value, username, item_type, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, category_id, label, value, username, item_type, sort_order, created_at, updated_at
      `,
      [categoryId, label, value, username || null, itemType, ord[0].next]
    );

    await pool.query('UPDATE tl_categories SET updated_at = NOW() WHERE id = $1', [
      categoryId,
    ]);

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('tl createItem error:', err);
    return res.status(500).json({ message: 'Server error adding item.' });
  }
}

async function updateItem(req, res) {
  try {
    await ensureTlItemUsernameSchema();
    const id = Number(req.params.itemId);
    const label = String(req.body?.label || '').trim();
    const value = String(req.body?.value || '').trim();
    const username = String(req.body?.username || '').trim();
    const itemType = String(req.body?.item_type || req.body?.itemType || 'text')
      .trim()
      .toLowerCase();

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid item id.' });
    }
    if (!label || !value) {
      return res.status(400).json({ message: 'Label and value are required.' });
    }
    if (!ITEM_TYPES.has(itemType)) {
      return res.status(400).json({ message: 'item_type must be link, text, or bank.' });
    }

    const { rows } = await pool.query(
      `
        UPDATE tl_category_items
        SET label = $1, value = $2, username = $3, item_type = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING id, category_id, label, value, username, item_type, sort_order, created_at, updated_at
      `,
      [label, value, username || null, itemType, id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Item not found.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('tl updateItem error:', err);
    return res.status(500).json({ message: 'Server error updating item.' });
  }
}

async function deleteItem(req, res) {
  try {
    const id = Number(req.params.itemId);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid item id.' });
    }
    const { rowCount } = await pool.query('DELETE FROM tl_category_items WHERE id = $1', [
      id,
    ]);
    if (!rowCount) return res.status(404).json({ message: 'Item not found.' });
    return res.json({ message: 'Item deleted.' });
  } catch (err) {
    console.error('tl deleteItem error:', err);
    return res.status(500).json({ message: 'Server error deleting item.' });
  }
}

/**
 * PUT /api/tl-dashboard/categories/:id/assignments  { user_ids: number[], t_pin }
 */
async function setAssignments(req, res) {
  try {
    const categoryId = Number(req.params.id);
    const userIds = Array.isArray(req.body?.user_ids)
      ? req.body.user_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];

    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: 'Invalid category id.' });
    }

    const { rows: cat } = await pool.query(
      'SELECT id FROM tl_categories WHERE id = $1',
      [categoryId]
    );
    if (!cat[0]) return res.status(404).json({ message: 'Category not found.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM tl_category_assignments WHERE category_id = $1',
        [categoryId]
      );

      const unique = [...new Set(userIds)];
      for (const uid of unique) {
        // Never assign CEO to themselves as viewer
        const { rows: u } = await client.query(
          `SELECT id, role FROM users WHERE id = $1 AND is_active IS DISTINCT FROM FALSE`,
          [uid]
        );
        if (!u[0] || isCeoOrManagerRole(u[0].role)) continue;
        await client.query(
          `
            INSERT INTO tl_category_assignments (category_id, user_id, assigned_by)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `,
          [categoryId, uid, req.user.id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows: asg } = await pool.query(
      `
        SELECT a.user_id AS id, u.name, u.username, u.email, u.role
        FROM tl_category_assignments a
        INNER JOIN users u ON u.id = a.user_id
        WHERE a.category_id = $1
        ORDER BY u.name ASC NULLS LAST
      `,
      [categoryId]
    );

    return res.json({ category_id: categoryId, assignees: asg });
  } catch (err) {
    console.error('tl setAssignments error:', err);
    return res.status(500).json({ message: 'Server error updating assignments.' });
  }
}

/**
 * POST /api/tl-dashboard/save
 * One-shot section sync. CEO edits locally, then Save + T-Pin commits everything.
 * Body: { section, t_pin, categories: [{ id?, name, items: [...], assignee_ids: [] }] }
 */
async function saveSection(req, res) {
  const client = await pool.connect();
  try {
    const section = normalizeSection(req.body?.section);
    const incoming = Array.isArray(req.body?.categories) ? req.body.categories : null;
    if (!section) {
      return res.status(400).json({ message: 'section must be "all" or "merchant".' });
    }
    if (!incoming) {
      return res.status(400).json({ message: 'categories array is required.' });
    }

    // Only remove rows this editor actually loaded. CEO and manager share one
    // board — a stale save must not wipe the other person's new categories.
    const expectedCatIds = new Set(
      (Array.isArray(req.body?.expected_category_ids) ? req.body.expected_category_ids : []).map(
        (id) => String(id)
      )
    );
    const expectedItemIds = new Set(
      (Array.isArray(req.body?.expected_item_ids) ? req.body.expected_item_ids : []).map((id) =>
        String(id)
      )
    );

    await client.query('BEGIN');

    const { rows: existingCats } = await client.query(
      'SELECT id FROM tl_categories WHERE section = $1',
      [section]
    );
    const existingIds = new Set(existingCats.map((r) => String(r.id)));
    const keptIds = new Set();

    let sortOrder = 0;
    for (const cat of incoming) {
      const name = String(cat?.name || '').trim();
      if (!name) continue;
      sortOrder += 1;

      const rawId = cat.id;
      const numericId = Number(rawId);
      const isExisting =
        rawId != null &&
        !String(rawId).startsWith('temp-') &&
        Number.isFinite(numericId) &&
        existingIds.has(String(numericId));

      let categoryId;
      if (isExisting) {
        categoryId = numericId;
        await client.query(
          `
            UPDATE tl_categories
            SET name = $1, sort_order = $2, updated_at = NOW()
            WHERE id = $3 AND section = $4
          `,
          [name, sortOrder, categoryId, section]
        );
      } else {
        const { rows } = await client.query(
          `
            INSERT INTO tl_categories (section, name, sort_order, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [section, name, sortOrder, req.user.id]
        );
        categoryId = rows[0].id;
      }
      keptIds.add(String(categoryId));

      const items = Array.isArray(cat.items) ? cat.items : [];
      const { rows: existingItems } = await client.query(
        'SELECT id FROM tl_category_items WHERE category_id = $1',
        [categoryId]
      );
      const existingItemIds = new Set(existingItems.map((r) => String(r.id)));
      const keptItemIds = new Set();

      let itemOrder = 0;
      await ensureTlItemUsernameSchema();
      for (const item of items) {
        const label = String(item?.label || '').trim();
        const value = String(item?.value || '').trim();
        const username = String(item?.username || '').trim();
        const itemType = String(item?.item_type || item?.itemType || 'text')
          .trim()
          .toLowerCase();
        if (!value) continue;
        if (!ITEM_TYPES.has(itemType)) continue;
        const storedLabel = label || value;
        itemOrder += 1;

        const itemRaw = item.id;
        const itemNum = Number(itemRaw);
        const itemExists =
          itemRaw != null &&
          !String(itemRaw).startsWith('temp-') &&
          Number.isFinite(itemNum) &&
          existingItemIds.has(String(itemNum));

        if (itemExists) {
          await client.query(
            `
              UPDATE tl_category_items
              SET label = $1, value = $2, username = $3, item_type = $4, sort_order = $5, updated_at = NOW()
              WHERE id = $6 AND category_id = $7
            `,
            [storedLabel, value, username || null, itemType, itemOrder, itemNum, categoryId]
          );
          keptItemIds.add(String(itemNum));
        } else {
          const { rows: ins } = await client.query(
            `
              INSERT INTO tl_category_items (category_id, label, value, username, item_type, sort_order)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id
            `,
            [categoryId, storedLabel, value, username || null, itemType, itemOrder]
          );
          keptItemIds.add(String(ins[0].id));
        }
      }

      for (const eid of existingItemIds) {
        if (keptItemIds.has(eid)) continue;
        if (!expectedItemIds.has(eid)) continue;
        await client.query('DELETE FROM tl_category_items WHERE id = $1', [Number(eid)]);
      }

      const assigneeSource = Array.isArray(cat.assignee_ids)
        ? cat.assignee_ids
        : Array.isArray(cat.assignees)
          ? cat.assignees.map((a) => a.id)
          : [];
      const uniqueAssignees = [
        ...new Set(
          assigneeSource.map(Number).filter((n) => Number.isFinite(n) && n > 0)
        ),
      ];

      await client.query(
        'DELETE FROM tl_category_assignments WHERE category_id = $1',
        [categoryId]
      );
      for (const uid of uniqueAssignees) {
        const { rows: u } = await client.query(
          `
            SELECT id, role FROM users
            WHERE id = $1 AND is_active IS DISTINCT FROM FALSE
          `,
          [uid]
        );
        if (!u[0] || isCeoOrManagerRole(u[0].role)) continue;
        await client.query(
          `
            INSERT INTO tl_category_assignments (category_id, user_id, assigned_by)
            VALUES ($1, $2, $3)
          `,
          [categoryId, uid, req.user.id]
        );
      }
    }

    for (const eid of existingIds) {
      if (keptIds.has(eid)) continue;
      if (!expectedCatIds.has(eid)) continue;
      await client.query('DELETE FROM tl_categories WHERE id = $1 AND section = $2', [
        Number(eid),
        section,
      ]);
    }

    await client.query('COMMIT');
    return res.json({
      message: 'Dashboard saved.',
      section,
      categoriesSaved: keptIds.size,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('tl saveSection error:', err);
    return res.status(500).json({ message: 'Server error saving dashboard.' });
  } finally {
    client.release();
  }
}

/**
 * POST /api/tl-dashboard/view-pin
 * Anyone with dashboard access sets or changes their unlock PIN.
 * (CEO/manager still use T-Pin separately for Save.)
 */
async function setViewPin(req, res) {
  try {
    await ensureTlViewPinSchema();
    const row = await loadUserAccessFlags(req.user.id);
    if (!row) return res.status(404).json({ message: 'User not found.' });
    const assigned = await userHasAssignment(req.user.id);
    if (
      !hasTeamLeaderDashboardAccess({
        role: row.role,
        designation: row.designation,
        assigned,
      })
    ) {
      return res.status(403).json({ message: 'You are not assigned to this dashboard.' });
    }

    const newPin = String(req.body?.tl_view_pin ?? req.body?.view_pin ?? req.body?.new_view_pin ?? '').trim();
    if (!/^\d{4,8}$/.test(newPin)) {
      return res.status(400).json({ message: 'PIN must be 4–8 digits.' });
    }

    const { rows } = await pool.query(
      'SELECT password, tl_view_pin_hash, tl_view_pin_change_until FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const otpWindow =
      user.tl_view_pin_change_until &&
      new Date(user.tl_view_pin_change_until).getTime() > Date.now();

    if (otpWindow) {
      /* verified email OTP — allowed to set a new PIN */
    } else if (user.tl_view_pin_hash) {
      const current = String(req.body?.current_tl_view_pin ?? req.body?.current_view_pin ?? '').trim();
      if (!current || !(await bcrypt.compare(current, user.tl_view_pin_hash))) {
        return res.status(403).json({
          message: 'Current PIN is incorrect.',
          code: 'TL_VIEW_PIN_INVALID',
        });
      }
    } else {
      const password = String(req.body?.current_password ?? '').trim();
      if (!password || !(await bcrypt.compare(password, user.password))) {
        return res.status(403).json({
          message: 'Account password is required to create your PIN.',
          code: 'TL_VIEW_PIN_PASSWORD_REQUIRED',
        });
      }
    }

    const hash = await bcrypt.hash(newPin, 10);
    await pool.query(
      `
        UPDATE users
        SET tl_view_pin_hash = $1,
            tl_view_pin_otp_hash = NULL,
            tl_view_pin_otp_expires_at = NULL,
            tl_view_pin_change_until = NULL,
            updated_at = NOW()
        WHERE id = $2
      `,
      [hash, req.user.id]
    );

    return res.json({ message: 'Dashboard PIN saved.', viewPinConfigured: true });
  } catch (err) {
    console.error('setViewPin error:', err);
    return res.status(500).json({ message: 'Server error saving dashboard PIN.' });
  }
}

async function requestViewPinOtp(req, res) {
  try {
    await ensureTlViewPinSchema();
    const { rows } = await pool.query(
      `
        SELECT id, name, email, role, designation, tl_view_pin_otp_expires_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const assigned = await userHasAssignment(req.user.id);
    if (
      !hasTeamLeaderDashboardAccess({
        role: user.role,
        designation: user.designation,
        assigned,
      })
    ) {
      return res.status(403).json({ message: 'You are not assigned to this dashboard.' });
    }

    const email = String(user.email || '').trim();
    if (!email) {
      return res.status(400).json({
        message: 'Add an email on your profile before resetting the dashboard PIN.',
      });
    }

    if (
      user.tl_view_pin_otp_expires_at &&
      new Date(user.tl_view_pin_otp_expires_at).getTime() > Date.now() + 9 * 60 * 1000
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
        SET tl_view_pin_otp_hash = $1,
            tl_view_pin_otp_expires_at = $2,
            tl_view_pin_change_until = NULL,
            updated_at = NOW()
        WHERE id = $3
      `,
      [otpHash, expiresAt, user.id]
    );

    const sent = await notifyTlViewPinOtp(user, otp);
    if (!sent) {
      return res.status(500).json({ message: 'Could not send the code. Try again in a minute.' });
    }

    return res.json({
      message: 'We sent a 6-digit code to your email. It expires in 10 minutes.',
      email_hint: maskEmail(email),
      expires_in: 600,
    });
  } catch (err) {
    console.error('requestViewPinOtp error:', err);
    return res.status(500).json({ message: 'Server error sending PIN reset code.' });
  }
}

async function verifyViewPinOtp(req, res) {
  try {
    await ensureTlViewPinSchema();
    const otp = String(req.body?.otp || req.body?.code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit code from your email.' });
    }

    const { rows } = await pool.query(
      `
        SELECT tl_view_pin_otp_hash, tl_view_pin_otp_expires_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    const user = rows[0];
    if (
      !user?.tl_view_pin_otp_hash ||
      !user.tl_view_pin_otp_expires_at ||
      new Date(user.tl_view_pin_otp_expires_at).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: 'That code is invalid or expired. Request a new one.',
        code: 'TL_VIEW_PIN_OTP_INVALID',
      });
    }

    const ok = await bcrypt.compare(otp, user.tl_view_pin_otp_hash);
    if (!ok) {
      return res.status(400).json({
        message: 'That code is invalid or expired. Request a new one.',
        code: 'TL_VIEW_PIN_OTP_INVALID',
      });
    }

    const changeUntil = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `
        UPDATE users
        SET tl_view_pin_otp_hash = NULL,
            tl_view_pin_otp_expires_at = NULL,
            tl_view_pin_change_until = $1,
            updated_at = NOW()
        WHERE id = $2
      `,
      [changeUntil, req.user.id]
    );

    return res.json({
      message: 'Code confirmed. Set a new viewer PIN now.',
      change_until: changeUntil.toISOString(),
    });
  } catch (err) {
    console.error('verifyViewPinOtp error:', err);
    return res.status(500).json({ message: 'Server error verifying the code.' });
  }
}

module.exports = {
  getAccess,
  listCategories,
  listAssignableUsers,
  setTPin,
  requestTPinOtp,
  verifyTPinOtp,
  setViewPin,
  requestViewPinOtp,
  verifyViewPinOtp,
  createCategory,
  updateCategory,
  deleteCategory,
  createItem,
  updateItem,
  deleteItem,
  setAssignments,
  saveSection,
};
