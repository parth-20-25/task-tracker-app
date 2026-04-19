const { pool } = require("../db");

function mapProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    project_no: row.project_no,
    project_name: row.project_name || row.project_description,
    customer_name: row.customer_name || "",
    project_description: row.project_description,
    scope_name: row.scope_name,
    quantity_index: row.quantity_index,
    instance_count: row.instance_count === null || row.instance_count === undefined
      ? null
      : Number(row.instance_count),
    rework_date: row.rework_date || null,
    department_id: row.department_id,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listProjectsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM projects
      WHERE department_id = $1
      ORDER BY updated_at DESC, created_at DESC, project_no ASC
    `,
    [departmentId],
  );

  return result.rows.map((row) => mapProjectRow(row));
}

async function findProjectByIdForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM projects
      WHERE id = $1
        AND department_id = $2
      LIMIT 1
    `,
    [projectId, departmentId],
  );

  return mapProjectRow(result.rows[0]);
}

async function createProject(project, client = pool) {
  const result = await client.query(
    `
      INSERT INTO projects (
        project_no,
        project_name,
        customer_name,
        instance_count,
        rework_date,
        project_description,
        scope_name,
        quantity_index,
        department_id,
        uploaded_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `,
    [
      project.project_no,
      project.project_name,
      project.customer_name,
      project.instance_count,
      project.rework_date || null,
      project.project_description,
      project.scope_name,
      project.quantity_index,
      project.department_id,
      project.uploaded_by || null,
    ],
  );

  return mapProjectRow(result.rows[0]);
}

module.exports = {
  createProject,
  findProjectByIdForDepartment,
  listProjectsByDepartment,
};
