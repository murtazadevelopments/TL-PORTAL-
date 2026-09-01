const pool = require('../config/db');
const { ensureOnsiteAttendanceSchema } = require('../utils/onsiteAttendanceSchema');
const { formatTime, timeToMinutes } = require('../utils/onsiteShiftStatus');

const SHIFT_SELECT = `id, name, start_time, late_after, absent_after, created_by, created_at, updated_at`;

function serializeShift(row) {
  return {
    id: row.id,
    name: row.name,
    start_time: formatTime(row.start_time),
    late_after: formatTime(row.late_after),
    absent_after: formatTime(row.absent_after),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseTimeField(value, label) {
  const mins = timeToMinutes(value);
  if (mins == null) {
    return { error: `${label} must be a time like 09:00.` };
  }
  return { value: formatTime(value) };
}

function parseShiftBody(body) {
  const name = String(body?.name || '').trim();
  if (!name) return { error: 'Shift name is required.' };
  if (name.length > 80) return { error: 'Shift name must be 80 characters or fewer.' };

  const start = parseTimeField(body.start_time, 'Shift start');
  if (start.error) return start;
  const late = parseTimeField(body.late_after, 'Late threshold');
  if (late.error) return late;
  const absent = parseTimeField(body.absent_after, 'Absent threshold');
  if (absent.error) return absent;

  return {
    name,
    start_time: start.value,
    late_after: late.value,
    absent_after: absent.value,
  };
}

async function listShifts(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const { rows } = await pool.query(
      `SELECT ${SHIFT_SELECT} FROM shifts ORDER BY start_time ASC, name ASC`
    );
    return res.json(rows.map(serializeShift));
  } catch (err) {
    console.error('listShifts error:', err);
    return res.status(500).json({ message: 'Server error fetching shifts.' });
  }
}

async function createShift(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const parsed = parseShiftBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const { rows } = await pool.query(
      `
        INSERT INTO shifts (name, start_time, late_after, absent_after, created_by)
        VALUES ($1, $2::time, $3::time, $4::time, $5)
        RETURNING ${SHIFT_SELECT}
      `,
      [parsed.name, parsed.start_time, parsed.late_after, parsed.absent_after, req.user?.id ?? null]
    );
    return res.status(201).json(serializeShift(rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A shift with that name already exists.' });
    }
    console.error('createShift error:', err);
    return res.status(500).json({ message: 'Server error creating shift.' });
  }
}

async function updateShift(req, res) {
  try {
    await ensureOnsiteAttendanceSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid shift id.' });
    }
    const parsed = parseShiftBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const { rows } = await pool.query(
      `
        UPDATE shifts
        SET name = $2,
            start_time = $3::time,
            late_after = $4::time,
            absent_after = $5::time,
            updated_at = NOW()
        WHERE id = $1
        RETURNING ${SHIFT_SELECT}
      `,
      [id, parsed.name, parsed.start_time, parsed.late_after, parsed.absent_after]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Shift not found.' });
    return res.json(serializeShift(rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A shift with that name already exists.' });
    }
    console.error('updateShift error:', err);
    return res.status(500).json({ message: 'Server error updating shift.' });
  }
}

async function deleteShift(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid shift id.' });
    }
    const { rows } = await pool.query(
      `DELETE FROM shifts WHERE id = $1 RETURNING id, name`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Shift not found.' });
    return res.json({
      message: `Shift “${rows[0].name}” deleted. Employees keep their current shift name until you change it.`,
      shift: rows[0],
    });
  } catch (err) {
    console.error('deleteShift error:', err);
    return res.status(500).json({ message: 'Server error deleting shift.' });
  }
}

async function findShiftName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    await ensureOnsiteAttendanceSchema();
    const { rows } = await pool.query(
      `
        SELECT name FROM shifts WHERE lower(name) = lower($1) LIMIT 1
      `,
      [trimmed]
    );
    if (rows[0]?.name) return rows[0].name;
    const { rows: any } = await pool.query(`SELECT 1 FROM shifts LIMIT 1`);
    if (any.length) return undefined;
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return trimmed;
}

async function getShiftByName(name) {
  const catalog = await findShiftName(name);
  if (!catalog) return null;
  const { rows } = await pool.query(
    `SELECT ${SHIFT_SELECT} FROM shifts WHERE lower(name) = lower($1) LIMIT 1`,
    [catalog]
  );
  return rows[0] ? serializeShift(rows[0]) : null;
}

module.exports = {
  listShifts,
  createShift,
  updateShift,
  deleteShift,
  findShiftName,
  getShiftByName,
};
