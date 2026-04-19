const { pool } = require("../db");

const DEPARTMENT_PROJECT_SELECT = `
  SELECT
    s.id,
    p.project_no,
    p.project_name,
    p.customer_name,
    p.project_name AS project_description,
    s.scope_name,
    COALESCE(instance_stats.instance_count, 0)::integer AS instance_count,
    COALESCE(instance_stats.instance_count, 0)::text AS quantity_index,
    rework_stats.rework_date,
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
      COUNT(*)::integer AS instance_count
    FROM design.instances
    GROUP BY scope_id
  ) instance_stats
    ON instance_stats.scope_id = s.id
  LEFT JOIN (
    SELECT
      di.scope_id,
      MAX(dr.planned_date) AS rework_date
    FROM design.reworks dr
    JOIN design.instances di
      ON di.id = dr.instance_id
    GROUP BY di.scope_id
  ) rework_stats
    ON rework_stats.scope_id = s.id
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
  if (!row) {
    return null;
  }

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
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    department_id: row.department_id,
  };
}

function mapScopeOptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    project_id: row.project_id,
    scope_name: row.scope_name,
  };
}

function mapInstanceOptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    scope_id: row.scope_id,
    instance_code: row.instance_code,
    instance_index: row.instance_index === null || row.instance_index === undefined
      ? null
      : Number(row.instance_index),
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

  return result.rows.map((row) => mapProjectOptionRow(row));
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

  return result.rows.map((row) => mapScopeOptionRow(row));
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

  return result.rows.map((row) => mapDepartmentProjectRow(row));
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

async function findExactDepartmentProjectMatch(departmentId, row, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE p.department_id = $1
        AND p.project_no = $2
        AND p.project_name = $3
        AND p.customer_name = $4
        AND s.scope_name = $5
        AND COALESCE(instance_stats.instance_count, 0)::integer = $6
      LIMIT 1
    `,
    [
      departmentId,
      row.project_no,
      row.project_name,
      row.customer_name,
      row.scope_name,
      row.instance_count,
    ],
  );

  return mapDepartmentProjectRow(result.rows[0]);
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

async function findScopeByProjectAndName(projectId, scopeName, client = pool) {
  const result = await client.query(
    `
      SELECT id, project_id, scope_name
      FROM design.scopes
      WHERE project_id = $1
        AND scope_name = $2
      LIMIT 1
    `,
    [projectId, scopeName],
  );

  return result.rows[0] || null;
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
    return insertedScope.rows[0];
  }

  return findScopeByProjectAndName(projectId, scopeName, client);
}

async function countInstancesForScope(scopeId, client = pool) {
  const result = await client.query(
    `
      SELECT COUNT(*)::integer AS instance_count
      FROM design.instances
      WHERE scope_id = $1
    `,
    [scopeId],
  );

  return Number(result.rows[0]?.instance_count || 0);
}

async function createInstancesForScope(scopeId, startIndex, endIndex, client = pool) {
  if (endIndex < startIndex) {
    return [];
  }

  const result = await client.query(
    `
      INSERT INTO design.instances (
        scope_id,
        instance_code,
        instance_index
      )
      SELECT
        $1,
        CONCAT('I', LPAD(series.instance_index::text, 3, '0')),
        series.instance_index
      FROM generate_series($2::integer, $3::integer) AS series(instance_index)
      ON CONFLICT (scope_id, instance_code) DO NOTHING
      RETURNING id, scope_id, instance_code, instance_index
    `,
    [scopeId, startIndex, endIndex],
  );

  return result.rows;
}

async function listInstancesByScope(scopeId, client = pool) {
  const result = await client.query(
    `
      SELECT id, scope_id, instance_code, instance_index
      FROM design.instances
      WHERE scope_id = $1
      ORDER BY instance_index ASC
    `,
    [scopeId],
  );

  return result.rows;
}

async function listInstancesByScopeForDepartment(scopeId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT di.id, di.scope_id, di.instance_code, di.instance_index
      FROM design.instances di
      JOIN design.scopes ds
        ON ds.id = di.scope_id
      JOIN design.projects dp
        ON dp.id = ds.project_id
      WHERE di.scope_id = $1
        AND dp.department_id = $2
      ORDER BY di.instance_index ASC, di.id ASC
    `,
    [scopeId, departmentId],
  );

  return result.rows.map((row) => mapInstanceOptionRow(row));
}

async function findInstanceByIdForDepartment(instanceId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT di.id, di.scope_id, di.instance_code, di.instance_index
      FROM design.instances di
      JOIN design.scopes ds
        ON ds.id = di.scope_id
      JOIN design.projects dp
        ON dp.id = ds.project_id
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
    [instanceId, departmentId],
  );

  return mapInstanceOptionRow(result.rows[0]);
}

async function createReworksForScopeInstances(scopeId, plannedDate, client = pool) {
  if (!plannedDate) {
    return [];
  }

  const result = await client.query(
    `
      INSERT INTO design.reworks (
        instance_id,
        planned_date,
        is_completed,
        created_at
      )
      SELECT
        di.id,
        $2::date,
        FALSE,
        NOW()
      FROM design.instances di
      WHERE di.scope_id = $1
      ON CONFLICT (instance_id, planned_date) DO NOTHING
      RETURNING id, instance_id, planned_date, is_completed, created_at
    `,
    [scopeId, plannedDate],
  );

  return result.rows;
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

module.exports = {
  countInstancesForScope,
  createInstancesForScope,
  createReworksForScopeInstances,
  findDepartmentProjectByIdForDepartment,
  findInstanceByIdForDepartment,
  findProjectByIdForDepartment,
  findExactDepartmentProjectMatch,
  findOrCreateScope,
  findScopeByIdForDepartment,
  listDepartmentProjectsByDepartment,
  listInstancesByScope,
  listInstancesByScopeForDepartment,
  listProjectOptionsByDepartment,
  listScopesByProjectForDepartment,
  touchProject,
  upsertProjectByNumber,
};
