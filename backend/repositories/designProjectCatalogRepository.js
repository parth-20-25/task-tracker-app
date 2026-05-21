const { pool } = require("../db");
const { PROJECT_STATUSES } = require("../config/constants");
const { instrumentModuleExports } = require("../lib/observability");
const { AppError } = require("../lib/AppError");
const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../lib/workflowStageVersioning");
const {
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  getAccessibleProjectIds,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("./projectVisibility");

const DEPARTMENT_PROJECT_SELECT = `
  SELECT
    p.id AS project_id,
    p.project_no,
    COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
    p.customer_name,
    p.project_name AS project_description,
    COALESCE(p.status, '${PROJECT_STATUSES.ACTIVE}') AS project_status,
    COALESCE(fixture_stats.fixture_count, 0)::integer AS instance_count,
    NULL::text AS quantity_index,
    NULL::date AS rework_date,
    p.department_id,
    p.uploaded_by,
    p.created_at,
    p.updated_at
  FROM design.projects p
  LEFT JOIN (
    SELECT
      project_id,
      COUNT(*)::integer AS fixture_count
    FROM design.fixtures
    GROUP BY project_id
  ) fixture_stats
    ON fixture_stats.project_id = p.id
`;

function mapDepartmentProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id || null,
    project_code: row.project_no,
    project_name: row.project_name,
    company_name: row.customer_name,
    project_description: row.project_description,
    quantity_index: row.quantity_index,
    instance_count: row.instance_count === null || row.instance_count === undefined
      ? 0
      : Number(row.instance_count),
    rework_date: row.rework_date || null,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
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
    project_id: row.project_id || row.id,
    project_code: row.project_no,
    project_name: row.project_name,
    company_name: row.customer_name,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
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
    project_id: row.project_id || row.id,
    project_code: row.project_no,
    project_name: row.project_name,
    company_name: row.customer_name,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
  };
}

function normalizeProjectCompletionPercent(row) {
  if (!row) {
    return null;
  }

  const value = row.completion_percent ?? row.project_completion_percent;
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value);
}

function mapProjectSummaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    department_id: row.department_id,
    department_name: row.department_name || null,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    completion_percent: normalizeProjectCompletionPercent(row),
    completion_truth_status: row.completion_truth_status || null,
    completion_strict_complete: row.completion_strict_complete === true,
    completion_truth_errors: Array.isArray(row.completion_truth_errors) ? row.completion_truth_errors : [],
    total_fixtures: Number(row.total_fixtures || 0),
    total_tasks: Number(row.total_tasks || 0),
    pending_tasks: Number(row.pending_tasks || 0),
    active_tasks: Number(row.active_tasks || 0),
    completed_tasks: Number(row.completed_tasks || 0),
    uploaded_by: row.uploaded_by || null,
    team_lead_id: row.team_lead_id || null,
    team_lead_name: row.team_lead_name || null,
    uploaded_by_name: row.uploaded_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapFixtureOptionRow(row) {
  if (!row) {
    return null;
  }

  const stageVersion = normalizeStageVersion(row.workflow_stage_version);
  const workflowRevisionCode = row.workflow_revision_code
    || (row.workflow_stage ? formatStageRevisionCode(row.workflow_stage, stageVersion) : null);
  const workflowStatus = row.workflow_status || null;

  return {
    fixture_id: row.fixture_id || row.id,
    project_id: row.project_id || null,
    batch_id: row.batch_id || null,
    fixture_no: row.fixture_no,
    part_name: row.part_name,
    fixture_type: row.fixture_type,
    remark: row.remark || null,
    qty: Number(row.qty),
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
    revision_no: Number(row.revision_no || 0),
    is_legacy_workflow: row.is_legacy_workflow === true,
    is_workflow_complete: row.is_workflow_complete === true,
    workflow_stage: row.workflow_stage || null,
    workflow_stage_label: row.workflow_stage_label || null,
    workflow_stage_order: row.workflow_stage_order === null || row.workflow_stage_order === undefined
      ? null
      : Number(row.workflow_stage_order),
    workflow_stage_version: stageVersion,
    workflow_revision_code: workflowRevisionCode,
    workflow_status: workflowStatus,
    workflow_assigned_to: row.workflow_assigned_to || null,
    workflow_assigned_to_name: row.workflow_assigned_to_name || null,
    workflow_progress_percent: row.workflow_progress_percent === null || row.workflow_progress_percent === undefined
      ? 0
      : Number(row.workflow_progress_percent),
    workflow_stage_active: workflowStatus === "IN_PROGRESS",
    review_pending: workflowStatus === "COMPLETED",
    blocked: workflowStatus === "REJECTED",
  };
}

