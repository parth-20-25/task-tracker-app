const { pool } = require("../db");
const { PROJECT_STATUSES } = require("../config/constants");
const { instrumentModuleExports } = require("../lib/observability");
const {
  buildVisibleUsersCte,
  identifierInVisibleUsersSql,
  visibleProjectPredicate,
  GetAccessibleUserIds,
} = require("./projectVisibility");
const {
  activeTaskLateral,
  currentProgressLateral,
  operationalStateSqlCase,
} = require("../services/operationalStateResolver");
const { userResolutionLateralSql } = require("./sqlFragments");

const BATCH_DELETE_BLOCK_REASON = "Cannot delete project. Some fixtures have active or pending approval tasks.";
const DELETABLE_FIXTURE_STATUSES = ["PENDING", "REJECTED"];
const OPEN_TASK_STATUSES = ["assigned", "in_progress", "on_hold", "under_review", "rework"];
const RESTORABLE_TASK_STATUSES = [...OPEN_TASK_STATUSES, "closed"];
const RESTORABLE_WORKFLOW_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "SUBMITTED_FOR_VERIFICATION",
  "APPROVED",
  "REJECTED",
];
const SCHEMA_METADATA_TTL_MS = 60 * 1000;
const schemaMetadataCache = new Map();
const MODIFICATION_AUTHORITY_ROLE_KEYS = ["admin", "director", "director_ceo", "ceo_director"];
const MODIFICATION_AUTHORITY_ROLE_IDS = ["admin", "director", "director_ceo", "r1", "r2"];
const MODIFICATION_UPLOADER_LEADER_ROLE_KEYS = [
  "team_leader",
  "line_manager",
  "co_leader",
  "team_co_leader",
  "shift_incharge",
  "uploader_leader",
  "uploader_co_leader",
  "project_uploader_leader",
  "project_uploader_co_leader",
];

function getCachedSchemaMetadata(cacheKey) {
  const cachedEntry = schemaMetadataCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt < Date.now()) {
    schemaMetadataCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.value;
}

function setCachedSchemaMetadata(cacheKey, value) {
  schemaMetadataCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + SCHEMA_METADATA_TTL_MS,
  });
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

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
  return stripLegacyWbsPrefix(value).replace(/^[-_]+\s*(?=\S)/, "");
}

function projectModificationPermissionSql(projectAlias = "dp", employeeExpression = "$1") {
  return `
    (
      EXISTS (
        SELECT 1
        FROM root_user root
        WHERE root.role_key = ANY(${sqlTextArray(MODIFICATION_AUTHORITY_ROLE_KEYS)})
           OR root.role_id_key = ANY(${sqlTextArray(MODIFICATION_AUTHORITY_ROLE_IDS)})
      )
      OR ${identifierInVisibleUsersSql(`${projectAlias}.created_by_user_id`, "root_user")}
      OR ${identifierInVisibleUsersSql(`${projectAlias}.uploaded_by`, "root_user")}
      OR (
        EXISTS (
          SELECT 1
          FROM root_user root
          WHERE root.role_key = ANY(${sqlTextArray(MODIFICATION_UPLOADER_LEADER_ROLE_KEYS)})
             OR root.role_id_key = ANY(${sqlTextArray(MODIFICATION_UPLOADER_LEADER_ROLE_KEYS)})
        )
        AND (
          ${identifierInVisibleUsersSql(`${projectAlias}.created_by_user_id`)}
          OR ${identifierInVisibleUsersSql(`${projectAlias}.uploaded_by`)}
        )
      )
    )
  `;
}

function isMissingOptionalFixtureRelation(error) {
  if (error?.code !== "42P01") {
    return false;
  }

  const relation = String(error.relation || error.message || "");
  return relation.includes("fixture_outsource_records")
    || relation.includes("workflow_completion_snapshots");
}

function fixtureOperationalStatsLateral(projectAlias = "dp", { includeOptionalTables = true } = {}) {
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

async function enrichBatchSummariesWithCompletionTruth(summaries, client = pool) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return summaries;
  }

  const { enrichProjectSummariesWithCompletionTruth } = require("../services/designCompletion/designCompletionEngine");
  const projectSummaries = summaries.map((summary) => ({
    project_id: summary.project_id,
    project_no: summary.project_no,
    department_id: summary.department_id,
    project_status: summary.project_status,
  }));
  const enrichedProjects = await enrichProjectSummariesWithCompletionTruth(projectSummaries, client);
  const truthByProjectId = new Map(enrichedProjects.map((project) => [project.project_id, project]));

  return summaries.map((summary) => {
    const truth = truthByProjectId.get(summary.project_id);
    return {
      ...summary,
      project_completion_percent: truth?.completion_percent ?? null,
      completion_truth_status: truth?.completion_truth_status || "incomplete_truth",
      completion_truth_errors: truth?.completion_truth_errors || [`missing_project_completion_truth:${summary.project_id}`],
    };
  });
}

async function tableExists(tableName, client = pool) {
  const cacheKey = `table:${tableName}`;
  const cachedValue = getCachedSchemaMetadata(cacheKey);

  if (cachedValue !== null) {
    return cachedValue;
  }

  const [schema, table] = tableName.includes(".")
    ? tableName.split(".")
    : ["public", tableName];

  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name = $2
      LIMIT 1
    `,
    [schema, table],
  );

  const exists = result.rowCount > 0;
  setCachedSchemaMetadata(cacheKey, exists);
  return exists;
}

async function columnExists(tableName, columnName, client = pool) {
  const cacheKey = `column:${tableName}:${columnName}`;
  const cachedValue = getCachedSchemaMetadata(cacheKey);

  if (cachedValue !== null) {
    return cachedValue;
  }

  const [schema, table] = tableName.includes(".")
    ? tableName.split(".")
    : ["public", tableName];

  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1
    `,
    [schema, table, columnName],
  );

  const exists = result.rowCount > 0;
  setCachedSchemaMetadata(cacheKey, exists);
  return exists;
}

