const { pool } = require("../db");

const DEPARTMENT_PROJECT_SELECT = `
  SELECT
    s.id,
    p.project_no,
    p.project_name,
    p.customer_name,
    p.project_name AS project_description,
    s.scope_name,
    COALESCE(fixture_stats.fixture_count, 0)::integer AS instance_count,
    NULL::text AS quantity_index,
    NULL::date AS rework_date,
    p.department_id,
    p.uploaded_by,
    p.created_at,
    p.updated_at
  FROM design.scopes s
  JOIN design.projects p
    ON p.id = s.project_id
  LEFT JOIN (
    SELECT
      scope_id,
      COUNT(*)::integer AS fixture_count
    FROM design.fixtures
    GROUP BY scope_id
  ) fixture_stats
    ON fixture_stats.scope_id = s.id
`;

function mapDepartmentProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    project_description: row.project_description,
    scope_name: row.scope_name,
    quantity_index: row.quantity_index,
    instance_count: row.instance_count === null || row.instance_count === undefined
      ? 0
      : Number(row.instance_count),
    rework_date: row.rework_date || null,
    department_id: row.department_id,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapDesignProjectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    department_id: row.department_id,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProjectOptionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    department_id: row.department_id,
  };
}

function mapScopeOptionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    scope_name: row.scope_name,
  };
}

function mapFixtureOptionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope_id: row.scope_id,
    fixture_no: row.fixture_no,
    op_no: row.op_no,
    part_name: row.part_name,
    fixture_type: row.fixture_type,
    qty: Number(row.qty),
  };
}

async function listProjectOptionsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT id, project_no, project_name, customer_name, department_id
      FROM design.projects
      WHERE department_id = $1
      ORDER BY updated_at DESC, created_at DESC, project_no ASC
    `,
    [departmentId],
  );
  return result.rows.map(mapProjectOptionRow);
}

async function findProjectByIdForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT id, project_no, project_name, customer_name, department_id
      FROM design.projects
      WHERE id = $1
        AND department_id = $2
      LIMIT 1
    `,
    [projectId, departmentId],
  );
  return mapProjectOptionRow(result.rows[0]);
}

async function findProjectByNumberForDepartment(projectNo, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM design.projects
      WHERE project_no = $1
        AND department_id = $2
      LIMIT 1
    `,
    [projectNo, departmentId],
  );
  return mapDesignProjectRow(result.rows[0]);
}

async function listScopesByProjectForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT s.id, s.project_id, s.scope_name
      FROM design.scopes s
      JOIN design.projects p
        ON p.id = s.project_id
      WHERE s.project_id = $1
        AND p.department_id = $2
      ORDER BY s.scope_name ASC, s.id ASC
    `,
    [projectId, departmentId],
  );
  return result.rows.map(mapScopeOptionRow);
}

async function findScopeByIdForDepartment(scopeId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT s.id, s.project_id, s.scope_name
      FROM design.scopes s
      JOIN design.projects p
        ON p.id = s.project_id
      WHERE s.id = $1
        AND p.department_id = $2
      LIMIT 1
    `,
    [scopeId, departmentId],
  );
  return mapScopeOptionRow(result.rows[0]);
}

async function listDepartmentProjectsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE p.department_id = $1
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC, s.scope_name ASC
    `,
    [departmentId],
  );
  return result.rows.map(mapDepartmentProjectRow);
}

async function findDepartmentProjectByIdForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE s.id = $1
        AND p.department_id = $2
      LIMIT 1
    `,
    [projectId, departmentId],
  );
  return mapDepartmentProjectRow(result.rows[0]);
}

async function upsertProjectByNumber(project, client = pool) {
  const insertedProject = await client.query(
    `
      INSERT INTO design.projects (
        project_no,
        project_name,
        customer_name,
        department_id,
        uploaded_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (project_no, department_id) DO NOTHING
      RETURNING *
    `,
    [
      project.project_no,
      project.project_name,
      project.customer_name,
      project.department_id,
      project.uploaded_by || null,
    ],
  );

  if (insertedProject.rows[0]) {
    return mapDesignProjectRow(insertedProject.rows[0]);
  }

  return findProjectByNumberForDepartment(project.project_no, project.department_id, client);
}

async function findOrCreateScope(projectId, scopeName, client = pool) {
  const insertedScope = await client.query(
    `
      INSERT INTO design.scopes (
        project_id,
        scope_name
      )
      VALUES ($1, $2)
      ON CONFLICT (project_id, scope_name) DO NOTHING
      RETURNING id, project_id, scope_name
    `,
    [projectId, scopeName],
  );

  if (insertedScope.rows[0]) {
    return mapScopeOptionRow(insertedScope.rows[0]);
  }

  const result = await client.query(
    `
      SELECT id, project_id, scope_name
      FROM design.scopes
      WHERE project_id = $1
        AND scope_name = $2
      LIMIT 1
    `,
    [projectId, scopeName]
  );
  return mapScopeOptionRow(result.rows[0]);
}

async function listFixturesByScopeForDepartment(scopeId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT di.id, di.scope_id, di.fixture_no, di.op_no, di.part_name, di.fixture_type, di.qty
      FROM design.fixtures di
      JOIN design.scopes ds
        ON ds.id = di.scope_id
      JOIN design.projects dp
        ON dp.id = ds.project_id
      WHERE di.scope_id = $1
        AND dp.department_id = $2
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [scopeId, departmentId],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function findFixtureByIdForDepartment(fixtureId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT di.id, di.scope_id, di.fixture_no, di.op_no, di.part_name, di.fixture_type, di.qty
      FROM design.fixtures di
      JOIN design.scopes ds
        ON ds.id = di.scope_id
      JOIN design.projects dp
        ON dp.id = ds.project_id
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
    [fixtureId, departmentId],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

async function touchProject(projectId, client = pool) {
  await client.query(
    `
      UPDATE design.projects
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [projectId],
  );
}

async function createUploadBatch(batchData, client = pool) {
  const res = await client.query(`
    INSERT INTO design.upload_batches (project_id, scope_id, uploaded_by, total_rows, accepted_rows, rejected_rows)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
  `, [batchData.project_id, batchData.scope_id, batchData.uploaded_by, batchData.total_rows, batchData.accepted_rows, batchData.rejected_rows]);
  return res.rows[0].id;
}

async function createUploadErrors(batchId, errors, client = pool) {
  if (!errors || errors.length === 0) return;
  // chunk inserts might be better but assuming errors array is not huge
  for (const err of errors) {
    await client.query(`
      INSERT INTO design.upload_errors (batch_id, row_number, error_message)
      VALUES ($1, $2, $3)
    `, [batchId, err.row_number, err.error_message]);
  }
}

async function findFixturesByScopeForDedupe(scopeId, client = pool) {
  const result = await client.query(`
    SELECT id, fixture_no, op_no, part_name, fixture_type, qty 
    FROM design.fixtures 
    WHERE scope_id = $1
  `, [scopeId]);
  return result.rows.map(mapFixtureOptionRow);
}

async function upsertFixture(fixtureData, client = pool) {
  const res = await client.query(`
    INSERT INTO design.fixtures (scope_id, fixture_no, op_no, part_name, fixture_type, qty)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (scope_id, fixture_no) DO UPDATE
    SET 
      op_no = EXCLUDED.op_no,
      part_name = EXCLUDED.part_name,
      fixture_type = EXCLUDED.fixture_type,
      qty = EXCLUDED.qty
    RETURNING *
  `, [fixtureData.scope_id, fixtureData.fixture_no, fixtureData.op_no, fixtureData.part_name, fixtureData.fixture_type, fixtureData.qty]);
  return mapFixtureOptionRow(res.rows[0]);
}

module.exports = {
  findDepartmentProjectByIdForDepartment,
  findFixtureByIdForDepartment,
  findProjectByIdForDepartment,
  findProjectByNumberForDepartment,
  findOrCreateScope,
  findScopeByIdForDepartment,
  listDepartmentProjectsByDepartment,
  listFixturesByScopeForDepartment,
  listProjectOptionsByDepartment,
  listScopesByProjectForDepartment,
  touchProject,
  upsertProjectByNumber,
  createUploadBatch,
  createUploadErrors,
  findFixturesByScopeForDedupe,
  upsertFixture
};
