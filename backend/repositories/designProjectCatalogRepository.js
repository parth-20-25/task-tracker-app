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
  owningLeaderPairSql,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("./projectVisibility");
const {
  activeTaskLateral,
  currentProgressLateral,
  operationalStateSqlCase,
} = require("../services/operationalStateResolver");
const {
  userIdentifierMatchSql,
  userResolutionLateralSql,
} = require("./sqlFragments");
const {
  canCompleteWorkflowAfterOutsource,
  getOutsourceCompletionAutoApproveStageNames,
  OUTSOURCE_STATUSES,
  normalizeSupplierName,
  resolveOutsourceStageCompletion,
} = require("../lib/outsourceWorkflow");

const FIXTURE_OUTSOURCE_JOIN = `
      LEFT JOIN LATERAL (
        SELECT *
        FROM design.fixture_outsource_records outsource_record
        WHERE outsource_record.fixture_id = di.id
        ORDER BY
          CASE outsource_record.outsource_status
            WHEN '${OUTSOURCE_STATUSES.OUTSOURCED}' THEN 0
            WHEN '${OUTSOURCE_STATUSES.COMPLETED}' THEN 1
            WHEN '${OUTSOURCE_STATUSES.BROUGHT_IN_HOUSE}' THEN 2
            ELSE 3
          END,
          outsource_record.updated_at DESC NULLS LAST,
          outsource_record.outsourced_at DESC NULLS LAST,
          outsource_record.created_at DESC NULLS LAST
        LIMIT 1
      ) outsource ON TRUE
`;

const FIXTURE_OUTSOURCE_SELECT = `
        CASE
          WHEN outsource.outsource_status IN ('${OUTSOURCE_STATUSES.OUTSOURCED}', '${OUTSOURCE_STATUSES.COMPLETED}') THEN TRUE
          WHEN outsource.outsource_status = '${OUTSOURCE_STATUSES.BROUGHT_IN_HOUSE}' THEN FALSE
          ELSE di.is_outsourced
        END AS is_outsourced,
        COALESCE(outsource.supplier_name, di.vendor_name) AS vendor_name,
        COALESCE(outsource.outsource_status, CASE WHEN di.is_outsourced THEN '${OUTSOURCE_STATUSES.OUTSOURCED}' ELSE NULL END) AS outsource_status,
        outsource.outsourced_stages,
        COALESCE(outsource.outsourced_at, di.outsourced_at) AS outsourced_at,
        COALESCE(outsource.outsourced_by, di.outsourced_by) AS outsourced_by,
        outsource.completed_by,
        outsource.completed_at,
        outsource.brought_in_house_by,
        outsource.brought_in_house_at,
        outsource.created_at AS outsource_created_at,
        outsource.updated_at AS outsource_updated_at
`;

const FIXTURE_REVISION_PROGRESS_JOIN = `
      LEFT JOIN LATERAL (
        SELECT
          fwp.stage_name,
          fwp.stage_version
        FROM fixture_workflow_progress fwp
        WHERE fwp.fixture_id = di.id
          AND fwp.department_id = dp.department_id
          AND LOWER(BTRIM(REGEXP_REPLACE(COALESCE(fwp.stage_name, ''), '[^[:alnum:]]+', '_', 'g'), '_')) NOT IN ('release', 'released')
        ORDER BY fwp.stage_order DESC NULLS LAST
        LIMIT 1
      ) revision_progress ON TRUE
`;

const FIXTURE_RELEASE_SNAPSHOT_JOIN = `
      LEFT JOIN LATERAL (
        SELECT payload, captured_at
        FROM design.workflow_completion_snapshots snapshot
        WHERE snapshot.fixture_id = di.id
          AND snapshot.scope = 'fixture'
          AND snapshot.trigger = 'workflow_release'
        ORDER BY snapshot.captured_at DESC, snapshot.id DESC
        LIMIT 1
      ) release_snapshot ON TRUE
      LEFT JOIN users workflow_release_actor
        ON ${userIdentifierMatchSql(
          "workflow_release_actor",
          "COALESCE(release_snapshot.payload #>> '{release,released_by}', release_snapshot.payload ->> 'released_by')",
        )}
`;

const FIXTURE_RELEASE_SELECT = `
        CASE
          WHEN di.is_workflow_complete IS TRUE
            OR LOWER(BTRIM(REGEXP_REPLACE(COALESCE(current_progress.stage_name, ''), '[^[:alnum:]]+', '_', 'g'), '_')) IN ('release', 'released')
          THEN revision_progress.stage_name
          ELSE current_progress.stage_name
        END AS workflow_revision_stage,
        CASE
          WHEN di.is_workflow_complete IS TRUE
            OR LOWER(BTRIM(REGEXP_REPLACE(COALESCE(current_progress.stage_name, ''), '[^[:alnum:]]+', '_', 'g'), '_')) IN ('release', 'released')
          THEN revision_progress.stage_version
          ELSE current_progress.stage_version
        END AS workflow_revision_stage_version,
        release_snapshot.captured_at AS workflow_released_at,
        COALESCE(release_snapshot.payload #>> '{release,released_by}', release_snapshot.payload ->> 'released_by') AS workflow_released_by,
        workflow_release_actor.name AS workflow_released_by_name
`;

const FIXTURE_OUTSOURCE_FALLBACK_SELECT = `
        COALESCE(di.is_outsourced, FALSE) AS is_outsourced,
        di.vendor_name AS vendor_name,
        CASE WHEN COALESCE(di.is_outsourced, FALSE) THEN '${OUTSOURCE_STATUSES.OUTSOURCED}' ELSE NULL END AS outsource_status,
        NULL::text[] AS outsourced_stages,
        di.outsourced_at,
        di.outsourced_by,
        NULL::varchar(50) AS completed_by,
        NULL::timestamptz AS completed_at,
        NULL::varchar(50) AS brought_in_house_by,
        NULL::timestamptz AS brought_in_house_at,
        NULL::timestamptz AS outsource_created_at,
        NULL::timestamptz AS outsource_updated_at
`;

const FIXTURE_RELEASE_FALLBACK_SELECT = `
        NULL::text AS workflow_revision_stage,
        NULL::integer AS workflow_revision_stage_version,
        NULL::timestamptz AS workflow_released_at,
        NULL::varchar(50) AS workflow_released_by,
        NULL::text AS workflow_released_by_name
`;