function mapBatchSummary(row) {
  const activeCount = Number(row.active_count || 0);
  const totalFixtures = Number(row.total_fixtures || 0);
  const pendingFixtures = Number(row.pending_fixtures || 0);
  const completedFixtures = Number(row.completed_fixtures || 0);

  return {
    id: row.id || row.batch_id || row.project_id,
    batch_id: row.batch_id || null,
    project_id: row.project_id,
    project_no: normalizeProjectNo(row.project_no),
    project_created_by_user_id: row.project_created_by_user_id || null,
    project_uploaded_by: row.project_uploaded_by || null,
    project_name: normalizeProjectName(row.project_name),
    customer_name: collapseProjectLabel(row.customer_name),
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    is_modified: row.is_modified === true,
    project_completion_percent: row.project_completion_percent === null || row.project_completion_percent === undefined
      ? null
      : Number(row.project_completion_percent),
    completion_truth_status: row.completion_truth_status || null,
    completion_truth_errors: Array.isArray(row.completion_truth_errors) ? row.completion_truth_errors : [],
    total_tasks: totalFixtures,
    pending_tasks: pendingFixtures,
    completed_tasks: completedFixtures,
    uploaded_by: row.uploaded_by || row.project_uploaded_by || row.project_created_by_user_id || null,
    uploaded_by_user_id: row.uploaded_by_user_id || row.uploaded_by || row.project_uploaded_by || row.project_created_by_user_id || null,
    uploaded_by_name: row.uploaded_by_name || null,
    uploaded_at: row.uploaded_at || row.project_created_at || row.project_updated_at,
    created_at: row.uploaded_at || row.project_created_at || row.project_updated_at,
    accepted_rows: Number(row.accepted_rows || 0),
    rejected_rows: Number(row.rejected_rows || 0),
    total_fixtures: totalFixtures,
    active_count: activeCount,
    pending_fixtures: pendingFixtures,
    completed_fixtures: completedFixtures,
    status_summary: `${activeCount} active / ${pendingFixtures} pending / ${completedFixtures} complete`,
    deletion_blocked: activeCount > 0,
    delete_blocked_reason: activeCount > 0 ? BATCH_DELETE_BLOCK_REASON : null,
    can_manage_2d_routing: row.can_manage_2d_routing === true,
    can_toggle_modification: row.can_toggle_modification === true,
    can_edit_project: row.can_edit_project === true,
  };
}

async function listBatchesWithSummary(departmentId, client = pool) {
  const params = [];
  const departmentFilter = departmentId ? "WHERE dp.department_id = $1" : "";

  if (departmentId) {
    params.push(departmentId);
  }

  const queryBatches = async (includeOptionalTables) => {
    // Select a single active operational batch per project (latest active), and compute project-level fixture/task aggregates.
    const result = await client.query(
      `
      SELECT
        COALESCE(ub.id::text, dp.id::text) AS id,
        ub.id AS batch_id,
        COALESCE(ub.project_id, dp.id) AS project_id,
        dp.project_no,
        dp.created_by_user_id AS project_created_by_user_id,
        dp.uploaded_by AS project_uploaded_by,
        dp.created_at AS project_created_at,
        dp.updated_at AS project_updated_at,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $${params.length + 1}) AS project_status,
        COALESCE(dp.is_modified, FALSE) AS is_modified,
        NULL::numeric AS project_completion_percent,
        NULL::text AS completion_truth_status,
        ARRAY[]::text[] AS completion_truth_errors,
        COALESCE(ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by,
        COALESCE(uploader.employee_id, ub.uploaded_by_user_id, ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by_user_id,
        uploader.name AS uploaded_by_name,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_fixtures,
        COALESCE(fixture_stats.pending_fixtures, 0)::integer AS pending_fixtures,
        COALESCE(fixture_stats.completed_fixtures, 0)::integer AS completed_fixtures,
        COALESCE(fixture_stats.active_fixtures, 0)::integer AS active_count,
        TRUE AS can_manage_2d_routing,
        FALSE AS can_toggle_modification,
        FALSE AS can_edit_project
      FROM design.projects dp
      LEFT JOIN LATERAL (
        SELECT
          id,
          project_id,
          uploaded_by,
          uploaded_by_user_id,
          uploaded_at,
          accepted_rows,
          rejected_rows
        FROM design.upload_batches
        WHERE project_id = dp.id
        ORDER BY
          CASE WHEN COALESCE(status, 'active') = 'active' THEN 0 ELSE 1 END,
          uploaded_at DESC,
          id DESC
        LIMIT 1
      ) ub ON TRUE
      ${userResolutionLateralSql("uploader", [
        { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
        { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
        { expression: "dp.uploaded_by", source: "project_uploaded_by" },
        { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${fixtureOperationalStatsLateral("dp", { includeOptionalTables })}
      ${departmentFilter}
      ORDER BY COALESCE(ub.uploaded_at, dp.updated_at, dp.created_at) DESC
    `,
      [...params, PROJECT_STATUSES.ACTIVE],
    );

    return result.rows.map(mapBatchSummary);
  };

  let rows;
  try {
    rows = await queryBatches(true);
  } catch (error) {
    if (!isMissingOptionalFixtureRelation(error)) {
      throw error;
    }
    rows = await queryBatches(false);
  }

  return enrichBatchSummariesWithCompletionTruth(rows, client);
}


  // NOTE: debug logging for per-user batch listing

