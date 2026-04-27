const { pool } = require("../db");
const { AppError } = require("../lib/AppError");

async function listDepartments(client = pool) {
  const result = await client.query(`
    SELECT id, name
    FROM departments
    WHERE is_active = true
    ORDER BY name
  `);
  if (result.rows.length === 0) {
    const { departments: seedDepartmentsData } = require("../seedData");
    for (const dep of seedDepartmentsData) {
      await upsertDepartment(dep, client);
    }
    await upsertDepartment({ id: "design", name: "Design", is_active: true }, client);
    
    const reFetched = await client.query(`
      SELECT id, name
      FROM departments
      WHERE is_active = true
      ORDER BY name
    `);
    return reFetched.rows;
  }

  return result.rows;
}

async function listAllDepartments(client = pool) {
  const result = await client.query(`
    SELECT *
    FROM departments
    ORDER BY COALESCE(is_active, TRUE) DESC, name
  `);
  if (result.rows.length === 0) {
    const { departments: seedDepartmentsData } = require("../seedData");
    for (const dep of seedDepartmentsData) {
      await upsertDepartment(dep, client);
    }
    await upsertDepartment({ id: "design", name: "Design", is_active: true }, client);
    
    const reFetched = await client.query(`
      SELECT *
      FROM departments
      ORDER BY COALESCE(is_active, TRUE) DESC, name
    `);
    return reFetched.rows.map((row) => ({
      ...row,
      is_active: row.is_active !== false,
    }));
  }

  return result.rows.map((row) => ({
    ...row,
    is_active: row.is_active !== false,
  }));
}

async function upsertDepartment(department, client = pool) {
  await client.query(
    `
      INSERT INTO departments (id, name, parent_department, is_active)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          parent_department = EXCLUDED.parent_department,
          is_active = EXCLUDED.is_active
    `,
    [department.id, department.name, department.parent_department || null, department.is_active !== false],
  );

  const result = await client.query(
    `
      SELECT id, name
      FROM departments
      WHERE id = $1
    `,
    [department.id],
  );

  return result.rows[0];
}

async function deleteDepartment(departmentId, client = pool) {
  const existingDepartment = await client.query(`SELECT id FROM departments WHERE id = $1 LIMIT 1`, [departmentId]);
  if (existingDepartment.rowCount === 0) {
    throw new AppError(404, "Department not found");
  }

  const userCount = await client.query(`SELECT COUNT(*)::int AS count FROM users WHERE department_id = $1`, [departmentId]);
  if (Number(userCount.rows[0].count) > 0) {
    throw new AppError(409, "Cannot deactivate department: it is assigned to existing users");
  }

  await client.query(`UPDATE departments SET is_active = FALSE WHERE id = $1`, [departmentId]);
  return true;
}

module.exports = {
  deleteDepartment,
  listAllDepartments,
  listDepartments,
  upsertDepartment,
};