function requireRow(result, errorMessage) {
  const row = result?.rows?.[0];

  if (!row) {
    throw new Error(errorMessage);
  }

  return row;
}

async function logVisibilityDecision({
  event,
  user,
  requestedProjectId = null,
  requestedFixtureId = null,
  requestedDepartmentId = null,
  queryFilter,
  permissionResult,
  client = pool,
}) {
  try {
    const currentUserId = user?.id || null;
    const currentEmployeeId = user?.employee_id || null;
    const accessibleUserIds = await GetAccessibleUserIds(currentEmployeeId || currentUserId, client);
    const accessibleProjectIds = await getAccessibleProjectIds(
      currentEmployeeId || currentUserId,
      requestedDepartmentId,
      client,
    );

    let projectContext = null;
    if (requestedProjectId) {
      const projectResult = await client.query(
        `
          SELECT id::text AS project_id, department_id, uploaded_by
          FROM design.projects
          WHERE id = $1
          LIMIT 1
        `,
        [requestedProjectId],
      );
      projectContext = projectResult.rows[0] || null;
    }

    let fixtureContext = null;
    if (requestedFixtureId) {
      const fixtureResult = await client.query(
        `
          SELECT
            f.id::text AS fixture_id,
            f.project_id::text AS project_id,
            f.batch_id::text AS batch_id,
            p.department_id,
            p.uploaded_by
          FROM design.fixtures f
          JOIN design.projects p ON p.id = f.project_id
          WHERE f.id = $1
          LIMIT 1
        `,
        [requestedFixtureId],
      );
      fixtureContext = fixtureResult.rows[0] || null;
      if (!projectContext && fixtureContext?.project_id) {
        projectContext = {
          project_id: fixtureContext.project_id,
          department_id: fixtureContext.department_id,
          uploaded_by: fixtureContext.uploaded_by,
        };
      }
    }

    console.info("[project-visibility]", {
      event,
      requested_fixture_id: requestedFixtureId,
      requested_project_id: requestedProjectId || fixtureContext?.project_id || null,
      requested_department_id: requestedDepartmentId,
      current_user_id: currentUserId,
      current_employee_id: currentEmployeeId,
      uploader_id: projectContext?.uploaded_by || fixtureContext?.uploaded_by || null,
      accessible_user_ids: accessibleUserIds,
      accessible_project_ids: accessibleProjectIds,
      generated_query_filter: queryFilter,
      permission_result: permissionResult,
      project_context: projectContext,
      fixture_context: fixtureContext,
    });
  } catch (error) {
    console.warn("[project-visibility] diagnostic logging failed", {
      event,
      requested_fixture_id: requestedFixtureId,
      requested_project_id: requestedProjectId,
      error: error?.message || "Unknown error",
    });
  }
}

async function listProjectOptionsByDepartment(departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id,
        COALESCE(p.status, $2) AS project_status
      FROM design.projects p
      WHERE p.department_id = $1
        AND ($3::boolean = FALSE OR COALESCE(p.status, $2) = $2)
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [departmentId, PROJECT_STATUSES.ACTIVE, activeOnly === true],
  );

  return result.rows.map(mapProjectOptionRow);
}