async function listBatchesWithSummaryForUser(user, departmentId, client = pool) {
  const queryBatches = async (includeOptionalTables) => {
    const result = await client.query(
      `
      ${buildVisibleUsersCte("$1")}
      SELECT
        COALESCE(ub.id::text, dp.id::text) AS id,
        ub.id AS batch_id,
        COALESCE(ub.project_id, dp.id) AS project_id,
        dp.project_no,
        dp.created_by_user_id AS project_created_by_user_id,
        dp.uploaded_by AS project_uploaded_by,
        dp.created_at AS project_created_at,
        dp.updated_at AS project_updated_at,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $3) AS project_status,
        COALESCE(dp.is_modified, FALSE) AS is_modified,
        NULL::numeric AS project_completion_percent,
        NULL::text AS completion_truth_status,
        ARRAY[]::text[] AS completion_truth_errors,
        COALESCE(ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by,
        COALESCE(uploader.employee_id, ub.uploaded_by_user_id, ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by_user_id,
        uploader.name AS uploaded_by_name,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_fixtures,
        COALESCE(fixture_stats.pending_fixtures, 0)::integer AS pending_fixtures,
        COALESCE(fixture_stats.completed_fixtures, 0)::integer AS completed_fixtures,
        COALESCE(fixture_stats.active_fixtures, 0)::integer AS active_count,
        (
          EXISTS (
            SELECT 1
            FROM root_user root
            WHERE root.role_key = ANY(ARRAY['admin', 'ceo', 'director', 'director_ceo']::text[])
               OR root.role_id_key = ANY(ARRAY['admin', 'ceo', 'director', 'director_ceo']::text[])
          )
          OR ${identifierInVisibleUsersSql("dp.created_by_user_id")}
          OR ${identifierInVisibleUsersSql("dp.uploaded_by")}
          OR ${identifierInVisibleUsersSql("ub.uploaded_by_user_id")}
          OR ${identifierInVisibleUsersSql("ub.uploaded_by")}
        ) AS can_manage_2d_routing,
        ${projectModificationPermissionSql("dp", "$1")} AS can_toggle_modification,
        TRUE AS can_edit_project
      FROM design.projects dp
      LEFT JOIN LATERAL (
        SELECT
          id,
          project_id,
          uploaded_by,
          uploaded_by_user_id,
          uploaded_at,
          accepted_rows,
          rejected_rows
        FROM design.upload_batches
        WHERE project_id = dp.id
        ORDER BY
          CASE WHEN COALESCE(status, 'active') = 'active' THEN 0 ELSE 1 END,
          uploaded_at DESC,
          id DESC
        LIMIT 1
      ) ub ON TRUE
      ${userResolutionLateralSql("uploader", [
        { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
        { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
        { expression: "dp.uploaded_by", source: "project_uploaded_by" },
        { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${fixtureOperationalStatsLateral("dp", { includeOptionalTables })}
      WHERE ($2::text IS NULL OR dp.department_id = $2)
        AND ${visibleProjectPredicate("dp")}
      ORDER BY
        CASE COALESCE(dp.status, $3)
          WHEN $3 THEN 0
          WHEN $5 THEN 1
          WHEN $4 THEN 2
          ELSE 3
        END,
        COALESCE(ub.uploaded_at, dp.updated_at, dp.created_at) DESC
    `,
    [
      user.employee_id,
      departmentId,
      PROJECT_STATUSES.ACTIVE,
      PROJECT_STATUSES.COMPLETED,
      PROJECT_STATUSES.ON_HOLD,
    ],
    );

    return result.rows.map(mapBatchSummary);
  };

  let rows;
  try {
    rows = await queryBatches(true);
  } catch (error) {
    if (!isMissingOptionalFixtureRelation(error)) {
      throw error;
    }
    rows = await queryBatches(false);
  }

  return enrichBatchSummariesWithCompletionTruth(rows, client);
}

async function _debugLogBatchQueryForUser(event, user, departmentId, rows, client) {
  if (process.env.PROJECT_VISIBILITY_DEBUG !== "true") {
    return;
  }

  try {
    const visibleUsers = await GetAccessibleUserIds(user?.employee_id, client);
    console.info("[project-visibility-debug]", {
      event,
      current_user_id: user?.employee_id || null,
      requested_department_id: departmentId || null,
      visible_users_count: visibleUsers.length,
      batch_count: Array.isArray(rows) ? rows.length : (rows ? 1 : 0),
    });
  } catch (err) {
    console.warn("[project-visibility-debug] batch debug log failed", { error: err?.message });
  }
}

async function getBatchById(batchId, client = pool) {
  const queryBatch = async (includeOptionalTables) => {
    const result = await client.query(
      `
      SELECT
        ub.id,
        ub.id AS batch_id,
        ub.project_id,
        dp.project_no,
        dp.created_by_user_id AS project_created_by_user_id,
        dp.uploaded_by AS project_uploaded_by,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $2) AS project_status,
        COALESCE(dp.is_modified, FALSE) AS is_modified,
        NULL::numeric AS project_completion_percent,
        NULL::text AS completion_truth_status,
        ARRAY[]::text[] AS completion_truth_errors,
        COALESCE(ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by,
        COALESCE(uploader.employee_id, ub.uploaded_by_user_id, ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by_user_id,
        uploader.name AS uploaded_by_name,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_fixtures,
        COALESCE(fixture_stats.pending_fixtures, 0)::integer AS pending_fixtures,
        COALESCE(fixture_stats.completed_fixtures, 0)::integer AS completed_fixtures,
        COALESCE(fixture_stats.active_fixtures, 0)::integer AS active_count,
        TRUE AS can_manage_2d_routing,
        FALSE AS can_toggle_modification,
        FALSE AS can_edit_project
      FROM design.upload_batches ub
      JOIN design.projects dp ON dp.id = ub.project_id
      ${userResolutionLateralSql("uploader", [
        { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
        { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
        { expression: "dp.uploaded_by", source: "project_uploaded_by" },
        { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${fixtureOperationalStatsLateral("dp", { includeOptionalTables })}
      WHERE ub.id = $1
    `,
      [batchId, PROJECT_STATUSES.ACTIVE],
    );

    return result.rows.map(mapBatchSummary);
  };

  let rows;
  try {
    rows = await queryBatch(true);
  } catch (error) {
    if (!isMissingOptionalFixtureRelation(error)) {
      throw error;
    }
    rows = await queryBatch(false);
  }

  const summaries = await enrichBatchSummariesWithCompletionTruth(rows, client);
  return summaries[0] || null;
}


