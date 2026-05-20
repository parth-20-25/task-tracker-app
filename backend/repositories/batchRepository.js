const { pool } = require("../db");
const { PROJECT_STATUSES } = require("../config/constants");
const { instrumentModuleExports } = require("../lib/observability");
const { buildVisibleUsersCte, visibleProjectPredicate } = require("./projectVisibility");

const BATCH_DELETE_BLOCK_REASON = "Cannot delete batch. Some fixtures have active or pending approval tasks.";
const DELETABLE_FIXTURE_STATUSES = ["PENDING", "REJECTED"];
const SCHEMA_METADATA_TTL_MS = 60 * 1000;
const schemaMetadataCache = new Map();

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

  return {
    id: row.id,
    batch_id: row.id,
    project_id: row.project_id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    department_id: row.department_id,
    project_status: row.project_status || PROJECT_STATUSES.ACTIVE,
    project_completion_percent: row.project_completion_percent === null || row.project_completion_percent === undefined
      ? 0
      : Number(row.project_completion_percent),
    total_tasks: Number(row.total_tasks || 0),
    pending_tasks: Number(row.pending_tasks || 0),
    completed_tasks: Number(row.completed_tasks || 0),
    uploaded_by: row.uploaded_by,
    uploaded_by_user_id: row.uploaded_by_user_id || row.uploaded_by || null,
    uploaded_at: row.uploaded_at,
    created_at: row.uploaded_at,
    accepted_rows: Number(row.accepted_rows || 0),
    rejected_rows: Number(row.rejected_rows || 0),
    total_fixtures: totalFixtures,
    active_count: activeCount,
    status_summary: `${activeCount} active / ${totalFixtures} total`,
    deletion_blocked: activeCount > 0,
    delete_blocked_reason: activeCount > 0 ? BATCH_DELETE_BLOCK_REASON : null,
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
        ub.id,
        ub.project_id,
        dp.project_no,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $${params.length + 2}) AS project_status,
        COALESCE(task_stats.total_tasks, 0)::integer AS total_tasks,
        COALESCE(task_stats.pending_tasks, 0)::integer AS pending_tasks,
        COALESCE(task_stats.completed_tasks, 0)::integer AS completed_tasks,
        CASE
          WHEN COALESCE(dp.status, $${params.length + 2}) = $${params.length + 3} THEN 100::numeric
          WHEN COALESCE(task_stats.total_tasks, 0) = 0 THEN 0::numeric
          ELSE ROUND(task_stats.avg_completion_percent::numeric, 2)
        END AS project_completion_percent,
        ub.uploaded_by,
        ub.uploaded_by_user_id,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COUNT(DISTINCT pf.id)::integer AS total_fixtures,
        COUNT(DISTINCT pf.id) FILTER (
          WHERE fwp.status IS NOT NULL
            AND NOT (fwp.status = ANY($${params.length + 1}::text[]))
        )::integer AS active_count
      FROM (
        SELECT DISTINCT ON (project_id)
          id,
          project_id,
          uploaded_by,
          uploaded_by_user_id,
          uploaded_at,
          accepted_rows,
          rejected_rows
        FROM design.upload_batches
        WHERE COALESCE(status, 'active') = 'active'
        ORDER BY project_id, uploaded_at DESC, id DESC
      ) ub
      JOIN design.projects dp ON dp.id = ub.project_id
      LEFT JOIN design.fixtures pf ON pf.project_id = dp.id
      LEFT JOIN fixture_workflow_progress fwp ON fwp.fixture_id = pf.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::integer AS total_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') NOT IN ('closed', 'cancelled'))::integer AS pending_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') = 'closed')::integer AS completed_tasks,
          AVG(
            COALESCE(
              t.completion_percent,
              CASE WHEN t.status = 'closed' OR t.verification_status = 'approved' THEN 100 ELSE 0 END
            )
          ) AS avg_completion_percent
        FROM tasks t
        WHERE t.project_id = dp.id
          AND COALESCE(t.status, '') <> 'cancelled'
      ) task_stats ON TRUE
      ${departmentFilter}
      GROUP BY
        ub.id,
        ub.project_id,
        dp.project_no,
        dp.project_name,
        dp.customer_name,
        dp.department_id,
        dp.status,
        task_stats.total_tasks,
        task_stats.pending_tasks,
        task_stats.completed_tasks,
        task_stats.avg_completion_percent
      ORDER BY ub.uploaded_at DESC
    `,
    [...params, DELETABLE_FIXTURE_STATUSES, PROJECT_STATUSES.ACTIVE, PROJECT_STATUSES.COMPLETED],
  );

  return result.rows.map(mapBatchSummary);
}

async function listBatchesWithSummaryForUser(user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        ub.id,
        ub.project_id,
        dp.project_no,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $4) AS project_status,
        COALESCE(task_stats.total_tasks, 0)::integer AS total_tasks,
        COALESCE(task_stats.pending_tasks, 0)::integer AS pending_tasks,
        COALESCE(task_stats.completed_tasks, 0)::integer AS completed_tasks,
        CASE
          WHEN COALESCE(dp.status, $4) = $5 THEN 100::numeric
          WHEN COALESCE(task_stats.total_tasks, 0) = 0 THEN 0::numeric
          ELSE ROUND(task_stats.avg_completion_percent::numeric, 2)
        END AS project_completion_percent,
        ub.uploaded_by,
        ub.uploaded_by_user_id,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COUNT(DISTINCT pf.id)::integer AS total_fixtures,
        COUNT(DISTINCT pf.id) FILTER (
          WHERE fwp.status IS NOT NULL
            AND NOT (fwp.status = ANY($3::text[]))
        )::integer AS active_count
      FROM (
        SELECT DISTINCT ON (project_id)
          id,
          project_id,
          uploaded_by,
          uploaded_by_user_id,
          uploaded_at,
          accepted_rows,
          rejected_rows
        FROM design.upload_batches
        WHERE COALESCE(status, 'active') = 'active'
        ORDER BY project_id, uploaded_at DESC, id DESC
      ) ub
      JOIN design.projects dp ON dp.id = ub.project_id
      LEFT JOIN design.fixtures pf ON pf.project_id = dp.id
      LEFT JOIN fixture_workflow_progress fwp ON fwp.fixture_id = pf.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::integer AS total_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') NOT IN ('closed', 'cancelled'))::integer AS pending_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') = 'closed')::integer AS completed_tasks,
          AVG(
            COALESCE(
              t.completion_percent,
              CASE WHEN t.status = 'closed' OR t.verification_status = 'approved' THEN 100 ELSE 0 END
            )
          ) AS avg_completion_percent
        FROM tasks t
        WHERE t.project_id = dp.id
          AND COALESCE(t.status, '') <> 'cancelled'
      ) task_stats ON TRUE
      WHERE ($2::text IS NULL OR dp.department_id = $2)
        AND ${visibleProjectPredicate("dp")}
      GROUP BY
        ub.id,
        ub.project_id,
        dp.project_no,
        dp.project_name,
        dp.customer_name,
        dp.department_id,
        dp.status,
        task_stats.total_tasks,
        task_stats.pending_tasks,
        task_stats.completed_tasks,
        task_stats.avg_completion_percent
      ORDER BY
        CASE COALESCE(dp.status, $4)
          WHEN $4 THEN 0
          WHEN $6 THEN 1
          WHEN $5 THEN 2
          ELSE 3
        END,
        ub.uploaded_at DESC
    `,
    [
      user.employee_id,
      departmentId,
      DELETABLE_FIXTURE_STATUSES,
      PROJECT_STATUSES.ACTIVE,
      PROJECT_STATUSES.COMPLETED,
      PROJECT_STATUSES.ON_HOLD,
    ],
  );

  return result.rows.map(mapBatchSummary);
}

