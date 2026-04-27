const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");

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
    scope_id: row.scope_id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    department_id: row.department_id,
    scope_name: row.scope_name,
    uploaded_by: row.uploaded_by,
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

  const result = await client.query(
    `
      SELECT
        ub.id,
        ub.project_id,
        ub.scope_id,
        dp.project_no,
        dp.project_name,
        dp.customer_name,
        dp.department_id,
        ds.scope_name,
        ub.uploaded_by,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COUNT(DISTINCT f.id)::integer AS total_fixtures,
        COUNT(DISTINCT f.id) FILTER (
          WHERE fwp.status IS NOT NULL
            AND NOT (fwp.status = ANY($${params.length + 1}::text[]))
        )::integer AS active_count
      FROM design.upload_batches ub
      JOIN design.scopes ds ON ds.id = ub.scope_id
      JOIN design.projects dp ON dp.id = ub.project_id
      LEFT JOIN design.fixtures f ON f.batch_id = ub.id
      LEFT JOIN fixture_workflow_progress fwp ON fwp.fixture_id = f.id
      ${departmentFilter}
      GROUP BY ub.id, ub.project_id, ub.scope_id, dp.project_no, dp.project_name, dp.customer_name, dp.department_id, ds.scope_name
      ORDER BY ub.uploaded_at DESC
    `,
    [...params, DELETABLE_FIXTURE_STATUSES],
  );

  return result.rows.map(mapBatchSummary);
}

async function getBatchById(batchId, client = pool) {
  const result = await client.query(
    `
      SELECT
        ub.id,
        ub.project_id,
        ub.scope_id,
        dp.project_no,
        dp.project_name,
        dp.customer_name,
        dp.department_id,
        ds.scope_name,
        ub.uploaded_by,
        ub.uploaded_at,
        ub.accepted_rows,
        ub.rejected_rows,
        COUNT(DISTINCT f.id)::integer AS total_fixtures,
        COUNT(DISTINCT f.id) FILTER (
          WHERE fwp.status IS NOT NULL
            AND NOT (fwp.status = ANY($2::text[]))
        )::integer AS active_count
      FROM design.upload_batches ub
      JOIN design.scopes ds ON ds.id = ub.scope_id
      JOIN design.projects dp ON dp.id = ub.project_id
      LEFT JOIN design.fixtures f ON f.batch_id = ub.id
      LEFT JOIN fixture_workflow_progress fwp ON fwp.fixture_id = f.id
      WHERE ub.id = $1
      GROUP BY ub.id, ub.project_id, ub.scope_id, dp.project_no, dp.project_name, dp.customer_name, dp.department_id, ds.scope_name
    `,
    [batchId, DELETABLE_FIXTURE_STATUSES],
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
  listBatchesWithSummary,
});