async function getBatchByIdForUser(batchId, user, client = pool) {
  const queryBatch = async (includeOptionalTables) => {
    const result = await client.query(
      `
      ${buildVisibleUsersCte("$1")}
      SELECT
        ub.id,
        ub.id AS batch_id,
        ub.project_id,
        dp.project_no,
        dp.created_by_user_id AS project_created_by_user_id,
        dp.uploaded_by AS project_uploaded_by,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $3) AS project_status,
        COALESCE(dp.is_modified, FALSE) AS is_modified,
        NULL::numeric AS project_completion_percent,
        NULL::text AS completion_truth_status,
        ARRAY[]::text[] AS completion_truth_errors,
        COALESCE(ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by,
        COALESCE(uploader.employee_id, ub.uploaded_by_user_id, ub.uploaded_by, dp.uploaded_by, dp.created_by_user_id) AS uploaded_by_user_id,
        uploader.name AS uploaded_by_name,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COALESCE(fixture_stats.total_fixtures, 0)::integer AS total_fixtures,
        COALESCE(fixture_stats.pending_fixtures, 0)::integer AS pending_fixtures,
        COALESCE(fixture_stats.completed_fixtures, 0)::integer AS completed_fixtures,
        COALESCE(fixture_stats.active_fixtures, 0)::integer AS active_count,
        (
          EXISTS (
            SELECT 1
            FROM root_user root
            WHERE root.role_key = ANY(ARRAY['admin', 'ceo', 'director', 'director_ceo']::text[])
               OR root.role_id_key = ANY(ARRAY['admin', 'ceo', 'director', 'director_ceo']::text[])
          )
          OR ${identifierInVisibleUsersSql("dp.created_by_user_id")}
          OR ${identifierInVisibleUsersSql("dp.uploaded_by")}
          OR ${identifierInVisibleUsersSql("ub.uploaded_by_user_id")}
          OR ${identifierInVisibleUsersSql("ub.uploaded_by")}
        ) AS can_manage_2d_routing,
        ${projectModificationPermissionSql("dp", "$1")} AS can_toggle_modification,
        TRUE AS can_edit_project
      FROM design.upload_batches ub
      JOIN design.projects dp ON dp.id = ub.project_id
      ${userResolutionLateralSql("uploader", [
        { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
        { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
        { expression: "dp.uploaded_by", source: "project_uploaded_by" },
        { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${fixtureOperationalStatsLateral("dp", { includeOptionalTables })}
      WHERE ub.id = $2
        AND ${visibleProjectPredicate("dp")}
    `,
    [
      user.employee_id,
      batchId,
      PROJECT_STATUSES.ACTIVE,
    ],
    );

    return result.rows.map(mapBatchSummary);
  };

  let rows;
  try {
    rows = await queryBatch(true);
  } catch (error) {
    if (!isMissingOptionalFixtureRelation(error)) {
      throw error;
    }
    rows = await queryBatch(false);
  }

  await _debugLogBatchQueryForUser("getBatchByIdForUser", user, null, rows, client);
  const summaries = await enrichBatchSummariesWithCompletionTruth(rows, client);
  return summaries[0] || null;
}

async function getProjectLifecycleContextByIdForUser(projectId, user, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        active_batch.id AS batch_id,
        active_batch.uploaded_by AS batch_uploaded_by,
        active_batch.uploaded_by_user_id AS batch_uploaded_by_user_id,
        p.project_no,
        p.created_by_user_id AS project_created_by_user_id,
        p.uploaded_by AS project_uploaded_by,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id,
        COALESCE(p.status, $3) AS project_status,
        COALESCE(p.is_modified, FALSE) AS is_modified,
        p.completed_at,
        p.status_changed_at,
        p.created_at AS project_created_at,
        p.updated_at AS project_updated_at
      FROM design.projects p
      LEFT JOIN LATERAL (
        SELECT id, uploaded_by, uploaded_by_user_id
        FROM design.upload_batches
        WHERE project_id = p.id
          AND COALESCE(status, 'active') = 'active'
        ORDER BY uploaded_at DESC, id DESC
        LIMIT 1
      ) active_batch ON TRUE
      WHERE p.id = $2
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
    `,
    [user.employee_id, projectId, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows[0] || null;
}

async function checkBatchDeletionBlocked(batchId, client = pool) {
  const result = await client.query(
    `
      SELECT COUNT(DISTINCT f.id)::integer AS active_count
      FROM design.fixtures f
      JOIN fixture_workflow_progress fwp ON fwp.fixture_id = f.id
      WHERE f.batch_id = $1
        AND NOT (fwp.status = ANY($2::text[]))
    `,
    [batchId, DELETABLE_FIXTURE_STATUSES],
  );

  const activeCount = Number(result.rows[0]?.active_count || 0);

  return {
    blocked: activeCount > 0,
    active_count: activeCount,
    reason: activeCount > 0 ? BATCH_DELETE_BLOCK_REASON : null,
  };
}

async function setProjectLifecycleStatus(projectId, status, client = pool) {
  const result = await client.query(
    `
      UPDATE design.projects
      SET status = $2,
          status_changed_at = NOW(),
          completed_at = CASE WHEN $2 IN ($3, $4) THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [projectId, status, PROJECT_STATUSES.COMPLETED, PROJECT_STATUSES.RELEASED],
  );

  return result.rowCount > 0;
}

