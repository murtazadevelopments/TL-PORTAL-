const pool = require('../config/db');

/**
 * GET /api/admin/teams
 * Any admin (employees:view or broader admin access) can list teams for dropdowns.
 */
async function listTeams(req, res) {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, name, created_by, created_at
        FROM teams
        ORDER BY name ASC
      `
    );
    return res.json(rows);
  } catch (err) {
    console.error('listTeams error:', err);
    return res.status(500).json({ message: 'Server error fetching teams.' });
  }
}

/**
 * POST /api/admin/teams  { name }
 * Requires teams:create (CEO bypasses via requirePermission).
 */
async function createTeam(req, res) {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Team name is required.' });
    }
    if (name.length > 120) {
      return res.status(400).json({ message: 'Team name must be 120 characters or fewer.' });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO teams (name, created_by)
        VALUES ($1, $2)
        RETURNING id, name, created_by, created_at
      `,
      [name, req.user?.id ?? null]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A team with that name already exists.' });
    }
    console.error('createTeam error:', err);
    return res.status(500).json({ message: 'Server error creating team.' });
  }
}

/**
 * DELETE /api/admin/teams/:id
 * Requires teams:create (same manage-teams scope). Employee department strings are left as-is.
 */
async function deleteTeam(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid team id.' });
    }

    const { rows } = await pool.query(
      `
        DELETE FROM teams
        WHERE id = $1
        RETURNING id, name
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    return res.json({
      message: `Team “${rows[0].name}” deleted.`,
      team: rows[0],
    });
  } catch (err) {
    console.error('deleteTeam error:', err);
    return res.status(500).json({ message: 'Server error deleting team.' });
  }
}

module.exports = { listTeams, createTeam, deleteTeam };
