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
    const departments = reFetched.rows.map((row) => ({
      ...row,
      is_active: row.is_active !== false,
    }));
    await attachSubdivisions(departments, client);
    return departments;
  }

  const departments = result.rows.map((row) => ({
    ...row,
    is_active: row.is_active !== false,
  }));
  await attachSubdivisions(departments, client);
  return departments;
}

async function attachSubdivisions(departments, client = pool) {
  if (!Array.isArray(departments) || departments.length === 0) {
    return departments;
  }

  const ids = departments.map((department) => department.id).filter(Boolean);
  if (ids.length === 0) {
    return departments;
  }

  const result = await client.query(
    `
      SELECT id, department_id, subdivision_name, is_active, created_at, updated_at
      FROM department_subdivisions
      WHERE department_id = ANY($1::text[])
      ORDER BY subdivision_name ASC
    `,
    [ids],
  );
  const byDepartment = new Map();
  for (const row of result.rows) {
    const items = byDepartment.get(row.department_id) || [];
    items.push(mapSubdivisionRow(row));
    byDepartment.set(row.department_id, items);
  }

  for (const department of departments) {
    department.subdivisions = byDepartment.get(department.id) || [];
  }

  return departments;
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

function mapSubdivisionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    department_id: row.department_id,
    subdivision_name: row.subdivision_name,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listSubdivisionsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT id, department_id, subdivision_name, is_active, created_at, updated_at
      FROM department_subdivisions
      WHERE department_id = $1
      ORDER BY is_active DESC, subdivision_name ASC
    `,
    [departmentId],
  );

  return result.rows.map(mapSubdivisionRow);
}

async function upsertSubdivision(subdivision, client = pool) {
  if (subdivision.id) {
    const result = await client.query(
      `
        UPDATE department_subdivisions
        SET subdivision_name = $3,
            is_active = $4,
            updated_at = NOW()
        WHERE id = $1
          AND department_id = $2
        RETURNING id, department_id, subdivision_name, is_active, created_at, updated_at
      `,
      [
        subdivision.id,
        subdivision.department_id,
        subdivision.subdivision_name,
        subdivision.is_active !== false,
      ],
    );

    if (result.rowCount === 0) {
      throw new AppError(404, "Subdivision not found");
    }

    return mapSubdivisionRow(result.rows[0]);
  }

  const result = await client.query(
    `
      INSERT INTO department_subdivisions (
        department_id,
        subdivision_name,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (department_id, subdivision_name) DO UPDATE
      SET subdivision_name = EXCLUDED.subdivision_name,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      RETURNING id, department_id, subdivision_name, is_active, created_at, updated_at
    `,
    [
      subdivision.department_id,
      subdivision.subdivision_name,
      subdivision.is_active !== false,
    ],
  );

  return mapSubdivisionRow(result.rows[0]);
}

async function getSubdivisionDeletionDependencies(subdivisionId, client = pool) {
  const result = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM users
          WHERE subdivision_id = $1
        ) AS assigned_users,
        (
          SELECT COUNT(*)::int
          FROM design.project_subdivision_assignments psa
          JOIN design.projects p ON p.id = psa.project_id
          WHERE psa.subdivision_id = $1
            AND psa.is_active = TRUE
            AND COALESCE(p.status, 'active') = 'active'
        ) AS active_project_routing
    `,
    [subdivisionId],
  );

  return {
    assigned_users: Number(result.rows[0]?.assigned_users || 0),
    active_project_routing: Number(result.rows[0]?.active_project_routing || 0),
  };
}

function assertSubdivisionHasNoDependencies(dependencies, actionLabel) {
  if (dependencies.assigned_users > 0) {
    throw new AppError(409, `Cannot ${actionLabel} subdivision: users are assigned to it`, dependencies);
  }

  if (dependencies.active_project_routing > 0) {
    throw new AppError(409, `Cannot ${actionLabel} subdivision: active project routing exists`, dependencies);
  }
}

async function setSubdivisionActive(subdivisionId, isActive, client = pool) {
  const existing = await client.query(
    `SELECT id FROM department_subdivisions WHERE id = $1 LIMIT 1`,
    [subdivisionId],
  );

  if (existing.rowCount === 0) {
    throw new AppError(404, "Subdivision not found");
  }

  if (isActive === false) {
    assertSubdivisionHasNoDependencies(
      await getSubdivisionDeletionDependencies(subdivisionId, client),
      "deactivate",
    );
  }

  const result = await client.query(
    `
      UPDATE department_subdivisions
      SET is_active = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, department_id, subdivision_name, is_active, created_at, updated_at
    `,
    [subdivisionId, isActive === true],
  );

  return mapSubdivisionRow(result.rows[0]);
}

async function deleteSubdivision(subdivisionId, client = pool) {
  const existing = await client.query(
    `SELECT id FROM department_subdivisions WHERE id = $1 LIMIT 1`,
    [subdivisionId],
  );

  if (existing.rowCount === 0) {
    throw new AppError(404, "Subdivision not found");
  }

  assertSubdivisionHasNoDependencies(
    await getSubdivisionDeletionDependencies(subdivisionId, client),
    "delete",
  );

  await client.query(`DELETE FROM department_subdivisions WHERE id = $1`, [subdivisionId]);
  return true;
}

module.exports = {
  deleteDepartment,
  deleteSubdivision,
  getSubdivisionDeletionDependencies,
  listAllDepartments,
  listDepartments,
  listSubdivisionsByDepartment,
  setSubdivisionActive,
  upsertSubdivision,
  upsertDepartment,
};