async function reactivateProjectForModification(projectId, client = pool) {
  const result = await client.query(
    `
      UPDATE design.projects
      SET status = $2,
          is_modified = TRUE,
          status_changed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id AS project_id,
        project_no,
        COALESCE(NULLIF(BTRIM(project_name), ''), project_no) AS project_name,
        customer_name,
        department_id,
        COALESCE(status, $2) AS project_status,
        COALESCE(is_modified, FALSE) AS is_modified,
        completed_at,
        status_changed_at,
        updated_at
    `,
    [projectId, PROJECT_STATUSES.ACTIVE],
  );

  return result.rows[0] || null;
}

async function captureProjectReleaseSnapshot(projectId, releasedBy, client = pool) {
  if (!(await tableExists("design.workflow_completion_snapshots", client))) {
    return 0;
  }

  const result = await client.query(
    `
      INSERT INTO design.workflow_completion_snapshots (
        fixture_id,
        project_id,
        scope,
        trigger,
        payload
      )
      SELECT
        f.id,
        p.id,
        'fixture',
        'project_release',
        jsonb_build_object(
          'fixture_id', f.id,
          'project_id', p.id,
          'department_id', p.department_id,
          'released_by', $2::text,
          'captured_project_status', COALESCE(p.status, $3),
          'is_workflow_complete', COALESCE(f.is_workflow_complete, FALSE),
          'progress', COALESCE(progress.rows, '[]'::jsonb),
          'tasks', COALESCE(tasks.rows, '[]'::jsonb)
        )
      FROM design.projects p
      JOIN design.fixtures f
        ON f.project_id = p.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'stage_name', fwp.stage_name,
            'stage_order', fwp.stage_order,
            'stage_version', fwp.stage_version,
            'status', fwp.status,
            'assigned_to', fwp.assigned_to,
            'assigned_at', fwp.assigned_at,
            'started_at', fwp.started_at,
            'completed_at', fwp.completed_at,
            'duration_minutes', fwp.duration_minutes
          )
          ORDER BY fwp.stage_order ASC, fwp.stage_name ASC
        ) AS rows
        FROM fixture_workflow_progress fwp
        WHERE fwp.fixture_id = f.id
          AND fwp.department_id = p.department_id
      ) progress ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'status', t.status,
            'verification_status', t.verification_status,
            'completion_percent', t.completion_percent,
            'lifecycle_status', t.lifecycle_status,
            'approval_stage', t.approval_stage,
            'completed_at', t.completed_at,
            'closed_at', t.closed_at,
            'submitted_at', t.submitted_at,
            'verified_at', t.verified_at,
            'approved_at', t.approved_at,
            'approved_by', t.approved_by,
            'actual_minutes', t.actual_minutes
          )
          ORDER BY t.id ASC
        ) AS rows
        FROM tasks t
        WHERE t.project_id = p.id
          AND t.fixture_id = f.id
          AND COALESCE(t.status, '') <> 'cancelled'
      ) tasks ON TRUE
      WHERE p.id = $1
      RETURNING id
    `,
    [projectId, releasedBy || null, PROJECT_STATUSES.ACTIVE],
  );

  return result.rowCount || 0;
}