async function listProjectOptionsForUser(user, departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id,
        COALESCE(p.status, $4) AS project_status
      FROM design.projects p
      WHERE p.department_id = $2
        AND ${visibleProjectPredicate("p")}
        AND ($3::boolean = FALSE OR COALESCE(p.status, $4) = $4)
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [user.employee_id, departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows.map(mapProjectOptionRow);
}

async function countProjectsByDepartment(departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM design.projects
      WHERE department_id = $1
        AND ($2::boolean = FALSE OR COALESCE(status, $3) = $3)
    `,
    [departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
  );

  return Number(result.rows[0]?.count || 0);
}

async function getProjectStatusById(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT COALESCE(status, $2) AS status
      FROM design.projects
      WHERE id = $1
      LIMIT 1
    `,
    [projectId, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows[0]?.status || null;
}

async function listProjectSummariesForUser(user, { departmentId = null } = {}, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id,
        d.name AS department_name,
        COALESCE(p.status, $3) AS project_status,
        p.uploaded_by,
        p.team_lead_id,
        p.project_leader_id,
        team_lead.name AS team_lead_name,
        project_leader.name AS project_leader_name,
        uploader.name AS uploaded_by_name,
        p.created_at,
        p.updated_at,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_fixtures,
        COALESCE(active_stats.active_fixtures, 0)::integer AS active_tasks,
        COALESCE(pending_stats.pending_fixtures, 0)::integer AS pending_tasks,
        0::integer AS total_tasks,
        0::integer AS completed_tasks
      FROM design.projects p
      LEFT JOIN departments d
        ON d.id = p.department_id
      LEFT JOIN users team_lead
        ON team_lead.employee_id = p.team_lead_id
      LEFT JOIN users uploader
        ON uploader.employee_id = p.uploaded_by
      LEFT JOIN users project_leader
        ON project_leader.employee_id = p.project_leader_id
      LEFT JOIN LATERAL (
        -- Total non-archived fixtures (operational truth)
        SELECT COUNT(*)::integer AS total_fixtures
        FROM design.fixtures f1
        WHERE f1.project_id = p.id
          AND COALESCE(f1.status, 'active') <> 'archived'
      ) fixture_stats ON TRUE
      LEFT JOIN LATERAL (
        -- Active fixtures: assigned OR in workflow progress OR under active operational work
        SELECT COUNT(*)::integer AS active_fixtures
        FROM design.fixtures f2
        WHERE f2.project_id = p.id
          AND COALESCE(f2.status, 'active') <> 'archived'
          AND (
            EXISTS (
              SELECT 1 FROM fixture_workflow_progress fwp
              WHERE fwp.fixture_id = f2.id
                AND fwp.department_id = p.department_id
                AND fwp.status IN ('assigned', 'in_progress', 'under_review', 'rework')
            )
            OR EXISTS (
              SELECT 1 FROM fixture_workflow_progress fwp
              WHERE fwp.fixture_id = f2.id
                AND fwp.department_id = p.department_id
                AND fwp.assigned_to IS NOT NULL
            )
          )
      ) active_stats ON TRUE
      LEFT JOIN LATERAL (
        -- Pending fixtures: no workflow progress recorded (awaiting initiation)
        SELECT COUNT(*)::integer AS pending_fixtures
        FROM design.fixtures f3
        WHERE f3.project_id = p.id
          AND COALESCE(f3.status, 'active') <> 'archived'
          AND NOT EXISTS (
            SELECT 1 FROM fixture_workflow_progress fwp
            WHERE fwp.fixture_id = f3.id
              AND fwp.department_id = p.department_id
          )
      ) pending_stats ON TRUE
      WHERE ($2::text IS NULL OR p.department_id = $2)
        AND ${visibleProjectPredicate("p")}
      ORDER BY
        CASE COALESCE(p.status, $3)
          WHEN $3 THEN 0
          WHEN $5 THEN 1
          WHEN $4 THEN 2
          ELSE 3
        END,
        p.updated_at DESC,
        p.created_at DESC,
        p.project_no ASC
    `,
    [
      user.employee_id,
      departmentId || null,
      PROJECT_STATUSES.ACTIVE,
      PROJECT_STATUSES.COMPLETED,
      PROJECT_STATUSES.ON_HOLD,
    ],
  );

  const { enrichProjectSummariesWithCompletionTruth } = require("../services/designCompletion/designCompletionEngine");
  const enrichedRows = await enrichProjectSummariesWithCompletionTruth(
    result.rows.map(mapProjectSummaryRow).filter(Boolean),
    client,
  );

  return enrichedRows;
}

async function findProjectByIdForDepartment(projectId, departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS project_id,
        project_no,
        COALESCE(NULLIF(BTRIM(project_name), ''), project_no) AS project_name,
        customer_name,
        department_id,
        COALESCE(status, $3) AS project_status
      FROM design.projects
      WHERE id = $1
        AND department_id = $2
        AND ($4::boolean = FALSE OR COALESCE(status, $3) = $3)
      LIMIT 1
    `,
    [projectId, departmentId, PROJECT_STATUSES.ACTIVE, activeOnly === true],
  );

  return mapProjectOptionRow(result.rows[0]);
}

async function findProjectByIdForUser(projectId, user, departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id,
        COALESCE(p.status, $4) AS project_status
      FROM design.projects p
      WHERE p.id = $2
        AND p.department_id = $3
        AND ${visibleProjectPredicate("p")}
        AND ($5::boolean = FALSE OR COALESCE(p.status, $4) = $4)
      LIMIT 1
    `,
    [user.employee_id, projectId, departmentId, PROJECT_STATUSES.ACTIVE, activeOnly === true],
  );

  const project = mapProjectOptionRow(result.rows[0]);
  await logVisibilityDecision({
    event: "find_project_by_id_for_user",
    user,
    requestedProjectId: projectId,
    requestedDepartmentId: departmentId,
    queryFilter: "p.id = $2 AND p.department_id = $3 AND p.uploaded_by IN GetAccessibleUserIds($1)",
    permissionResult: Boolean(project),
    client,
  });

  return project;
}

async function findProjectByNumberForDepartment(projectNo, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS project_id,
        project_no,
        project_name,
        customer_name,
        department_id,
        COALESCE(status, $3) AS project_status,
        uploaded_by,
        created_at,
        updated_at
      FROM design.projects
      WHERE project_no = $1
        AND department_id = $2
      LIMIT 1
    `,
    [projectNo, departmentId, PROJECT_STATUSES.ACTIVE],
  );

  return mapDesignProjectRow(result.rows[0]);
}