function fixtureOptionalFragments(includeOptionalTables = true) {
  return includeOptionalTables
    ? {
        outsourceSelect: FIXTURE_OUTSOURCE_SELECT,
        outsourceJoin: FIXTURE_OUTSOURCE_JOIN,
        releaseSelect: FIXTURE_RELEASE_SELECT,
        revisionProgressJoin: FIXTURE_REVISION_PROGRESS_JOIN,
        releaseSnapshotJoin: FIXTURE_RELEASE_SNAPSHOT_JOIN,
      }
    : {
        outsourceSelect: FIXTURE_OUTSOURCE_FALLBACK_SELECT,
        outsourceJoin: "",
        releaseSelect: FIXTURE_RELEASE_FALLBACK_SELECT,
        revisionProgressJoin: "",
        releaseSnapshotJoin: "",
      };
}

function isMissingOptionalFixtureRelation(error) {
  if (error?.code !== "42P01") {
    return false;
  }

  const relation = String(error.relation || error.message || "");
  return relation.includes("fixture_outsource_records")
    || relation.includes("workflow_completion_snapshots");
}

const DEPARTMENT_PROJECT_SELECT = `
  SELECT
    p.id AS project_id,
    p.project_no,
    COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
    p.customer_name,
    p.project_name AS project_description,
    COALESCE(p.status, '${PROJECT_STATUSES.ACTIVE}') AS project_status,
    COALESCE(p.is_modified, FALSE) AS is_modified,
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

function collapseProjectLabel(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLegacyWbsPrefix(value) {
  return collapseProjectLabel(value).replace(/^WBS\s*[-_]?\s*/i, "");
}

function normalizeProjectNo(value) {
  return stripLegacyWbsPrefix(value)
    .replace(/\s+/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toUpperCase();
}

function normalizeProjectName(value) {
  return stripLegacyWbsPrefix(value);
}

function mapDepartmentProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id || null,
    project_code: normalizeProjectNo(row.project_no),
    project_name: normalizeProjectName(row.project_name),
    company_name: row.customer_name,
    project_description: row.project_description,
    quantity_index: row.quantity_index,
    instance_count: row.instance_count === null || row.instance_count === undefined
      ? 0
      : Number(row.instance_count),
    rework_date: row.rework_date || null,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    is_modified: row.is_modified === true,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    was_created: row.was_created === true,
  };
}

function mapDesignProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id,
    project_code: normalizeProjectNo(row.project_no),
    project_name: normalizeProjectName(row.project_name),
    company_name: row.customer_name,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    is_modified: row.is_modified === true,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    was_created: row.was_created === true,
  };
}

function mapProjectOptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id,
    project_code: normalizeProjectNo(row.project_no),
    project_name: normalizeProjectName(row.project_name),
    company_name: row.customer_name,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    is_modified: row.is_modified === true,
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

function parseTextArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .replace(/^{|}$/g, "")
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

function mapProjectSummaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id,
    project_no: normalizeProjectNo(row.project_no),
    project_name: normalizeProjectName(row.project_name),
    customer_name: row.customer_name,
    department_id: row.department_id,
    department_name: row.department_name || null,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    is_modified: row.is_modified === true,
    completion_percent: normalizeProjectCompletionPercent(row),
    completion_truth_status: row.completion_truth_status || null,
    completion_strict_complete: row.completion_strict_complete === true,
    completion_truth_errors: Array.isArray(row.completion_truth_errors) ? row.completion_truth_errors : [],
    overall_stage: row.overall_stage || null,
    progress_diagnostics: Array.isArray(row.progress_diagnostics) ? row.progress_diagnostics : [],
    total_fixtures: Number(row.total_fixtures || 0),
    total_tasks: Number(row.total_tasks || 0),
    pending_tasks: Number(row.pending_tasks || 0),
    active_tasks: Number(row.active_tasks || 0),
    completed_tasks: Number(row.completed_tasks || 0),
    project_created_by_user_id: row.project_created_by_user_id || null,
    project_uploaded_by: row.project_uploaded_by || null,
    uploaded_by: row.uploaded_by || null,
    uploaded_by_user_id: row.uploaded_by_user_id || row.uploaded_by || null,
    team_lead_id: row.team_lead_id || null,
    team_lead_name: row.team_lead_name || null,
    uploaded_by_name: row.uploaded_by_name || null,
    can_manage_project: row.can_manage_project === true,
    can_toggle_modification: row.can_toggle_modification === true,
    can_edit_project: row.can_edit_project === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapFixtureOptionRow(row) {
  if (!row) {
    return null;
  }

  const stageVersion = normalizeStageVersion(row.workflow_stage_version);
  const revisionStage = row.workflow_revision_stage || row.workflow_stage;
  const revisionStageVersion = normalizeStageVersion(
    row.workflow_revision_stage ? row.workflow_revision_stage_version : row.workflow_stage_version,
  );
  const workflowRevisionCode = row.workflow_revision_code
    || (revisionStage ? formatStageRevisionCode(revisionStage, revisionStageVersion) : null);
  const workflowStatus = row.workflow_status || null;
  const outsourceStatus = row.outsource_status || (row.is_outsourced === true ? OUTSOURCE_STATUSES.OUTSOURCED : null);

  return {
    fixture_id: row.fixture_id || row.id,
    project_id: row.project_id || null,
    department_id: row.department_id || null,
    batch_id: row.batch_id || null,
    fixture_no: row.fixture_no,
    op_no: row.op_no || null,
    part_name: row.part_name,
    fixture_type: row.fixture_type,
    remark: row.remark || null,
    qty: Number(row.qty),
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
    is_outsourced: row.is_outsourced === true,
    vendor_name: row.vendor_name || null,
    outsourced_stages: parseTextArray(row.outsourced_stages),
    outsource_status: outsourceStatus,
    outsourced_at: row.outsourced_at || null,
    outsourced_by: row.outsourced_by || null,
    completed_by: row.completed_by || null,
    completed_at: row.completed_at || null,
    brought_in_house_by: row.brought_in_house_by || null,
    brought_in_house_at: row.brought_in_house_at || null,
    outsource_created_at: row.outsource_created_at || null,
    outsource_updated_at: row.outsource_updated_at || null,
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
    operational_state: row.operational_state || "UNASSIGNED",
    workflow_assigned_to: row.workflow_assigned_to || null,
    workflow_assigned_to_name: row.workflow_assigned_to_name || null,
    workflow_released_at: row.workflow_released_at || null,
    workflow_released_by: row.workflow_released_by || null,
    workflow_released_by_name: row.workflow_released_by_name || null,
    workflow_progress_percent: row.workflow_progress_percent === null || row.workflow_progress_percent === undefined
      ? null
      : Number(row.workflow_progress_percent),
    workflow_stage_active: row.operational_state === "IN_PROGRESS" || row.operational_state === "ASSIGNED",
    review_pending: row.operational_state === "VERIFICATION",
    blocked: workflowStatus === "REJECTED" || row.operational_state === "REWORK",
  };
}

function requireRow(result, errorMessage) {
  const row = result?.rows?.[0];

  if (!row) {
    throw new Error(errorMessage);
  }

  return row;
}

function sqlRoleKey(expression) {
  return `LOWER(BTRIM(REGEXP_REPLACE(COALESCE(${expression}, ''), '[^[:alnum:]]+', '_', 'g'), '_'))`;
}

function fixtureOperationalStatsLateral(projectAlias = "p", { includeOptionalTables = true } = {}) {
  const stateCase = operationalStateSqlCase({
    fixtureAlias: "f",
    projectAlias,
    taskAlias: "operational_task",
    includeOutsourceCompletionCheck: includeOptionalTables,
  });

  return `
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::integer AS total_fixtures,
          COUNT(*) FILTER (WHERE fixture_state.operational_state = 'WORKFLOW_COMPLETE')::integer AS completed_fixtures,
          COUNT(*) FILTER (WHERE fixture_state.operational_state IN ('VERIFICATION', 'REWORK', 'IN_PROGRESS', 'ASSIGNED'))::integer AS active_fixtures,
          COUNT(*) FILTER (WHERE fixture_state.operational_state = 'UNASSIGNED')::integer AS pending_fixtures
        FROM (
          SELECT
            f.id,
            ${stateCase} AS operational_state
          FROM design.fixtures f
          ${activeTaskLateral("f", "operational_task")}
          ${currentProgressLateral("f", projectAlias, "current_progress")}
          WHERE f.project_id = ${projectAlias}.id
        ) fixture_state
      ) fixture_stats ON TRUE
  `;
}

function hierarchyTeamLeaderLateral(projectAlias = "p") {
  return `
      LEFT JOIN LATERAL (
        WITH RECURSIVE owner_ancestry AS (
          SELECT
            u.id::text AS user_uuid,
            u.employee_id,
            u.name,
            u.parent_id::text AS parent_id,
            ${sqlRoleKey("COALESCE(r.name, u.role)")} AS role_key,
            0::integer AS depth,
            ARRAY[u.id::text, u.employee_id]::text[] AS path
          FROM users u
          LEFT JOIN roles r ON r.id = u.role
          WHERE ${userIdentifierMatchSql("u", `${projectAlias}.created_by_user_id`)}

          UNION ALL

          SELECT
            parent.id::text AS user_uuid,
            parent.employee_id,
            parent.name,
            parent.parent_id::text AS parent_id,
            ${sqlRoleKey("COALESCE(parent_role.name, parent.role)")} AS role_key,
            owner_ancestry.depth + 1,
            owner_ancestry.path || parent.id::text || parent.employee_id
          FROM owner_ancestry
          JOIN users parent
            ON parent.id::text = owner_ancestry.parent_id
            OR parent.employee_id = owner_ancestry.parent_id
          LEFT JOIN roles parent_role ON parent_role.id = parent.role
          WHERE owner_ancestry.depth < 32
            AND NOT parent.id::text = ANY(owner_ancestry.path)
            AND NOT parent.employee_id = ANY(owner_ancestry.path)
        )
        SELECT employee_id, name
        FROM owner_ancestry
        WHERE role_key = 'team_leader'
        ORDER BY depth ASC
        LIMIT 1
      ) hierarchy_team_lead ON TRUE
  `;
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

    const VISIBILITY_DEBUG = process.env.PROJECT_VISIBILITY_DEBUG === "true";

    let projectContext = null;
    if (requestedProjectId) {
      const projectResult = await client.query(
        `
          SELECT id::text AS project_id, department_id, uploaded_by, created_by_user_id
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
            p.uploaded_by,
            p.created_by_user_id
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
          created_by_user_id: fixtureContext.created_by_user_id,
        };
      }
    }

    if (process.env.PROJECT_VISIBILITY_DEBUG === "true") {
      console.info("[project-visibility]", {
        event,
        requested_fixture_id: requestedFixtureId,
        requested_project_id: requestedProjectId || fixtureContext?.project_id || null,
        requested_department_id: requestedDepartmentId,
        current_user_id: currentUserId,
        current_employee_id: currentEmployeeId,
        uploader_id: projectContext?.uploaded_by || fixtureContext?.uploaded_by || null,
        creator_id: projectContext?.created_by_user_id || fixtureContext?.created_by_user_id || null,
        accessible_user_ids: accessibleUserIds,
        accessible_project_ids: accessibleProjectIds,
        generated_query_filter: queryFilter,
        permission_result: permissionResult,
        project_context: projectContext,
        fixture_context: fixtureContext,
      });
    }
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
        COALESCE(p.status, $2) AS project_status,
        COALESCE(p.is_modified, FALSE) AS is_modified
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
        COALESCE(p.status, $4) AS project_status,
        COALESCE(p.is_modified, FALSE) AS is_modified
      FROM design.projects p
      WHERE ($2::text IS NULL OR p.department_id = $2)
        AND ${visibleProjectPredicate("p")}
        AND ($3::boolean = FALSE OR COALESCE(p.status, $4) = $4)
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [user.employee_id, departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows.map(mapProjectOptionRow);
}