async function restoreProjectWorkflowFromSnapshots(projectId, client = pool) {
  if (!(await tableExists("design.workflow_completion_snapshots", client))) {
    return {
      snapshot_fixtures_restored: 0,
      snapshot_progress_rows_restored: 0,
      snapshot_tasks_restored: 0,
    };
  }

  const fixtureResult = await client.query(
    `
      WITH latest_snapshot AS (
        SELECT DISTINCT ON (snapshot.fixture_id)
          snapshot.fixture_id,
          snapshot.payload
        FROM design.workflow_completion_snapshots snapshot
        JOIN design.fixtures fixture
          ON fixture.id = snapshot.fixture_id
        WHERE snapshot.project_id = $1
          AND fixture.project_id = $1
          AND snapshot.scope = 'fixture'
          AND snapshot.trigger = 'project_release'
        ORDER BY snapshot.fixture_id, snapshot.captured_at DESC, snapshot.id DESC
      )
      UPDATE design.fixtures fixture
      SET is_workflow_complete = COALESCE((latest_snapshot.payload ->> 'is_workflow_complete')::boolean, fixture.is_workflow_complete),
          updated_at = NOW()
      FROM latest_snapshot
      WHERE fixture.id = latest_snapshot.fixture_id
      RETURNING fixture.id
    `,
    [projectId],
  );

  const progressResult = await client.query(
    `
      WITH latest_snapshot AS (
        SELECT DISTINCT ON (snapshot.fixture_id)
          snapshot.fixture_id,
          snapshot.payload
        FROM design.workflow_completion_snapshots snapshot
        JOIN design.fixtures fixture
          ON fixture.id = snapshot.fixture_id
        WHERE snapshot.project_id = $1
          AND fixture.project_id = $1
          AND snapshot.scope = 'fixture'
          AND snapshot.trigger = 'project_release'
        ORDER BY snapshot.fixture_id, snapshot.captured_at DESC, snapshot.id DESC
      ),
      snapshot_progress AS (
        SELECT
          latest_snapshot.fixture_id,
          progress.stage_name,
          progress.stage_version,
          progress.status,
          progress.assigned_to,
          progress.assigned_at,
          progress.started_at,
          progress.completed_at,
          progress.duration_minutes
        FROM latest_snapshot
        CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(latest_snapshot.payload -> 'progress', '[]'::jsonb)) AS progress(
          stage_name text,
          stage_order integer,
          stage_version integer,
          status text,
          assigned_to text,
          assigned_at timestamptz,
          started_at timestamptz,
          completed_at timestamptz,
          duration_minutes integer
        )
        WHERE progress.status = ANY($2::text[])
      )
      UPDATE fixture_workflow_progress fwp
      SET status = snapshot_progress.status,
          stage_version = COALESCE(snapshot_progress.stage_version, fwp.stage_version),
          assigned_to = snapshot_progress.assigned_to,
          assigned_at = snapshot_progress.assigned_at,
          started_at = snapshot_progress.started_at,
          completed_at = snapshot_progress.completed_at,
          duration_minutes = snapshot_progress.duration_minutes,
          updated_at = NOW()
      FROM snapshot_progress
      JOIN design.fixtures fixture
        ON fixture.id = snapshot_progress.fixture_id
       AND fixture.project_id = $1
      JOIN design.projects project
        ON project.id = fixture.project_id
      WHERE fwp.fixture_id = snapshot_progress.fixture_id
        AND fwp.department_id = project.department_id
        AND LOWER(fwp.stage_name) = LOWER(snapshot_progress.stage_name)
      RETURNING fwp.id
    `,
    [projectId, RESTORABLE_WORKFLOW_STATUSES],
  );

  const taskResult = await client.query(
    `
      WITH latest_snapshot AS (
        SELECT DISTINCT ON (snapshot.fixture_id)
          snapshot.fixture_id,
          snapshot.payload
        FROM design.workflow_completion_snapshots snapshot
        JOIN design.fixtures fixture
          ON fixture.id = snapshot.fixture_id
        WHERE snapshot.project_id = $1
          AND fixture.project_id = $1
          AND snapshot.scope = 'fixture'
          AND snapshot.trigger = 'project_release'
        ORDER BY snapshot.fixture_id, snapshot.captured_at DESC, snapshot.id DESC
      ),
      snapshot_task AS (
        SELECT task.*
        FROM latest_snapshot
        CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(latest_snapshot.payload -> 'tasks', '[]'::jsonb)) AS task(
          id integer,
          status text,
          verification_status text,
          completion_percent integer,
          lifecycle_status text,
          approval_stage text,
          completed_at timestamptz,
          closed_at timestamptz,
          submitted_at timestamptz,
          verified_at timestamptz,
          approved_at timestamptz,
          approved_by text,
          actual_minutes integer
        )
        WHERE LOWER(COALESCE(task.status, '')) = ANY($2::text[])
      )
      UPDATE tasks task
      SET status = snapshot_task.status,
          verification_status = snapshot_task.verification_status,
          completion_percent = COALESCE(snapshot_task.completion_percent, task.completion_percent, 0),
          lifecycle_status = COALESCE(snapshot_task.lifecycle_status, task.lifecycle_status),
          approval_stage = snapshot_task.approval_stage,
          completed_at = snapshot_task.completed_at,
          closed_at = snapshot_task.closed_at,
          submitted_at = snapshot_task.submitted_at,
          verified_at = snapshot_task.verified_at,
          approved_at = snapshot_task.approved_at,
          approved_by = snapshot_task.approved_by,
          actual_minutes = COALESCE(snapshot_task.actual_minutes, task.actual_minutes, 0),
          updated_at = NOW()
      FROM snapshot_task
      WHERE task.id = snapshot_task.id
        AND task.project_id = $1
      RETURNING task.id
    `,
    [projectId, RESTORABLE_TASK_STATUSES],
  );

  return {
    snapshot_fixtures_restored: fixtureResult.rowCount || 0,
    snapshot_progress_rows_restored: progressResult.rowCount || 0,
    snapshot_tasks_restored: taskResult.rowCount || 0,
  };
}