async function listDepartmentProjectsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE p.department_id = $1
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [departmentId],
  );

  return result.rows.map(mapDepartmentProjectRow);
}

async function listDepartmentProjectsForUser(user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.project_name AS project_description,
        COALESCE(p.status, $3) AS project_status,
        (
          SELECT COUNT(*)::integer
          FROM design.fixtures visible_fixture
          WHERE visible_fixture.project_id = p.id
            AND ${visibleFixturePredicate("visible_fixture", "p")}
        ) AS instance_count,
        NULL::text AS quantity_index,
        NULL::date AS rework_date,
        p.department_id,
        p.uploaded_by,
        p.created_at,
        p.updated_at
      FROM design.projects p
      WHERE p.department_id = $2
        AND ${visibleProjectPredicate("p")}
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [user.employee_id, departmentId, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows.map(mapDepartmentProjectRow);
}

async function findDepartmentProjectByIdForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE p.id = $1
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
      ON CONFLICT (project_no, department_id) DO UPDATE
      SET project_name = EXCLUDED.project_name,
          customer_name = EXCLUDED.customer_name,
          uploaded_by = EXCLUDED.uploaded_by,
          updated_at = NOW()
      RETURNING
        id AS project_id,
        project_no,
        project_name,
        customer_name,
        department_id,
        COALESCE(status, '${PROJECT_STATUSES.ACTIVE}') AS project_status,
        uploaded_by,
        created_at,
        updated_at
    `,
    [
      project.project_no,
      project.project_name,
      project.customer_name,
      project.department_id,
      project.uploaded_by || null,
    ],
  );

  return mapDesignProjectRow(insertedProject.rows[0]);
}

async function listFixturesByProjectForDepartment(projectId, departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete,
        current_progress.stage_name AS workflow_stage,
        current_progress.stage_name AS workflow_stage_label,
        current_progress.stage_order AS workflow_stage_order,
        current_progress.total_stages AS workflow_stage_total,
        current_progress.stage_version AS workflow_stage_version,
        current_progress.status AS workflow_status,
        current_progress.assigned_to AS workflow_assigned_to,
        workflow_assignee.name AS workflow_assigned_to_name
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      LEFT JOIN LATERAL (
        SELECT
          fwp.stage_name,
          fwp.stage_order,
          fwp.stage_version,
          fwp.status,
          fwp.assigned_to,
          COUNT(*) OVER()::integer AS total_stages
        FROM fixture_workflow_progress fwp
        WHERE fwp.fixture_id = di.id
          AND fwp.department_id = dp.department_id
        ORDER BY
          CASE WHEN fwp.status <> 'APPROVED' THEN 0 ELSE 1 END ASC,
          CASE WHEN fwp.status <> 'APPROVED' THEN fwp.stage_order END ASC NULLS LAST,
          CASE WHEN fwp.status = 'APPROVED' THEN fwp.stage_order END DESC NULLS LAST
        LIMIT 1
      ) current_progress ON TRUE
      LEFT JOIN users workflow_assignee
        ON workflow_assignee.employee_id = current_progress.assigned_to
     WHERE dp.id = $1
       AND dp.department_id = $2
       AND ($3::boolean = FALSE OR COALESCE(dp.status, $4) = $4)
     ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [projectId, departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function listFixturesByProjectForUser(projectId, user, departmentId, { activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete,
        current_progress.stage_name AS workflow_stage,
        current_progress.stage_name AS workflow_stage_label,
        current_progress.stage_order AS workflow_stage_order,
        current_progress.total_stages AS workflow_stage_total,
        current_progress.stage_version AS workflow_stage_version,
        current_progress.status AS workflow_status,
        current_progress.assigned_to AS workflow_assigned_to,
        workflow_assignee.name AS workflow_assigned_to_name
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      LEFT JOIN LATERAL (
        SELECT
          fwp.stage_name,
          fwp.stage_order,
          fwp.stage_version,
          fwp.status,
          fwp.assigned_to,
          COUNT(*) OVER()::integer AS total_stages
        FROM fixture_workflow_progress fwp
        WHERE fwp.fixture_id = di.id
          AND fwp.department_id = dp.department_id
        ORDER BY
          CASE WHEN fwp.status <> 'APPROVED' THEN 0 ELSE 1 END ASC,
          CASE WHEN fwp.status <> 'APPROVED' THEN fwp.stage_order END ASC NULLS LAST,
          CASE WHEN fwp.status = 'APPROVED' THEN fwp.stage_order END DESC NULLS LAST
        LIMIT 1
      ) current_progress ON TRUE
      LEFT JOIN users workflow_assignee
        ON workflow_assignee.employee_id = current_progress.assigned_to
      WHERE dp.id = $2
        AND dp.department_id = $3
        AND ${visibleFixturePredicate("di", "dp")}
        AND ($4::boolean = FALSE OR COALESCE(dp.status, $5) = $5)
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [user.employee_id, projectId, departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function findFixtureByIdForDepartment(fixtureId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
    [fixtureId, departmentId],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

async function findFixtureByIdForUser(fixtureId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $2
        AND dp.department_id = $3
        AND ${visibleFixturePredicate("di", "dp")}
      LIMIT 1
    `,
    [user.employee_id, fixtureId, departmentId],
  );

  const fixture = mapFixtureOptionRow(result.rows[0]);
  await logVisibilityDecision({
    event: "find_fixture_by_id_for_user",
    user,
    requestedFixtureId: fixtureId,
    requestedDepartmentId: departmentId,
    queryFilter: "di.id = $2 AND dp.department_id = $3 AND dp.uploaded_by IN GetAccessibleUserIds($1)",
    permissionResult: Boolean(fixture),
    client,
  });

  return fixture;
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
  // Batch continuity: reuse a single active operational batch per project.
  // Find the active batch (most recent) and lock it for update to avoid races.
  const existing = await client.query(
    `
      SELECT id
      FROM design.upload_batches
      WHERE project_id = $1
        AND COALESCE(status, 'active') = 'active'
      ORDER BY uploaded_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `,
    [batchData.project_id],
  );

  const existingId = existing.rows[0]?.id || null;
  if (existingId) {
    const update = await client.query(
      `
        UPDATE design.upload_batches
        SET uploaded_by = $2,
            uploaded_by_user_id = $3,
            uploaded_at = NOW(),
            total_rows = COALESCE(total_rows, 0) + $4,
            accepted_rows = COALESCE(accepted_rows, 0) + $5,
            rejected_rows = COALESCE(rejected_rows, 0) + $6
        WHERE id = $1
        RETURNING id
      `,
      [
        existingId,
        batchData.uploaded_by,
        batchData.uploaded_by_user_id || batchData.uploaded_by || null,
        Number(batchData.total_rows || 0),
        Number(batchData.accepted_rows || 0),
        Number(batchData.rejected_rows || 0),
      ],
    );

    // Defensive cleanup: archive any other active batches for this project (shouldn't normally exist)
    await client.query(
      `
        UPDATE design.upload_batches
        SET status = 'archived'
        WHERE project_id = $1
          AND id <> $2
          AND COALESCE(status, 'active') = 'active'
      `,
      [batchData.project_id, existingId],
    );

    return requireRow(update, "Upload batch update did not return an id").id;
  }

  // No active operational batch exists -> create a new active batch
  const insert = await client.query(
    `
      INSERT INTO design.upload_batches (
        project_id,
        uploaded_by,
        uploaded_by_user_id,
        total_rows,
        accepted_rows,
        rejected_rows,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING id
    `,
    [
      batchData.project_id,
      batchData.uploaded_by,
      batchData.uploaded_by_user_id || batchData.uploaded_by || null,
      Number(batchData.total_rows || 0),
      Number(batchData.accepted_rows || 0),
      Number(batchData.rejected_rows || 0),
    ],
  );

  return requireRow(insert, "Upload batch insert did not return an id").id;
}

