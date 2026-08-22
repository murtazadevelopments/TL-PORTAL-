const pool = require('../config/db');
const { BRANCH_OPTIONS } = require('../constants/branches');

/**
 * GET /api/admin/branches
 */
async function listBranches(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, name, created_by, created_at
        FROM branches
        ORDER BY name ASC
      `
    );
    return res.json(rows);
  } catch (err) {
    console.error('listBranches error:', err);
    return res.status(500).json({ message: 'Server error fetching branches.' });
  }
}

/**
 * POST /api/admin/branches  { name }
 */
async function createBranch(req, res) {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Branch name is required.' });
    }
    if (name.length > 120) {
      return res.status(400).json({ message: 'Branch name must be 120 characters or fewer.' });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO branches (name, created_by)
        VALUES ($1, $2)
        RETURNING id, name, created_by, created_at
      `,
      [name, req.user?.id ?? null]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A branch with that name already exists.' });
    }
    console.error('createBranch error:', err);
    return res.status(500).json({ message: 'Server error creating branch.' });
  }
}

/**
 * DELETE /api/admin/branches/:id
 * Employee/admin branch strings are left as-is.
 */
async function deleteBranch(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid branch id.' });
    }

    const { rows } = await pool.query(
      `
        DELETE FROM branches
        WHERE id = $1
        RETURNING id, name
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Branch not found.' });
    }

    return res.json({
      message: `Branch “${rows[0].name}” deleted.`,
      branch: rows[0],
    });
  } catch (err) {
    console.error('deleteBranch error:', err);
    return res.status(500).json({ message: 'Server error deleting branch.' });
  }
}

/** Match a submitted branch name against the catalog (case-insensitive). */
async function findBranchName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const { rows } = await pool.query(
      `
        SELECT name
        FROM branches
        WHERE lower(name) = lower($1)
        LIMIT 1
      `,
      [trimmed]
    );
    if (rows[0]?.name) return rows[0].name;
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return BRANCH_OPTIONS.includes(trimmed) ? trimmed : undefined;
}

module.exports = { listBranches, createBranch, deleteBranch, findBranchName };