async function restoreProjectWorkflowFromActivity(projectId, client = pool) {
  const taskResult = await client.query(
    `
      WITH restore_candidates AS (
        SELECT
          task.id,
          latest_status.restored_status,
          latest_percent.completion_percent
        FROM tasks task
        LEFT JOIN LATERAL (
          SELECT
            CASE
              WHEN LOWER(activity.metadata ->> 'to') = ANY($2::text[]) THEN LOWER(activity.metadata ->> 'to')
              WHEN activity.action_type = 'task_submitted_for_verification' THEN 'under_review'
              WHEN activity.action_type = 'task_auto_started' THEN 'in_progress'
              WHEN activity.action_type = 'task_rejected' THEN 'rework'
              WHEN activity.action_type = 'task_manager_approved' THEN 'under_review'
              WHEN activity.action_type = 'task_created' THEN 'assigned'
              ELSE NULL
            END AS restored_status
          FROM task_activity_logs activity
          WHERE activity.task_id = task.id
            AND (
              LOWER(activity.metadata ->> 'to') = ANY($2::text[])
              OR activity.action_type IN (
                'task_created',
                'task_auto_started',
                'task_submitted_for_verification',
                'task_rejected',
                'task_manager_approved'
              )
            )
          ORDER BY activity.created_at DESC, activity.id DESC
          LIMIT 1
        ) latest_status ON TRUE
        LEFT JOIN LATERAL (
          SELECT ROUND((activity.metadata ->> 'to')::numeric)::integer AS completion_percent
          FROM task_activity_logs activity
          WHERE activity.task_id = task.id
            AND activity.action_type IN (
              'task_completion_percent_updated',
              'task_auto_started',
              'task_submitted_for_verification'
            )
            AND COALESCE(activity.metadata ->> 'to', '') ~ '^[0-9]+(\\.[0-9]+)?$'
          ORDER BY activity.created_at DESC, activity.id DESC
          LIMIT 1
        ) latest_percent ON TRUE
        WHERE task.project_id = $1
          AND LOWER(COALESCE(task.status, '')) = 'closed'
          AND LOWER(COALESCE(task.verification_status, '')) = 'approved'
          AND latest_status.restored_status = ANY($2::text[])
          AND NOT EXISTS (
            SELECT 1
            FROM task_activity_logs terminal_activity
            WHERE terminal_activity.task_id = task.id
              AND (
                terminal_activity.action_type IN ('task_approved', 'task_quality_approved')
                OR LOWER(terminal_activity.metadata ->> 'to') IN ('closed', 'cancelled')
                OR LOWER(terminal_activity.metadata ->> 'verification_status') = 'approved'
              )
          )
      )
      UPDATE tasks task
      SET status = restore_candidates.restored_status,
          verification_status = CASE
            WHEN restore_candidates.restored_status = 'rework' THEN 'rejected'
            ELSE 'pending'
          END,
          lifecycle_status = CASE
            WHEN restore_candidates.restored_status = 'assigned' THEN 'assigned'
            WHEN restore_candidates.restored_status = 'rework' THEN 'rework'
            ELSE 'in_progress'
          END,
          approval_stage = CASE
            WHEN restore_candidates.restored_status = 'under_review' THEN COALESCE(NULLIF(task.approval_stage, 'closed'), 'manager')
            WHEN restore_candidates.restored_status = 'rework' THEN 'rework'
            ELSE 'execution'
          END,
          completion_percent = CASE
            WHEN restore_candidates.restored_status = 'assigned' THEN 0
            WHEN restore_candidates.restored_status = 'under_review' THEN 100
            WHEN restore_candidates.completion_percent IS NOT NULL THEN restore_candidates.completion_percent
            WHEN COALESCE(task.completion_percent, 0) >= 100 THEN 99
            ELSE COALESCE(task.completion_percent, 0)
          END,
          completed_at = CASE
            WHEN restore_candidates.restored_status = 'under_review' THEN COALESCE(task.submitted_at, task.completed_at)
            ELSE NULL
          END,
          closed_at = NULL,
          approved_at = NULL,
          approved_by = NULL,
          submitted_at = CASE
            WHEN restore_candidates.restored_status = 'under_review' THEN COALESCE(task.submitted_at, task.completed_at)
            ELSE task.submitted_at
          END,
          actual_minutes = CASE
            WHEN restore_candidates.restored_status = 'assigned' THEN COALESCE(task.actual_minutes, 0)
            ELSE task.actual_minutes
          END,
          updated_at = NOW()
      FROM restore_candidates
      WHERE task.id = restore_candidates.id
      RETURNING task.id
    `,
    [projectId, OPEN_TASK_STATUSES],
  );

  const progressResult = await client.query(
    `
      WITH active_task AS (
        SELECT DISTINCT ON (task.fixture_id, LOWER(COALESCE(task.stage, '')))
          task.id,
          task.fixture_id,
          task.department_id,
          task.stage,
          task.status,
          task.assigned_to,
          task.assigned_at,
          task.started_at,
          task.completed_at,
          task.submitted_at,
          task.updated_at
        FROM tasks task
        JOIN design.fixtures fixture
          ON fixture.id = task.fixture_id
         AND fixture.project_id = $1
        WHERE task.project_id = $1
          AND task.fixture_id IS NOT NULL
          AND NULLIF(BTRIM(task.stage), '') IS NOT NULL
          AND LOWER(COALESCE(task.status, '')) = ANY($2::text[])
        ORDER BY
          task.fixture_id,
          LOWER(COALESCE(task.stage, '')),
          CASE LOWER(task.status)
            WHEN 'under_review' THEN 0
            WHEN 'rework' THEN 1
            WHEN 'in_progress' THEN 2
            WHEN 'on_hold' THEN 3
            WHEN 'assigned' THEN 4
            ELSE 5
          END,
          task.updated_at DESC,
          task.id DESC
      ),
      matched_stage AS (
        SELECT
          active_task.*,
          fwp.stage_name,
          fwp.stage_order
        FROM active_task
        JOIN fixture_workflow_progress fwp
          ON fwp.fixture_id = active_task.fixture_id
         AND fwp.department_id = active_task.department_id
         AND LOWER(fwp.stage_name) = LOWER(active_task.stage)
      ),
      restored_current_stage AS (
        UPDATE fixture_workflow_progress fwp
        SET status = CASE LOWER(matched_stage.status)
              WHEN 'under_review' THEN 'SUBMITTED_FOR_VERIFICATION'
              WHEN 'rework' THEN 'REJECTED'
              ELSE 'IN_PROGRESS'
            END,
            assigned_to = COALESCE(matched_stage.assigned_to, fwp.assigned_to),
            assigned_at = COALESCE(fwp.assigned_at, matched_stage.assigned_at, matched_stage.started_at, matched_stage.updated_at),
            started_at = CASE
              WHEN LOWER(matched_stage.status) = 'under_review' THEN COALESCE(fwp.started_at, matched_stage.started_at, matched_stage.assigned_at)
              ELSE COALESCE(matched_stage.started_at, fwp.started_at, matched_stage.assigned_at)
            END,
            completed_at = CASE
              WHEN LOWER(matched_stage.status) = 'under_review' THEN COALESCE(matched_stage.completed_at, matched_stage.submitted_at, fwp.completed_at)
              ELSE NULL
            END,
            duration_minutes = CASE
              WHEN LOWER(matched_stage.status) = 'under_review' THEN fwp.duration_minutes
              ELSE NULL
            END,
            updated_at = NOW()
        FROM matched_stage
        WHERE fwp.fixture_id = matched_stage.fixture_id
          AND fwp.department_id = matched_stage.department_id
          AND fwp.stage_name = matched_stage.stage_name
        RETURNING fwp.fixture_id, fwp.department_id, fwp.stage_order
      ),
      active_stage AS (
        SELECT fixture_id, department_id, MIN(stage_order) AS stage_order
        FROM restored_current_stage
        GROUP BY fixture_id, department_id
      ),
      reset_future_stages AS (
        UPDATE fixture_workflow_progress fwp
        SET status = 'PENDING',
            assigned_to = NULL,
            assigned_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            duration_minutes = NULL,
            updated_at = NOW()
        FROM active_stage
        WHERE fwp.fixture_id = active_stage.fixture_id
          AND fwp.department_id = active_stage.department_id
          AND fwp.stage_order > active_stage.stage_order
          AND fwp.status = 'APPROVED'
        RETURNING fwp.id
      ),
      mark_fixtures_incomplete AS (
        UPDATE design.fixtures fixture
        SET is_workflow_complete = FALSE,
            updated_at = NOW()
        WHERE fixture.id IN (SELECT DISTINCT fixture_id FROM restored_current_stage)
          AND fixture.project_id = $1
        RETURNING fixture.id
      )
      SELECT
        (SELECT COUNT(*)::integer FROM restored_current_stage) AS progress_rows_restored,
        (SELECT COUNT(*)::integer FROM reset_future_stages) AS future_progress_rows_reset,
        (SELECT COUNT(*)::integer FROM mark_fixtures_incomplete) AS fixtures_reopened
    `,
    [projectId, OPEN_TASK_STATUSES],
  );

  const progressRow = progressResult.rows[0] || {};

  return {
    activity_tasks_restored: taskResult.rowCount || 0,
    activity_progress_rows_restored: Number(progressRow.progress_rows_restored || 0),
    activity_future_progress_rows_reset: Number(progressRow.future_progress_rows_reset || 0),
    activity_fixtures_reopened: Number(progressRow.fixtures_reopened || 0),
  };
}