async function createUploadErrors(batchId, errors, client = pool) {
  if (!errors || errors.length === 0) {
    return;
  }

  for (const error of errors) {
    await client.query(
      `
        INSERT INTO design.upload_errors (batch_id, row_number, excel_row, row_reference, error_message, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        batchId,
        error.row_number,
        error.excel_row || null,
        error.row_reference || null,
        error.error_message,
        error.raw_data ? JSON.stringify(error.raw_data) : null,
      ],
    );
  }
}

async function createUploadRowCorrections(batchId, corrections, client = pool) {
  if (!Array.isArray(corrections) || corrections.length === 0) {
    return;
  }

  for (const correction of corrections) {
    await client.query(
      `
        INSERT INTO design.upload_row_corrections (
          batch_id,
          row_reference,
          row_number,
          excel_row,
          correction_reason,
          correction_result,
          original_data,
          corrected_data,
          corrected_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
      `,
      [
        batchId,
        correction.row_reference,
        correction.row_number || null,
        correction.excel_row || null,
        correction.correction_reason || null,
        correction.correction_result || "accepted",
        JSON.stringify(correction.original_data || {}),
        JSON.stringify(correction.corrected_data || {}),
        correction.corrected_by,
      ],
    );
  }
}

async function findFixturesByProjectForDedupe(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS fixture_id,
        project_id,
        batch_id,
        fixture_no,
        op_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        revision_no,
        is_legacy_workflow
      FROM design.fixtures
      WHERE project_id = $1
    `,
    [projectId],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function listFixturesByUploadBatchForDepartment(batchId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        di.id AS fixture_id,
        di.fixture_no,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.revision_no,
        di.is_legacy_workflow
      FROM design.fixtures di
      JOIN design.upload_batches ub
        ON ub.id = di.batch_id
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE ub.id = $1
        AND dp.department_id = $2
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [batchId, departmentId],
  );

  return result.rows.map((row) => ({
    fixture_id: row.fixture_id,
    fixture_no: row.fixture_no,
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
  }));
}

async function listFixturesByUploadBatchForUser(batchId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.fixture_no,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.revision_no,
        di.is_legacy_workflow
      FROM design.fixtures di
      JOIN design.upload_batches ub
        ON ub.id = di.batch_id
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE ub.id = $2
        AND dp.department_id = $3
        AND ${visibleFixturePredicate("di", "dp")}
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [user.employee_id, batchId, departmentId],
  );

  return result.rows.map((row) => ({
    fixture_id: row.fixture_id,
    fixture_no: row.fixture_no,
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
  }));
}

async function updateFixtureReferenceImageForDepartment({
  fixtureId,
  departmentId,
  imageType,
  imageUrl,
}, client = pool) {
  const resolvedColumn =
    imageType === "part" ? "image_1_url"
      : imageType === "fixture" ? "image_2_url"
        : null;

  if (!resolvedColumn) {
    throw new AppError(400, "Invalid image_type. Expected 'part' or 'fixture'");
  }

  const selectResult = await client.query(
    `
      SELECT
        di.fixture_no,
        di.${resolvedColumn} AS previous_image_url
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
    [fixtureId, departmentId],
  );

  if (!selectResult.rows[0]) {
    throw new AppError(404, "Fixture not found");
  }

  const previousImageUrl = selectResult.rows[0].previous_image_url || null;
  const fixtureNo = selectResult.rows[0].fixture_no;

  await client.query(
    `
      UPDATE design.fixtures
      SET ${resolvedColumn} = $1,
          updated_at = NOW()
      WHERE id = $2
    `,
    [imageUrl, fixtureId],
  );

  return {
    fixture_no: fixtureNo,
    previous_image_url: previousImageUrl,
    new_image_url: imageUrl,
  };
}

async function upsertFixture(fixtureData, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.fixtures (
        project_id,
        fixture_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        batch_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (project_id, fixture_no) DO UPDATE
      SET
        project_id = EXCLUDED.project_id,
        part_name = EXCLUDED.part_name,
        fixture_type = EXCLUDED.fixture_type,
        remark = EXCLUDED.remark,
        qty = EXCLUDED.qty,
        image_1_url = EXCLUDED.image_1_url,
        image_2_url = EXCLUDED.image_2_url,
        ingestion_source = EXCLUDED.ingestion_source,
        batch_id = EXCLUDED.batch_id,
        updated_at = NOW()
      RETURNING
        id AS fixture_id,
        project_id,
        batch_id,
        fixture_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        revision_no,
        is_legacy_workflow
    `,
    [
      fixtureData.project_id,
      fixtureData.fixture_no,
      fixtureData.part_name,
      fixtureData.fixture_type,
      fixtureData.remark || null,
      fixtureData.qty,
      fixtureData.image_1_url || null,
      fixtureData.image_2_url || null,
      fixtureData.ingestion_source || null,
      fixtureData.batch_id || null,
    ],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

module.exports = instrumentModuleExports("repository.designProjectCatalogRepository", {
  countProjectsByDepartment,
  createUploadBatch,
  createUploadErrors,
  createUploadRowCorrections,
  findDepartmentProjectByIdForDepartment,
  findFixtureByIdForDepartment,
  findFixtureByIdForUser,
  findFixturesByProjectForDedupe,
  findProjectByIdForDepartment,
  findProjectByIdForUser,
  findProjectByNumberForDepartment,
  getProjectStatusById,
  listDepartmentProjectsByDepartment,
  listDepartmentProjectsForUser,
  listFixturesByProjectForDepartment,
  listFixturesByProjectForUser,
  listFixturesByUploadBatchForDepartment,
  listFixturesByUploadBatchForUser,
  listProjectSummariesForUser,
  listProjectOptionsByDepartment,
  listProjectOptionsForUser,
  touchProject,
  updateFixtureReferenceImageForDepartment,
  upsertFixture,
  upsertProjectByNumber,
});