async function getBatchById(batchId, client = pool) {
  const result = await client.query(
    `
      SELECT
        ub.id,
        ub.project_id,
        dp.project_no,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $3) AS project_status,
        COALESCE(task_stats.total_tasks, 0)::integer AS total_tasks,
        COALESCE(task_stats.pending_tasks, 0)::integer AS pending_tasks,
        COALESCE(task_stats.completed_tasks, 0)::integer AS completed_tasks,
        CASE
          WHEN COALESCE(dp.status, $3) = $4 THEN 100::numeric
          WHEN COALESCE(task_stats.total_tasks, 0) = 0 THEN 0::numeric
          ELSE ROUND(task_stats.avg_completion_percent::numeric, 2)
        END AS project_completion_percent,
        ub.uploaded_by,
        ub.uploaded_by_user_id,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COUNT(DISTINCT f.id)::integer AS total_fixtures,
        COUNT(DISTINCT f.id) FILTER (
          WHERE fwp.status IS NOT NULL
            AND NOT (fwp.status = ANY($2::text[]))
        )::integer AS active_count
      FROM design.upload_batches ub
      JOIN design.projects dp ON dp.id = ub.project_id
      LEFT JOIN design.fixtures f ON f.batch_id = ub.id
      LEFT JOIN fixture_workflow_progress fwp ON fwp.fixture_id = f.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::integer AS total_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') NOT IN ('closed', 'cancelled'))::integer AS pending_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') = 'closed')::integer AS completed_tasks,
          AVG(
            COALESCE(
              t.completion_percent,
              CASE WHEN t.status = 'closed' OR t.verification_status = 'approved' THEN 100 ELSE 0 END
            )
          ) AS avg_completion_percent
        FROM tasks t
        WHERE t.project_id = dp.id
          AND COALESCE(t.status, '') <> 'cancelled'
      ) task_stats ON TRUE
      WHERE ub.id = $1
      GROUP BY
        ub.id,
        ub.project_id,
        dp.project_no,
        dp.project_name,
        dp.customer_name,
        dp.department_id,
        dp.status,
        task_stats.total_tasks,
        task_stats.pending_tasks,
        task_stats.completed_tasks,
        task_stats.avg_completion_percent
    `,
    [batchId, DELETABLE_FIXTURE_STATUSES, PROJECT_STATUSES.ACTIVE, PROJECT_STATUSES.COMPLETED],
  );

  return result.rows[0] ? mapBatchSummary(result.rows[0]) : null;
}

