const { pool } = require("../db");
const { logger } = require("../lib/logger");
const { getExecutionMetadata, instrumentModuleExports, safeSerialize } = require("../lib/observability");
const {
  ensureDepartmentWorkflow,
  repairProjectDepartmentForFixture,
} = require("../services/workflowRecoveryService");

function mapWorkflowStageRows(stageRows) {
  return stageRows.map((stage, index) => ({
    id: stage.id,
    name: stage.stage_name || stage.name || null,
    order: Number(stage.sequence_order ?? stage.order_index ?? index + 1),
    is_final: Boolean(stage.is_final),
  }));
}

async function executeWorkflowQuery(operation, client, queryText, params = []) {
  const metadata = getExecutionMetadata({
    layer: "repository.fixtureWorkflowRepository",
    operation,
    query: queryText.trim(),
    params: safeSerialize(params),
  });

  logger.info("fixtureWorkflowRepository query start", metadata);

  try {
    const result = await client.query(queryText, params);
    logger.info("fixtureWorkflowRepository query success", {
      ...metadata,
      rowCount: result?.rowCount ?? result?.rows?.length ?? 0,
    });
    return result;
  } catch (error) {
    logger.error("fixtureWorkflowRepository query failed", {
      ...metadata,
      errorMessage: error?.message || "Unknown database error",
      errorDetail: error?.detail || null,
      errorCode: error?.code || null,
      constraint: error?.constraint || null,
      stack: error?.stack || null,
    });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the active workflow with ordered stages for a department, or null.
 */
async function getActiveWorkflowForDepartment(departmentId, client = pool) {
  const workflow = await ensureDepartmentWorkflow(departmentId, client);
  return workflow?.id ? workflow : null;
}

async function getConfiguredWorkflowForDepartment(departmentId, client = pool) {
  if (!departmentId) {
    return null;
  }

  const workflowResult = await client.query(
    `SELECT id, name, description, department_id, initial_stage_id
     FROM workflows
     WHERE department_id = $1
       AND is_active = TRUE
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [departmentId],
  );

  const workflow = workflowResult.rows[0];
  if (!workflow) {
    return null;
  }

  const stageResult = await client.query(
    `SELECT id, stage_name, name, sequence_order, order_index, is_final
     FROM workflow_stages
     WHERE workflow_id = $1
       AND is_active = TRUE
     ORDER BY COALESCE(sequence_order, order_index, 0) ASC, created_at ASC`,
    [workflow.id],
  );

  return {
    ...workflow,
    stages: mapWorkflowStageRows(stageResult.rows),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all progress rows for a fixture, ordered by stage_order.
 */
async function getProgressForFixture(fixtureId, departmentId, client = pool) {
  const result = await client.query(
    `SELECT * FROM fixture_workflow_progress
     WHERE fixture_id = $1 AND department_id = $2
     ORDER BY stage_order ASC`,
    [fixtureId, departmentId],
  );
  return result.rows;
}

/**
 * Inserts PENDING rows for every stage. Safe to call only once per fixture.
 */
async function initProgressForFixture(fixtureId, departmentId, stages, client = pool) {
  for (const stage of stages) {
    await client.query(
      `INSERT INTO fixture_workflow_progress
         (fixture_id, department_id, stage_name, stage_order, status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       ON CONFLICT (fixture_id, stage_name) DO NOTHING`,
      [fixtureId, departmentId, stage.name, stage.order],
    );
  }
}

/**
 * Updates specific fields on a progress row.
 */
async function updateProgressRow(fixtureId, stageName, fields, client = pool) {
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (fields.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(fields.status);
  }
  if (fields.assigned_to !== undefined) {
    setClauses.push(`assigned_to = $${idx++}`);
    values.push(fields.assigned_to);
  }
  if (fields.assigned_at !== undefined) {
    setClauses.push(`assigned_at = $${idx++}`);
    values.push(fields.assigned_at);
  }
  if (fields.started_at !== undefined) {
    setClauses.push(`started_at = $${idx++}`);
    values.push(fields.started_at);
  }
  if (fields.completed_at !== undefined) {
    setClauses.push(`completed_at = $${idx++}`);
    values.push(fields.completed_at);
  }
  if (fields.duration_minutes !== undefined) {
    setClauses.push(`duration_minutes = $${idx++}`);
    values.push(fields.duration_minutes);
  }

  if (setClauses.length === 0) return;

  setClauses.push(`updated_at = NOW()`);

  values.push(fixtureId, stageName);

  const queryText = `UPDATE fixture_workflow_progress
     SET ${setClauses.join(", ")}
     WHERE fixture_id = $${idx++} AND stage_name = $${idx++}`;

  await executeWorkflowQuery("updateProgressRow", client, queryText, values);
}

async function listStageAttemptsForFixtures(fixtureIds, client = pool) {
  if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) {
    return [];
  }

  const result = await client.query(
    `SELECT
       fixture_id,
       department_id,
       stage_name,
       attempt_no,
       status,
       assigned_to,
       assigned_at,
       started_at,
       completed_at,
       duration_minutes,
       approved_at,
       updated_at
     FROM fixture_workflow_stage_attempts
     WHERE fixture_id = ANY($1::uuid[])
     ORDER BY fixture_id ASC, stage_name ASC, attempt_no ASC`,
    [fixtureIds],
  );

  return result.rows;
}

async function getLatestStageAttempt(fixtureId, stageName, client = pool) {
  const result = await client.query(
    `SELECT
       fixture_id,
       department_id,
       stage_name,
       attempt_no,
       status,
       assigned_to,
       assigned_at,
       started_at,
       completed_at,
       duration_minutes,
       approved_at,
       updated_at
     FROM fixture_workflow_stage_attempts
     WHERE fixture_id = $1
       AND stage_name = $2
     ORDER BY attempt_no DESC
     LIMIT 1`,
    [fixtureId, stageName],
  );

  return result.rows[0] || null;
}

async function startStageAttempt(fixtureId, departmentId, stageName, assignedTo, timestamp = new Date(), client = pool) {
  const latestAttempt = await getLatestStageAttempt(fixtureId, stageName, client);

  if (!latestAttempt || latestAttempt.status === "REJECTED") {
    const nextAttemptNo = latestAttempt ? Number(latestAttempt.attempt_no) + 1 : 1;
    await client.query(
      `INSERT INTO fixture_workflow_stage_attempts (
         fixture_id,
         department_id,
         stage_name,
         attempt_no,
         status,
         assigned_to,
         assigned_at,
         started_at,
         duration_minutes,
         updated_at
       )
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $6, $6, NULL, $6)`,
      [fixtureId, departmentId, stageName, nextAttemptNo, assignedTo, timestamp],
    );
    return;
  }

  await client.query(
    `UPDATE fixture_workflow_stage_attempts
     SET status = 'IN_PROGRESS',
         assigned_to = $3,
         assigned_at = $4,
         started_at = COALESCE(started_at, $4),
         completed_at = NULL,
         duration_minutes = NULL,
         approved_at = NULL,
         updated_at = $4
     WHERE fixture_id = $1
       AND stage_name = $2
       AND attempt_no = $5`,
    [fixtureId, stageName, assignedTo, timestamp, latestAttempt.attempt_no],
  );
}

async function completeStageAttempt(fixtureId, stageName, durationMinutes = null, timestamp = new Date(), client = pool) {
  const latestAttempt = await getLatestStageAttempt(fixtureId, stageName, client);
  if (!latestAttempt) {
    return;
  }

  await client.query(
    `UPDATE fixture_workflow_stage_attempts
     SET status = 'COMPLETED',
         completed_at = $3,
         duration_minutes = $4,
         updated_at = $3
     WHERE fixture_id = $1
       AND stage_name = $2
       AND attempt_no = $5`,
    [fixtureId, stageName, timestamp, durationMinutes, latestAttempt.attempt_no],
  );
}

async function approveStageAttempt(fixtureId, stageName, timestamp = new Date(), client = pool) {
  const latestAttempt = await getLatestStageAttempt(fixtureId, stageName, client);
  if (!latestAttempt) {
    return;
  }

  await client.query(
    `UPDATE fixture_workflow_stage_attempts
     SET status = 'APPROVED',
         approved_at = $3,
         updated_at = $3
     WHERE fixture_id = $1
       AND stage_name = $2
       AND attempt_no = $4`,
    [fixtureId, stageName, timestamp, latestAttempt.attempt_no],
  );
}

async function rejectStageAttempt(fixtureId, stageName, timestamp = new Date(), client = pool) {
  const latestAttempt = await getLatestStageAttempt(fixtureId, stageName, client);
  if (!latestAttempt) {
    return;
  }

  await client.query(
    `UPDATE fixture_workflow_stage_attempts
     SET status = 'REJECTED',
         updated_at = $3
     WHERE fixture_id = $1
       AND stage_name = $2
       AND attempt_no = $4`,
    [fixtureId, stageName, timestamp, latestAttempt.attempt_no],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks a fixture as fully completed (all stages approved).
 */
async function markFixtureComplete(fixtureId, client = pool) {
  await client.query(
    `UPDATE design.fixtures SET is_workflow_complete = TRUE WHERE id = $1`,
    [fixtureId],
  );
}

/**
 * Returns the fixture's department_id by joining through scopes → projects.
 */
async function getFixtureWithDepartment(fixtureId, fallbackDepartmentId = null, client = pool) {
  if (fallbackDepartmentId) {
    await repairProjectDepartmentForFixture(fixtureId, fallbackDepartmentId, client);
  }

  const result = await client.query(
    `SELECT df.id AS fixture_id, dp.department_id
     FROM design.fixtures df
     JOIN design.scopes ds ON ds.id = df.scope_id
     JOIN design.projects dp ON dp.id = ds.project_id
     WHERE df.id = $1
     LIMIT 1`,
    [fixtureId],
  );
  return result.rows[0] || null;
}

async function getFixtureWorkflowContext(fixtureId, client = pool) {
  const result = await client.query(
    `SELECT
       df.id AS fixture_id,
       df.fixture_no,
       df.scope_id,
       ds.scope_name,
       ds.project_id,
       dp.project_no,
       dp.project_name,
       dp.department_id
     FROM design.fixtures df
     JOIN design.scopes ds ON ds.id = df.scope_id
     JOIN design.projects dp ON dp.id = ds.project_id
     WHERE df.id = $1
     LIMIT 1`,
    [fixtureId],
  );

  return result.rows[0] || null;
}

async function resolveFixtureByCanonicalIdentity({ project_id, scope_id, fixture_no }, departmentId, client = pool) {
  if (!project_id || !scope_id || !fixture_no || !departmentId) {
    return null;
  }

  const result = await client.query(
    `SELECT
       df.id AS fixture_id,
       df.fixture_no,
       df.scope_id,
       ds.scope_name,
       ds.project_id,
       dp.project_no,
       dp.project_name,
       dp.department_id
     FROM design.fixtures df
     JOIN design.scopes ds ON ds.id = df.scope_id
     JOIN design.projects dp ON dp.id = ds.project_id
     WHERE df.project_id = $1
       AND df.scope_id = $2
       AND df.fixture_no = $3
       AND dp.department_id = $4
     LIMIT 1`,
    [project_id, scope_id, fixture_no, departmentId],
  );

  return result.rows[0] || null;
}

/**
 * Lists fixtures for a scope that are NOT fully completed, for the given department.
 */
async function listAssignableFixtures(departmentId, scopeId, client = pool) {
  const result = await client.query(
    `SELECT df.id, df.scope_id, df.fixture_no, df.op_no, df.part_name, df.fixture_type, df.qty
     FROM design.fixtures df
     JOIN design.scopes ds ON ds.id = df.scope_id
     JOIN design.projects dp ON dp.id = ds.project_id
     WHERE df.scope_id = $1
       AND dp.department_id = $2
       AND df.is_workflow_complete = FALSE
     ORDER BY df.fixture_no ASC, df.id ASC`,
    [scopeId, departmentId],
  );
  return result.rows;
}

module.exports = instrumentModuleExports("repository.fixtureWorkflowRepository", {
  approveStageAttempt,
  completeStageAttempt,
  getActiveWorkflowForDepartment,
  getConfiguredWorkflowForDepartment,
  getLatestStageAttempt,
  getProgressForFixture,
  initProgressForFixture,
  getFixtureWithDepartment,
  getFixtureWorkflowContext,
  resolveFixtureByCanonicalIdentity,
  listAssignableFixtures,
  listStageAttemptsForFixtures,
  markFixtureComplete,
  rejectStageAttempt,
  startStageAttempt,
  updateProgressRow,
});