async function listRecentOutsourceSuppliersForUser(user, departmentId = null, limit = 6, client = pool) {
  void user;
  void departmentId;
  const boundedLimit = Math.max(1, Math.min(6, Number(limit) || 6));
  let result;
  try {
    result = await client.query(
      `
        SELECT supplier_name
        FROM design.recent_outsource_suppliers
        ORDER BY last_used_at DESC, supplier_name ASC
        LIMIT $1
      `,
      [boundedLimit],
    );
  } catch (error) {
    if (error?.code === "42P01" && String(error.relation || error.message || "").includes("recent_outsource_suppliers")) {
      return [];
    }
    throw error;
  }

  return result.rows.map((row) => row.supplier_name).filter(Boolean);
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

async function getProjectModificationContextForUser(projectId, user, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id,
        COALESCE(p.uploaded_by, p.created_by_user_id) AS uploaded_by,
        p.created_by_user_id,
        COALESCE(p.status, $3) AS project_status,
        COALESCE(p.is_modified, FALSE) AS is_modified,
        ${owningLeaderPairSql("p")} AS can_manage_project,
        ${owningLeaderPairSql("p")} AS can_toggle_modification,
        ${owningLeaderPairSql("p")} AS can_edit_project
      FROM design.projects p
      WHERE p.id = $2
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
    `,
    [user.employee_id, projectId, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows[0] || null;
}

async function updateProjectModificationFlag(projectId, isModified, client = pool) {
  const result = await client.query(
    `
      UPDATE design.projects
      SET is_modified = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id AS project_id,
        project_no,
        COALESCE(NULLIF(BTRIM(project_name), ''), project_no) AS project_name,
        customer_name,
        department_id,
        COALESCE(status, $3) AS project_status,
        COALESCE(is_modified, FALSE) AS is_modified,
        uploaded_by,
        created_by_user_id,
        created_at,
        updated_at
    `,
    [projectId, isModified === true, PROJECT_STATUSES.ACTIVE],
  );

  return mapDesignProjectRow(result.rows[0]);
}

async function listProjectSummariesForUser(user, { departmentId = null } = {}, client = pool) {
  const querySummaries = async (includeOptionalTables) => {
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
        COALESCE(p.is_modified, FALSE) AS is_modified,
        p.created_by_user_id AS project_created_by_user_id,
        p.uploaded_by AS project_uploaded_by,
        COALESCE(uploader.employee_id, p.uploaded_by, p.created_by_user_id) AS uploaded_by,
        COALESCE(uploader.employee_id, p.uploaded_by, p.created_by_user_id) AS uploaded_by_user_id,
        hierarchy_team_lead.employee_id AS team_lead_id,
        hierarchy_team_lead.name AS team_lead_name,
        uploader.name AS uploaded_by_name,
        ${owningLeaderPairSql("p")} AS can_manage_project,
        ${owningLeaderPairSql("p")} AS can_toggle_modification,
        ${owningLeaderPairSql("p")} AS can_edit_project,
        p.created_at,
        p.updated_at,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_fixtures,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_tasks,
        COALESCE(fixture_stats.active_fixtures, 0)::integer AS active_tasks,
        COALESCE(fixture_stats.pending_fixtures, 0)::integer AS pending_tasks,
        COALESCE(fixture_stats.completed_fixtures, 0)::integer AS completed_tasks
      FROM design.projects p
      LEFT JOIN departments d
        ON d.id = p.department_id
      ${userResolutionLateralSql("uploader", [
        { expression: "p.uploaded_by", source: "project_uploaded_by" },
        { expression: "p.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${hierarchyTeamLeaderLateral("p")}
      ${fixtureOperationalStatsLateral("p", { includeOptionalTables })}
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

    return result.rows;
  };

  let rows = null;
  try {
    rows = await querySummaries(true);
  } catch (error) {
    if (!isMissingOptionalFixtureRelation(error)) {
      throw error;
    }
    rows = await querySummaries(false);
  }

  const { enrichProjectSummariesWithCompletionTruth } = require("../services/designCompletion/designCompletionEngine");
  const enrichedRows = await enrichProjectSummariesWithCompletionTruth(
    rows.map(mapProjectSummaryRow).filter(Boolean),
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
        COALESCE(status, $3) AS project_status,
        COALESCE(is_modified, FALSE) AS is_modified
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
        COALESCE(p.status, $4) AS project_status,
        COALESCE(p.is_modified, FALSE) AS is_modified
      FROM design.projects p
      WHERE p.id = $2
        AND ($3::text IS NULL OR p.department_id = $3)
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
    queryFilter: "p.id = $2 AND ($3 IS NULL OR p.department_id = $3) AND p.created_by_user_id IN GetAccessibleUserIds($1)",
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
        COALESCE(is_modified, FALSE) AS is_modified,
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
        COALESCE(p.is_modified, FALSE) AS is_modified,
        (
          SELECT COUNT(*)::integer
          FROM design.fixtures project_fixture
          WHERE project_fixture.project_id = p.id
        ) AS instance_count,
        NULL::text AS quantity_index,
        NULL::date AS rework_date,
        p.department_id,
        p.uploaded_by,
        p.created_at,
        p.updated_at
      FROM design.projects p
      WHERE ($2::text IS NULL OR p.department_id = $2)
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

async function insertProjectByNumber(project, client = pool) {
  const createdByUserId = String(project.created_by_user_id || "").trim();
  if (!createdByUserId) {
    throw new AppError(400, "created_by_user_id is required for design project creation");
  }

  const projectNo = normalizeProjectNo(project.project_no);
  const projectName = normalizeProjectName(project.project_name);
  const customerName = collapseProjectLabel(project.customer_name);

  const result = await client.query(
    `
      INSERT INTO design.projects (
        project_no,
        project_name,
        customer_name,
        department_id,
        uploaded_by,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING
        id AS project_id,
        project_no,
        project_name,
        customer_name,
        department_id,
        COALESCE(status, '${PROJECT_STATUSES.ACTIVE}') AS project_status,
        COALESCE(is_modified, FALSE) AS is_modified,
        uploaded_by,
        created_by_user_id,
        created_at,
        updated_at,
        TRUE AS was_created
    `,
    [
      projectNo,
      projectName,
      customerName,
      project.department_id,
      project.uploaded_by || null,
      createdByUserId,
    ],
  );

  return mapDesignProjectRow(result.rows[0]);
}
async function upsertProjectByNumber(project, client = pool) {
  const createdByUserId = String(project.created_by_user_id || "").trim();
  if (!createdByUserId) {
    throw new AppError(400, "created_by_user_id is required for design project creation");
  }
  const projectNo = normalizeProjectNo(project.project_no);
  const projectName = normalizeProjectName(project.project_name);
  const customerName = collapseProjectLabel(project.customer_name);

  const insertedProject = await client.query(
    `
      WITH existing_project AS (
        SELECT id
        FROM design.projects
        WHERE project_no = $1
          AND department_id = $4
        LIMIT 1
      ),
      upserted_project AS (
        INSERT INTO design.projects (
          project_no,
          project_name,
          customer_name,
          department_id,
          uploaded_by,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
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
          COALESCE(is_modified, FALSE) AS is_modified,
          uploaded_by,
          created_by_user_id,
          created_at,
          updated_at
      )
      SELECT
        upserted_project.*,
        NOT EXISTS (SELECT 1 FROM existing_project) AS was_created
      FROM upserted_project
    `,
    [
      projectNo,
      projectName,
      customerName,
      project.department_id,
      project.uploaded_by || null,
      createdByUserId,
    ],
  );

  return mapDesignProjectRow(insertedProject.rows[0]);
}

async function updateProjectIdentityById(project, client = pool) {
  const projectId = String(project.project_id || "").trim();
  if (!projectId) {
    throw new AppError(400, "project_id is required for design project update");
  }

  const projectNo = normalizeProjectNo(project.project_no);
  const projectName = normalizeProjectName(project.project_name);
  const customerName = collapseProjectLabel(project.customer_name);

  try {
    const result = await client.query(
      `
        UPDATE design.projects
        SET project_no = $2,
            project_name = $3,
            customer_name = $4,
            uploaded_by = $6,
            updated_at = NOW()
        WHERE id::text = $1
          AND department_id = $5
        RETURNING
          id AS project_id,
          project_no,
          project_name,
          customer_name,
          department_id,
          COALESCE(status, '${PROJECT_STATUSES.ACTIVE}') AS project_status,
          COALESCE(is_modified, FALSE) AS is_modified,
          uploaded_by,
          created_by_user_id,
          created_at,
          updated_at,
          FALSE AS was_created
      `,
      [
        projectId,
        projectNo,
        projectName,
        customerName,
        project.department_id,
        project.uploaded_by || null,
      ],
    );

    if (result.rows.length === 0) {
      throw new AppError(404, "Project not found for native edit");
    }

    return mapDesignProjectRow(result.rows[0]);
  } catch (error) {
    if (error?.code === "23505") {
      throw new AppError(409, "Project Number already exists for this department");
    }
    throw error;
  }
}

async function findActiveUploadBatchIdForProject(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT id
      FROM design.upload_batches
      WHERE project_id = $1
        AND COALESCE(status, 'active') = 'active'
      ORDER BY uploaded_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `,
    [projectId],
  );

  return result.rows[0]?.id || null;
}

async function listFixturesByProjectForDepartment(projectId, departmentId, { activeOnly = false } = {}, client = pool) {
  const queryFixtures = async (includeOptionalTables) => {
    const fragments = fixtureOptionalFragments(includeOptionalTables);
    const stateCase = operationalStateSqlCase({
      fixtureAlias: "di",
      projectAlias: "dp",
      taskAlias: "operational_task",
      includeOutsourceCompletionCheck: includeOptionalTables,
    });
    const result = await client.query(
      `
      SELECT
        di.id AS fixture_id,
        di.project_id,
        dp.department_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        ${fragments.outsourceSelect},
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete,
        current_progress.stage_name AS workflow_stage,
        current_progress.stage_name AS workflow_stage_label,
        current_progress.stage_order AS workflow_stage_order,
        current_progress.total_stages AS workflow_stage_total,
        current_progress.stage_version AS workflow_stage_version,
        ${fragments.releaseSelect},
        current_progress.status AS workflow_status,
        COALESCE(operational_task.assigned_to, current_progress.assigned_to) AS workflow_assigned_to,
        COALESCE(operational_task.started_at, current_progress.started_at) AS workflow_started_at,
        ${stateCase} AS operational_state,
        operational_task.id AS operational_task_id,
        operational_task.status AS operational_task_status,
        operational_task.completion_percent AS operational_task_completion_percent,
        operational_task.deadline AS operational_task_deadline,
        operational_task.submitted_at AS operational_task_submitted_at,
        workflow_assignee.name AS workflow_assigned_to_name
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      ${fragments.outsourceJoin}
      ${activeTaskLateral("di", "operational_task")}
      ${currentProgressLateral("di", "dp", "current_progress")}
      ${fragments.revisionProgressJoin}
      ${fragments.releaseSnapshotJoin}
      LEFT JOIN users workflow_assignee
        ON ${userIdentifierMatchSql("workflow_assignee", "COALESCE(operational_task.assigned_to, current_progress.assigned_to)")}
     WHERE dp.id = $1
       AND dp.department_id = $2
       AND ($3::boolean = FALSE OR COALESCE(dp.status, $4) = $4)
      ORDER BY
        CASE ${stateCase}
          WHEN 'VERIFICATION' THEN 1
          WHEN 'REWORK' THEN 2
          WHEN 'UNASSIGNED' THEN 3
          WHEN 'IN_PROGRESS' THEN 4
          WHEN 'ASSIGNED' THEN 5
          WHEN 'WORKFLOW_COMPLETE' THEN 6
          ELSE 7
        END ASC,
       di.fixture_no ASC,
       di.id ASC
    `,
      [projectId, departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
    );

    return result.rows.map(mapFixtureOptionRow);
  };

  try {
    return await queryFixtures(true);
  } catch (error) {
    if (isMissingOptionalFixtureRelation(error)) {
      return queryFixtures(false);
    }
    throw error;
  }
}

async function listFixturesByProjectForUser(projectId, user, departmentId, { activeOnly = false } = {}, client = pool) {
  const queryFixtures = async (includeOptionalTables) => {
    const fragments = fixtureOptionalFragments(includeOptionalTables);
    const stateCase = operationalStateSqlCase({
      fixtureAlias: "di",
      projectAlias: "dp",
      taskAlias: "operational_task",
      includeOutsourceCompletionCheck: includeOptionalTables,
    });
    const result = await client.query(
      `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        dp.department_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        ${fragments.outsourceSelect},
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete,
        current_progress.stage_name AS workflow_stage,
        current_progress.stage_name AS workflow_stage_label,
        current_progress.stage_order AS workflow_stage_order,
        current_progress.total_stages AS workflow_stage_total,
        current_progress.stage_version AS workflow_stage_version,
        ${fragments.releaseSelect},
        current_progress.status AS workflow_status,
        COALESCE(operational_task.assigned_to, current_progress.assigned_to) AS workflow_assigned_to,
        COALESCE(operational_task.started_at, current_progress.started_at) AS workflow_started_at,
        ${stateCase} AS operational_state,
        operational_task.id AS operational_task_id,
        operational_task.status AS operational_task_status,
        operational_task.completion_percent AS operational_task_completion_percent,
        operational_task.deadline AS operational_task_deadline,
        operational_task.submitted_at AS operational_task_submitted_at,
        workflow_assignee.name AS workflow_assigned_to_name
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      ${fragments.outsourceJoin}
      ${activeTaskLateral("di", "operational_task")}
      ${currentProgressLateral("di", "dp", "current_progress")}
      ${fragments.revisionProgressJoin}
      ${fragments.releaseSnapshotJoin}
      LEFT JOIN users workflow_assignee
        ON ${userIdentifierMatchSql("workflow_assignee", "COALESCE(operational_task.assigned_to, current_progress.assigned_to)")}
      WHERE dp.id = $2
        AND ($3::text IS NULL OR dp.department_id = $3)
        AND ${visibleFixturePredicate("di", "dp")}
        AND ($4::boolean = FALSE OR COALESCE(dp.status, $5) = $5)
      ORDER BY
        CASE ${stateCase}
          WHEN 'VERIFICATION' THEN 1
          WHEN 'REWORK' THEN 2
          WHEN 'UNASSIGNED' THEN 3
          WHEN 'IN_PROGRESS' THEN 4
          WHEN 'ASSIGNED' THEN 5
          WHEN 'WORKFLOW_COMPLETE' THEN 6
          ELSE 7
        END ASC,
        di.fixture_no ASC,
        di.id ASC
    `,
      [user.employee_id, projectId, departmentId, activeOnly === true, PROJECT_STATUSES.ACTIVE],
    );

    return result.rows.map(mapFixtureOptionRow);
  };

  try {
    return await queryFixtures(true);
  } catch (error) {
    if (isMissingOptionalFixtureRelation(error)) {
      return queryFixtures(false);
    }
    throw error;
  }
}

async function findFixtureByIdForDepartment(fixtureId, departmentId, client = pool) {
  const queryFixture = async (includeOptionalTables) => {
    const fragments = fixtureOptionalFragments(includeOptionalTables);
    const result = await client.query(
      `
      SELECT
        di.id AS fixture_id,
        di.project_id,
        dp.department_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        ${fragments.outsourceSelect},
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      ${fragments.outsourceJoin}
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
      [fixtureId, departmentId],
    );

    return mapFixtureOptionRow(result.rows[0]);
  };

  try {
    return await queryFixture(true);
  } catch (error) {
    if (isMissingOptionalFixtureRelation(error)) {
      return queryFixture(false);
    }
    throw error;
  }
}

async function findFixtureByIdForUser(fixtureId, user, departmentId, client = pool) {
  const queryFixture = async (includeOptionalTables) => {
    const fragments = fixtureOptionalFragments(includeOptionalTables);
    const result = await client.query(
      `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        dp.department_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        ${fragments.outsourceSelect},
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      ${fragments.outsourceJoin}
      WHERE di.id = $2
        AND ($3::text IS NULL OR dp.department_id = $3)
        AND ${visibleFixturePredicate("di", "dp")}
      LIMIT 1
    `,
      [user.employee_id, fixtureId, departmentId],
    );

    return mapFixtureOptionRow(result.rows[0]);
  };

  let fixture = null;
  try {
    fixture = await queryFixture(true);
  } catch (error) {
    if (!isMissingOptionalFixtureRelation(error)) {
      throw error;
    }
    fixture = await queryFixture(false);
  }
  await logVisibilityDecision({
    event: "find_fixture_by_id_for_user",
    user,
    requestedFixtureId: fixtureId,
    requestedDepartmentId: departmentId,
    queryFilter: "di.id = $2 AND ($3 IS NULL OR dp.department_id = $3) AND dp.created_by_user_id IN GetAccessibleUserIds($1)",
    permissionResult: Boolean(fixture),
    client,
  });

  return fixture;
}

async function findFixtureAssignmentContextByIdForUser(fixtureId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        dp.department_id,
        di.fixture_no,
        di.part_name,
        di.qty,
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $2
        AND ($3::text IS NULL OR dp.department_id = $3)
        AND ${visibleFixturePredicate("di", "dp")}
      LIMIT 1
    `,
    [user.employee_id, fixtureId, departmentId],
  );

  const fixture = result.rows[0] || null;
  await logVisibilityDecision({
    event: "find_fixture_assignment_context_by_id_for_user",
    user,
    requestedFixtureId: fixtureId,
    requestedDepartmentId: departmentId,
    queryFilter: "di.id = $2 AND ($3 IS NULL OR dp.department_id = $3) AND dp.created_by_user_id IN GetAccessibleUserIds($1)",
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
      ON CONFLICT (project_id) WHERE status = 'active'
      DO UPDATE SET
        uploaded_by = EXCLUDED.uploaded_by,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        uploaded_at = NOW(),
        total_rows = COALESCE(design.upload_batches.total_rows, 0) + EXCLUDED.total_rows,
        accepted_rows = COALESCE(design.upload_batches.accepted_rows, 0) + EXCLUDED.accepted_rows,
        rejected_rows = COALESCE(design.upload_batches.rejected_rows, 0) + EXCLUDED.rejected_rows
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
        AND ($3::text IS NULL OR dp.department_id = $3)
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
        AND ($2::text IS NULL OR dp.department_id = $2)
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

async function rememberRecentOutsourceSupplier(supplierName, client = pool) {
  const normalizedSupplierName = normalizeSupplierName(supplierName);
  if (!normalizedSupplierName) {
    return [];
  }

  try {
    await client.query(
      `
        INSERT INTO design.recent_outsource_suppliers (
          supplier_key,
          supplier_name,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES (LOWER($1), $1, NOW(), NOW(), NOW())
        ON CONFLICT (supplier_key) DO UPDATE
        SET supplier_name = EXCLUDED.supplier_name,
            last_used_at = NOW(),
            updated_at = NOW()
      `,
      [normalizedSupplierName],
    );
  } catch (error) {
    if (error?.code === "42P01" && String(error.relation || error.message || "").includes("recent_outsource_suppliers")) {
      return [];
    }
    throw error;
  }

  await client.query(
    `
      WITH ranked_suppliers AS (
        SELECT
          supplier_key,
          ROW_NUMBER() OVER (ORDER BY last_used_at DESC, supplier_name ASC) AS rn
        FROM design.recent_outsource_suppliers
      )
      DELETE FROM design.recent_outsource_suppliers recent
      USING ranked_suppliers ranked
      WHERE recent.supplier_key = ranked.supplier_key
        AND ranked.rn > 6
    `,
  );

  return listRecentOutsourceSuppliersForUser(null, null, 6, client);
}

async function upsertFixtureOutsourceRecord({
  fixtureId,
  supplierName,
  outsourcedStages,
  changedBy,
}, client = pool) {
  const values = [
    fixtureId,
    supplierName,
    outsourcedStages,
    OUTSOURCE_STATUSES.OUTSOURCED,
    changedBy || null,
  ];
  const updateResult = await client.query(
    `
      UPDATE design.fixture_outsource_records
      SET supplier_name = $2,
          outsourced_stages = $3::text[],
          outsource_status = $4,
          outsourced_by = $5,
          outsourced_at = NOW(),
          completed_by = NULL,
          completed_at = NULL,
          brought_in_house_by = NULL,
          brought_in_house_at = NULL,
          updated_at = NOW()
      WHERE fixture_id = $1
      RETURNING *
    `,
    values,
  );

  let record = updateResult.rows[0] || null;

  if (!record) {
    const insertResult = await client.query(
      `
        INSERT INTO design.fixture_outsource_records (
        fixture_id,
        supplier_name,
        outsourced_stages,
        outsource_status,
        outsourced_by,
        outsourced_at,
        completed_by,
        completed_at,
        brought_in_house_by,
        brought_in_house_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::text[], $4, $5, NOW(), NULL, NULL, NULL, NULL, NOW(), NOW())
      RETURNING *
    `,
      values,
    );
    record = insertResult.rows[0] || null;
  }

  await client.query(
    `
      UPDATE design.fixtures
      SET is_outsourced = TRUE,
          vendor_name = $2,
          outsourced_at = NOW(),
          outsourced_by = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [fixtureId, supplierName, changedBy || null],
  );

  await rememberRecentOutsourceSupplier(supplierName, client);

  return record;
}

async function markFixtureOutsourceBroughtInHouse({
  fixtureId,
  changedBy,
}, client = pool) {
  const result = await client.query(
    `
      UPDATE design.fixture_outsource_records
      SET outsource_status = $2,
          brought_in_house_by = $3,
          brought_in_house_at = NOW(),
          updated_at = NOW()
      WHERE fixture_id = $1
      RETURNING *
    `,
    [fixtureId, OUTSOURCE_STATUSES.BROUGHT_IN_HOUSE, changedBy || null],
  );

  await client.query(
    `
      UPDATE design.fixtures
      SET is_outsourced = FALSE,
          vendor_name = NULL,
          outsourced_at = NULL,
          outsourced_by = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [fixtureId],
  );

  return result.rows[0] || null;
}

async function markFixtureOutsourceCompleted({
  fixtureId,
  changedBy,
}, client = pool) {
  const result = await client.query(
    `
      UPDATE design.fixture_outsource_records
      SET outsource_status = $2,
          completed_by = COALESCE(completed_by, $3),
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE fixture_id = $1
        AND outsource_status IN ($4, $2)
      RETURNING *
    `,
    [
      fixtureId,
      OUTSOURCE_STATUSES.COMPLETED,
      changedBy || null,
      OUTSOURCE_STATUSES.OUTSOURCED,
    ],
  );

  const record = result.rows[0] || null;
  if (record) {
    await client.query(
      `
        UPDATE design.fixtures
        SET is_outsourced = TRUE,
            vendor_name = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [fixtureId, record.supplier_name],
    );
  }

  return record;
}

async function getFixtureOutsourceRecordForCompletion(fixtureId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM design.fixture_outsource_records
      WHERE fixture_id = $1
        AND outsource_status IN ($2, $3)
      ORDER BY
        CASE outsource_status
          WHEN $2 THEN 0
          WHEN $3 THEN 1
          ELSE 2
        END,
        updated_at DESC NULLS LAST,
        outsourced_at DESC NULLS LAST,
        created_at DESC NULLS LAST
      LIMIT 1
    `,
    [
      fixtureId,
      OUTSOURCE_STATUSES.OUTSOURCED,
      OUTSOURCE_STATUSES.COMPLETED,
    ],
  );

  return result.rows[0] || null;
}

async function completeCurrentOutsourcedWorkflowStage({
  fixtureId,
  departmentId,
  changedBy,
}, client = pool) {
  const record = await getFixtureOutsourceRecordForCompletion(fixtureId, client);
  if (!record) {
    return {
      record: null,
      transition: null,
      updatedRecord: null,
      workflowMarkedComplete: false,
      outsourceRecordCompleted: false,
    };
  }

  const progressResult = await client.query(
    `
      SELECT
        stage_name,
        stage_order,
        status
      FROM fixture_workflow_progress
      WHERE fixture_id = $1
        AND department_id = $2
      ORDER BY stage_order ASC
    `,
    [fixtureId, departmentId],
  );
  const progressRows = progressResult.rows || [];
  const transition = resolveOutsourceStageCompletion(progressRows, record.outsourced_stages || []);

  if (!transition.canComplete) {
    return {
      record,
      transition,
      updatedRecord: record,
      workflowMarkedComplete: false,
      outsourceRecordCompleted: false,
    };
  }

  for (const stageName of transition.stageNamesToApprove) {
    await client.query(
      `
        UPDATE fixture_workflow_progress
        SET status = 'APPROVED',
            assigned_to = NULL,
            assigned_at = NULL,
            started_at = NULL,
            completed_at = COALESCE(completed_at, NOW()),
            duration_minutes = NULL,
            updated_at = NOW()
        WHERE fixture_id = $1
          AND department_id = $2
          AND stage_name = $3
          AND UPPER(COALESCE(status, '')) <> 'APPROVED'
      `,
      [fixtureId, departmentId, stageName],
    );
  }

  if (transition.nextStageName) {
    await client.query(
      `
        UPDATE fixture_workflow_progress
        SET status = 'PENDING',
            assigned_to = NULL,
            assigned_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            duration_minutes = NULL,
            updated_at = NOW()
        WHERE fixture_id = $1
          AND department_id = $2
          AND stage_name = $3
          AND UPPER(COALESCE(status, '')) <> 'APPROVED'
      `,
      [fixtureId, departmentId, transition.nextStageName],
    );
  }

  await client.query(
    `
      UPDATE design.fixtures
      SET is_workflow_complete = $2,
          is_outsourced = TRUE,
          vendor_name = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      fixtureId,
      transition.workflowMarkedComplete === true,
      record.supplier_name || null,
    ],
  );

  const outsourceRecordCompleted = transition.remainingOutsourcedStageNames.length === 0;
  const updatedRecordResult = await client.query(
    `
      UPDATE design.fixture_outsource_records
      SET outsource_status = $2,
          completed_by = CASE WHEN $2 = $4 THEN COALESCE(completed_by, $3) ELSE NULL END,
          completed_at = CASE WHEN $2 = $4 THEN COALESCE(completed_at, NOW()) ELSE NULL END,
          updated_at = NOW()
      WHERE fixture_id = $1
      RETURNING *
    `,
    [
      fixtureId,
      outsourceRecordCompleted ? OUTSOURCE_STATUSES.COMPLETED : OUTSOURCE_STATUSES.OUTSOURCED,
      changedBy || null,
      OUTSOURCE_STATUSES.COMPLETED,
    ],
  );

  return {
    record,
    transition,
    updatedRecord: updatedRecordResult.rows[0] || record,
    workflowMarkedComplete: transition.workflowMarkedComplete === true,
    outsourceRecordCompleted,
  };
}

async function markFixtureWorkflowCompleteIfSatisfied(fixtureId, departmentId, outsourcedStages = [], client = pool) {
  const result = await client.query(
    `
      SELECT
        stage_name,
        status
      FROM fixture_workflow_progress
      WHERE fixture_id = $1
        AND department_id = $2
      ORDER BY stage_order ASC
    `,
    [fixtureId, departmentId],
  );

  const progressRows = result.rows || [];
  if (!canCompleteWorkflowAfterOutsource(progressRows, outsourcedStages)) {
    return false;
  }

  const stageNamesToApprove = getOutsourceCompletionAutoApproveStageNames(progressRows, outsourcedStages);
  for (const stageName of stageNamesToApprove) {
    await client.query(
      `
        UPDATE fixture_workflow_progress
        SET status = 'APPROVED',
            assigned_to = NULL,
            assigned_at = NULL,
            started_at = NULL,
            completed_at = COALESCE(completed_at, NOW()),
            duration_minutes = NULL,
            updated_at = NOW()
        WHERE fixture_id = $1
          AND department_id = $2
          AND stage_name = $3
      `,
      [fixtureId, departmentId, stageName],
    );
  }

  await client.query(
    `
      UPDATE design.fixtures
      SET is_workflow_complete = TRUE,
          updated_at = NOW()
      WHERE id = $1
    `,
    [fixtureId],
  );

  return true;
}

async function updateFixtureOutsourcingState({
  fixtureId,
  isOutsourced,
  vendorName,
  changedBy,
}, client = pool) {
  const result = await client.query(
    `
      UPDATE design.fixtures AS di
      SET is_outsourced = $2,
          vendor_name = CASE
            WHEN $2::boolean THEN NULLIF(BTRIM($3::text), '')
            ELSE NULL
          END,
          outsourced_at = CASE
            WHEN $2::boolean THEN COALESCE(di.outsourced_at, NOW())
            ELSE NULL
          END,
          outsourced_by = CASE
            WHEN $2::boolean THEN COALESCE(di.outsourced_by, NULLIF(BTRIM($4::text), ''))
            ELSE NULL
          END,
          updated_at = NOW()
      FROM design.projects dp
      WHERE di.id = $1
        AND dp.id = di.project_id
      RETURNING
        di.id AS fixture_id,
        di.project_id,
        dp.department_id,
        di.batch_id,
        di.fixture_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.is_outsourced,
        di.vendor_name,
        di.outsourced_at,
        di.outsourced_by,
        di.revision_no,
        di.is_legacy_workflow,
        di.is_workflow_complete
    `,
    [
      fixtureId,
      isOutsourced === true,
      vendorName || null,
      changedBy || null,
    ],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

async function upsertFixture(fixtureData, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.fixtures (
        project_id,
        fixture_no,
        op_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        batch_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (project_id, fixture_no) DO UPDATE
      SET
        project_id = EXCLUDED.project_id,
        op_no = COALESCE(EXCLUDED.op_no, design.fixtures.op_no),
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
    `,
    [
      fixtureData.project_id,
      fixtureData.fixture_no,
      fixtureData.op_no || null,
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
  completeCurrentOutsourcedWorkflowStage,
  countProjectsByDepartment,
  createUploadBatch,
  createUploadErrors,
  createUploadRowCorrections,
  findDepartmentProjectByIdForDepartment,
  findActiveUploadBatchIdForProject,
  findFixtureAssignmentContextByIdForUser,
  findFixtureByIdForDepartment,
  findFixtureByIdForUser,
  findFixturesByProjectForDedupe,
  findProjectByIdForDepartment,
  findProjectByIdForUser,
  insertProjectByNumber,
  findProjectByNumberForDepartment,
  getProjectStatusById,
  getProjectModificationContextForUser,
  listDepartmentProjectsByDepartment,
  listDepartmentProjectsForUser,
  listFixturesByProjectForDepartment,
  listFixturesByProjectForUser,
  listFixturesByUploadBatchForDepartment,
  listFixturesByUploadBatchForUser,
  listProjectSummariesForUser,
  listProjectOptionsByDepartment,
  listProjectOptionsForUser,
  listRecentOutsourceSuppliersForUser,
  markFixtureOutsourceBroughtInHouse,
  markFixtureOutsourceCompleted,
  markFixtureWorkflowCompleteIfSatisfied,
  rememberRecentOutsourceSupplier,
  touchProject,
  updateProjectModificationFlag,
  updateFixtureReferenceImageForDepartment,
  updateProjectIdentityById,
  upsertFixtureOutsourceRecord,
  updateFixtureOutsourcingState,
  upsertFixture,
  upsertProjectByNumber,
});
