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

function fixtureOperationalStatsLateral(projectAlias = "dp") {
  const stateCase = operationalStateSqlCase({
    fixtureAlias: "f",
    projectAlias,
    taskAlias: "operational_task",
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
      completion_truth_errors: truth?.completion_truth_errors || ["completion_truth_unavailable"],
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
  };
}

async function listBatchesWithSummary(departmentId, client = pool) {
  const params = [];
  const departmentFilter = departmentId ? "WHERE dp.department_id = $1" : "";

  if (departmentId) {
    params.push(departmentId);
  }

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
        FALSE AS can_toggle_modification
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
      ${fixtureOperationalStatsLateral("dp")}
      ${departmentFilter}
      ORDER BY COALESCE(ub.uploaded_at, dp.updated_at, dp.created_at) DESC
    `,
    [...params, PROJECT_STATUSES.ACTIVE],
  );

  return enrichBatchSummariesWithCompletionTruth(result.rows.map(mapBatchSummary), client);
}


  // NOTE: debug logging for per-user batch listing

async function listBatchesWithSummaryForUser(user, departmentId, client = pool) {
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
        ${projectModificationPermissionSql("dp", "$1")} AS can_toggle_modification
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
      ${fixtureOperationalStatsLateral("dp")}
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

  return enrichBatchSummariesWithCompletionTruth(result.rows.map(mapBatchSummary), client);
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
        FALSE AS can_toggle_modification
      FROM design.upload_batches ub
      JOIN design.projects dp ON dp.id = ub.project_id
      ${userResolutionLateralSql("uploader", [
        { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
        { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
        { expression: "dp.uploaded_by", source: "project_uploaded_by" },
        { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${fixtureOperationalStatsLateral("dp")}
      WHERE ub.id = $1
    `,
    [batchId, PROJECT_STATUSES.ACTIVE],
  );

  const summaries = await enrichBatchSummariesWithCompletionTruth(result.rows.map(mapBatchSummary), client);
  return summaries[0] || null;
}


async function getBatchByIdForUser(batchId, user, client = pool) {
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
        ${projectModificationPermissionSql("dp", "$1")} AS can_toggle_modification
      FROM design.upload_batches ub
      JOIN design.projects dp ON dp.id = ub.project_id
      ${userResolutionLateralSql("uploader", [
        { expression: "ub.uploaded_by_user_id", source: "upload_batch_uploaded_by_user_id" },
        { expression: "ub.uploaded_by", source: "upload_batch_uploaded_by" },
        { expression: "dp.uploaded_by", source: "project_uploaded_by" },
        { expression: "dp.created_by_user_id", source: "project_created_by_user_id" },
      ])}
      ${fixtureOperationalStatsLateral("dp")}
      WHERE ub.id = $2
        AND ${visibleProjectPredicate("dp")}
    `,
    [
      user.employee_id,
      batchId,
      PROJECT_STATUSES.ACTIVE,
    ],
  );

  await _debugLogBatchQueryForUser("getBatchByIdForUser", user, null, result.rows, client);
  const summaries = await enrichBatchSummariesWithCompletionTruth(result.rows.map(mapBatchSummary), client);
  return summaries[0] || null;
}

async function getProjectLifecycleContextByIdForUser(projectId, user, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        active_batch.id AS batch_id,
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
        SELECT id
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
        AND status IN ($3, $4)
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
    [projectId, PROJECT_STATUSES.ACTIVE, PROJECT_STATUSES.COMPLETED, PROJECT_STATUSES.RELEASED],
  );

  return result.rows[0] || null;
}

async function releaseProject(projectId, releasedBy, client = pool) {
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
  checkBatchDeletionBlocked,
  deleteBatchCascade,
  getBatchById,
  getBatchByIdForUser,
  getProjectLifecycleContextByIdForUser,
  listBatchesWithSummary,
  listBatchesWithSummaryForUser,
  reactivateProjectForModification,
  releaseProject,
  setProjectLifecycleStatus,
});