async function restoreProjectWorkflowForReactivation(projectId, client = pool) {
  const snapshotRestore = await restoreProjectWorkflowFromSnapshots(projectId, client);
  const activityRestore = await restoreProjectWorkflowFromActivity(projectId, client);

  return {
    ...snapshotRestore,
    ...activityRestore,
  };
}

async function releaseProject(projectId, releasedBy, client = pool) {
  await captureProjectReleaseSnapshot(projectId, releasedBy, client);
  await setProjectLifecycleStatus(projectId, PROJECT_STATUSES.COMPLETED, client);

  await client.query(
    `
      UPDATE design.fixtures
      SET is_workflow_complete = TRUE,
          updated_at = NOW()
      WHERE project_id = $1
    `,
    [projectId],
  );

  await client.query(
    `
      UPDATE fixture_workflow_progress fwp
      SET status = 'APPROVED',
          completed_at = COALESCE(fwp.completed_at, NOW()),
          updated_at = NOW()
      FROM design.fixtures f
      WHERE f.id = fwp.fixture_id
        AND f.project_id = $1
        AND fwp.status <> 'APPROVED'
    `,
    [projectId],
  );

  await client.query(
    `
      UPDATE tasks
      SET status = 'closed',
          verification_status = 'approved',
          completion_percent = 100,
          lifecycle_status = 'completed',
          completed_at = COALESCE(completed_at, NOW()),
          closed_at = COALESCE(closed_at, NOW()),
          approved_at = COALESCE(approved_at, NOW()),
          approved_by = COALESCE(approved_by, $2),
          updated_at = NOW()
      WHERE project_id = $1
        AND status <> 'cancelled'
    `,
    [projectId, releasedBy || null],
  );
}

async function deleteFromOptionalTaskTable(tableName, taskIds, client) {
  if (taskIds.length === 0 || !(await tableExists(tableName, client))) {
    return;
  }

  await client.query(
    `DELETE FROM ${tableName} WHERE task_id = ANY($1::int[])`,
    [taskIds],
  );
}

async function deleteBatchCascade(batchId, client = pool) {
  const batchResult = await client.query(
    `SELECT id FROM design.upload_batches WHERE id = $1`,
    [batchId],
  );

  if (batchResult.rowCount === 0) {
    throw new Error(`Batch ${batchId} not found`);
  }

  const fixtureResult = await client.query(
    `SELECT id FROM design.fixtures WHERE batch_id = $1`,
    [batchId],
  );
  const fixtureIds = fixtureResult.rows.map((row) => row.id);

  if (fixtureIds.length > 0) {
    const taskIds = [];
    if (await columnExists("tasks", "fixture_id", client)) {
      const taskResult = await client.query(
        `SELECT id FROM tasks WHERE fixture_id = ANY($1::uuid[])`,
        [fixtureIds],
      );
      taskIds.push(...taskResult.rows.map((row) => Number(row.id)));
    }

    await deleteFromOptionalTaskTable("task_comments", taskIds, client);
    await deleteFromOptionalTaskTable("task_history", taskIds, client);
    await deleteFromOptionalTaskTable("task_logs", taskIds, client);
    await deleteFromOptionalTaskTable("task_activity_logs", taskIds, client);
    await deleteFromOptionalTaskTable("task_checklists", taskIds, client);
    await deleteFromOptionalTaskTable("task_attachments", taskIds, client);

    if (taskIds.length > 0) {
      await client.query(`DELETE FROM tasks WHERE id = ANY($1::int[])`, [taskIds]);
    }

    if (await tableExists("fixture_workflow_stage_attempts", client)) {
      await client.query(
        `DELETE FROM fixture_workflow_stage_attempts WHERE fixture_id = ANY($1::uuid[])`,
        [fixtureIds],
      );
    }

    await client.query(
      `DELETE FROM fixture_workflow_progress WHERE fixture_id = ANY($1::uuid[])`,
      [fixtureIds],
    );

    await client.query(
      `DELETE FROM design.fixtures WHERE id = ANY($1::uuid[])`,
      [fixtureIds],
    );
  }

  await client.query(`DELETE FROM design.upload_errors WHERE batch_id = $1`, [batchId]);
  await client.query(`DELETE FROM design.upload_batches WHERE id = $1`, [batchId]);
}

module.exports = instrumentModuleExports("repository.batchRepository", {
  BATCH_DELETE_BLOCK_REASON,
  captureProjectReleaseSnapshot,
  checkBatchDeletionBlocked,
  deleteBatchCascade,
  getBatchById,
  getBatchByIdForUser,
  getProjectLifecycleContextByIdForUser,
  listBatchesWithSummary,
  listBatchesWithSummaryForUser,
  reactivateProjectForModification,
  releaseProject,
  restoreProjectWorkflowForReactivation,
  setProjectLifecycleStatus,
});
