const { pool } = require("../db");
const { AppError } = require("../lib/AppError");

async function listShifts(client = pool) {
  const result = await client.query(`SELECT * FROM shifts ORDER BY start_time`);
  return result.rows;
}

async function upsertShift(shift, client = pool) {
  await client.query(
    `
      INSERT INTO shifts (id, name, start_time, end_time, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
    `,
    [shift.id, shift.name, shift.start_time, shift.end_time, shift.is_active !== false],
  );

  return listShifts(client);
}

async function deleteShift(shiftId, client = pool) {
  // Check if shift is referenced in tasks or other places
  const taskCount = await client.query(`SELECT COUNT(*) FROM tasks WHERE shift_id = $1`, [shiftId]);
  if (parseInt(taskCount.rows[0].count) > 0) {
    throw new AppError(409, "Cannot delete shift: it is referenced by existing tasks");
  }

  await client.query(`DELETE FROM shifts WHERE id = $1`, [shiftId]);
  return true;
}

module.exports = {
  listShifts,
  upsertShift,
  deleteShift,
};