async function getBatchByIdForUser(batchId, user, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        ub.id,
        ub.project_id,
        dp.project_no,
        COALESCE(NULLIF(BTRIM(dp.project_name), ''), dp.project_no) AS project_name,
        dp.customer_name,
        dp.department_id,
        COALESCE(dp.status, $4) AS project_status,
        COALESCE(task_stats.total_tasks, 0)::integer AS total_tasks,
        COALESCE(task_stats.pending_tasks, 0)::integer AS pending_tasks,
        COALESCE(task_stats.completed_tasks, 0)::integer AS completed_tasks,
        CASE
          WHEN COALESCE(dp.status, $4) = $5 THEN 100::numeric
          WHEN COALESCE(task_stats.total_tasks, 0) = 0 THEN 0::numeric
          ELSE ROUND(task_stats.avg_completion_percent::numeric, 2)
        END AS project_completion_percent,
        ub.uploaded_by,
        ub.uploaded_by_user_id,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COUNT(DISTINCT f.id)::integer AS total_fixtures,
        COUNT(DISTINCT f.id) FILTER (
          WHERE fwp.status IS NOT NULL
            AND NOT (fwp.status = ANY($3::text[]))
        )::integer AS active_count
      FROM design.upload_batches ub
      JOIN design.projects dp ON dp.id = ub.project_id
      LEFT JOIN design.fixtures f ON f.batch_id = ub.id
      LEFT JOIN fixture_workflow_progress fwp ON fwp.fixture_id = f.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::integer AS total_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') NOT IN ('closed', 'cancelled'))::integer AS pending_tasks,
          COUNT(*) FILTER (WHERE COALESCE(t.status, '') = 'closed')::integer AS completed_tasks,
          AVG(
            COALESCE(
              t.completion_percent,
              CASE WHEN t.status = 'closed' OR t.verification_status = 'approved' THEN 100 ELSE 0 END
            )
          ) AS avg_completion_percent
        FROM tasks t
        WHERE t.project_id = dp.id
          AND COALESCE(t.status, '') <> 'cancelled'
      ) task_stats ON TRUE
      WHERE ub.id = $2
        AND ${visibleProjectPredicate("dp")}
      GROUP BY
        ub.id,
        ub.project_id,
        dp.project_no,
        dp.project_name,
        dp.customer_name,
        dp.department_id,
        dp.status,
        task_stats.total_tasks,
        task_stats.pending_tasks,
        task_stats.completed_tasks,
        task_stats.avg_completion_percent
    `,
    [
      user.employee_id,
      batchId,
      DELETABLE_FIXTURE_STATUSES,
      PROJECT_STATUSES.ACTIVE,
      PROJECT_STATUSES.COMPLETED,
    ],
  );

  return result.rows[0] ? mapBatchSummary(result.rows[0]) : null;
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
          completed_at = CASE WHEN $2 = $3 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [projectId, status, PROJECT_STATUSES.COMPLETED],
  );

  return result.rowCount > 0;
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
  listBatchesWithSummary,
  listBatchesWithSummaryForUser,
  releaseProject,
  setProjectLifecycleStatus,
});
