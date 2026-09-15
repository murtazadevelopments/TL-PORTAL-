const pool = require('../config/db');
const { normalizeDesignation } = require('../constants/designations');
const {
  ensureDesignationsSchema,
  refreshDesignationCache,
} = require('../utils/designationsSchema');

const SELECT = `id, name, tl_dashboard_access, created_by, created_at, updated_at`;

function serialize(row) {
  return {
    id: Number(row.id),
    name: row.name,
    tl_dashboard_access: Boolean(row.tl_dashboard_access),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findDesignationName(value, { current } = {}) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    await ensureDesignationsSchema();
    const { rows } = await pool.query(
      `SELECT name FROM designations WHERE lower(name) = lower($1) LIMIT 1`,
      [trimmed]
    );
    if (rows[0]?.name) return rows[0].name;
    const { rows: any } = await pool.query(`SELECT 1 FROM designations LIMIT 1`);
    if (any.length) {
      const cur = String(current || '').trim();
      if (cur && normalizeDesignation(cur) === normalizeDesignation(trimmed)) {
        return trimmed;
      }
      return null;
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return trimmed;
}

async function listDesignations(req, res) {
  try {
    await ensureDesignationsSchema();
    const { rows } = await pool.query(
      `SELECT ${SELECT} FROM designations ORDER BY tl_dashboard_access DESC, name ASC`
    );
    return res.json(rows.map(serialize));
  } catch (err) {
    console.error('listDesignations error:', err);
    return res.status(500).json({ message: 'Server error fetching designations.' });
  }
}

async function createDesignation(req, res) {
  try {
    await ensureDesignationsSchema();
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Designation name is required.' });
    if (name.length > 80) {
      return res.status(400).json({ message: 'Designation name must be 80 characters or fewer.' });
    }
    const tlAccess = Boolean(req.body?.tl_dashboard_access);
    const { rows } = await pool.query(
      `
        INSERT INTO designations (name, tl_dashboard_access, created_by)
        VALUES ($1, $2, $3)
        RETURNING ${SELECT}
      `,
      [name, tlAccess, req.user?.id ?? null]
    );
    await refreshDesignationCache();
    return res.status(201).json(serialize(rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That designation already exists.' });
    }
    console.error('createDesignation error:', err);
    return res.status(500).json({ message: 'Server error creating designation.' });
  }
}

async function updateDesignation(req, res) {
  try {
    await ensureDesignationsSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid designation id.' });
    }
    const name =
      req.body?.name === undefined ? null : String(req.body.name || '').trim();
    if (name !== null && !name) {
      return res.status(400).json({ message: 'Designation name is required.' });
    }
    if (name && name.length > 80) {
      return res.status(400).json({ message: 'Designation name must be 80 characters or fewer.' });
    }

    const { rows: existing } = await pool.query(
      `SELECT ${SELECT} FROM designations WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!existing[0]) return res.status(404).json({ message: 'Designation not found.' });

    const nextName = name || existing[0].name;
    const nextTl =
      req.body?.tl_dashboard_access === undefined
        ? existing[0].tl_dashboard_access
        : Boolean(req.body.tl_dashboard_access);

    const { rows } = await pool.query(
      `
        UPDATE designations
        SET name = $2,
            tl_dashboard_access = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING ${SELECT}
      `,
      [id, nextName, nextTl]
    );
    if (String(existing[0].name) !== String(nextName)) {
      await pool.query(
        `
          UPDATE users
          SET designation = $1, updated_at = NOW()
          WHERE lower(trim(COALESCE(designation, ''))) = lower(trim($2))
        `,
        [nextName, existing[0].name]
      );
    }
    await refreshDesignationCache();
    return res.json(serialize(rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That designation already exists.' });
    }
    console.error('updateDesignation error:', err);
    return res.status(500).json({ message: 'Server error updating designation.' });
  }
}

async function deleteDesignation(req, res) {
  try {
    await ensureDesignationsSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid designation id.' });
    }
    const { rows } = await pool.query(
      `DELETE FROM designations WHERE id = $1 RETURNING id, name`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Designation not found.' });
    await refreshDesignationCache();
    return res.json({
      message: `Designation “${rows[0].name}” removed. Employees keep this title until you change it.`,
      designation: rows[0],
    });
  } catch (err) {
    console.error('deleteDesignation error:', err);
    return res.status(500).json({ message: 'Server error deleting designation.' });
  }
}

module.exports = {
  listDesignations,
  createDesignation,
  updateDesignation,
  deleteDesignation,
  findDesignationName,
};
