const { pool } = require("../db");
const { AppError } = require("../lib/AppError");

async function listMachines(client = pool) {
  const result = await client.query(`
    SELECT m.*, d.name as department_name
    FROM machines m
    LEFT JOIN departments d ON d.id = m.department_id
    ORDER BY m.name
  `);
  return result.rows;
}

async function upsertMachine(machine, client = pool) {
  await client.query(
    `
      INSERT INTO machines (id, name, department_id, location, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          department_id = EXCLUDED.department_id,
          location = EXCLUDED.location,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
    `,
    [machine.id, machine.name, machine.department_id || null, machine.location || null, machine.is_active !== false],
  );

  return listMachines(client);
}

async function deleteMachine(machineId, client = pool) {
  // Check if machine is referenced in tasks
  const taskCount = await client.query(`SELECT COUNT(*) FROM tasks WHERE machine_id = $1`, [machineId]);
  if (parseInt(taskCount.rows[0].count) > 0) {
    throw new AppError(409, "Cannot delete machine: it is referenced by existing tasks");
  }

  await client.query(`DELETE FROM machines WHERE id = $1`, [machineId]);
  return true;
}

module.exports = {
  listMachines,
  upsertMachine,
  deleteMachine,
};
