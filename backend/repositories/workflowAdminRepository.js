const { pool } = require("../db");

// ============ WORKFLOWS ============

async function listWorkflows(client = pool) {
  const result = await client.query(
    `
      SELECT w.*, d.name AS department_name
      FROM workflows w
      LEFT JOIN departments d ON d.id = w.department_id
      WHERE w.is_active = TRUE
      ORDER BY d.name ASC NULLS LAST, w.name ASC
    `
  );
  return result.rows;
}

async function findWorkflowById(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT w.*, d.name AS department_name
      FROM workflows w
      LEFT JOIN departments d ON d.id = w.department_id
      WHERE w.id = $1 AND w.is_active = TRUE
      LIMIT 1
    `,
    [workflowId]
  );
  return result.rows[0] || null;
}

async function findWorkflowByIdIncludingInactive(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT w.*, d.name AS department_name
      FROM workflows w
      LEFT JOIN departments d ON d.id = w.department_id
      WHERE w.id = $1
      LIMIT 1
    `,
    [workflowId]
  );
  return result.rows[0] || null;
}

async function upsertWorkflow(workflow, client = pool) {
  const result = await client.query(
    `
      INSERT INTO workflows (id, name, description, department_id, initial_stage_id, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          department_id = EXCLUDED.department_id,
          initial_stage_id = EXCLUDED.initial_stage_id,
          is_active = COALESCE(EXCLUDED.is_active, workflows.is_active),
          updated_at = NOW()
      RETURNING *
    `,
    [
      workflow.id,
      workflow.name,
      workflow.description,
      workflow.department_id || null,
      workflow.initial_stage_id,
      workflow.is_active,
    ]
  );
  return result.rows[0];
}

async function softDeleteWorkflow(workflowId, client = pool) {
  const result = await client.query(
    "UPDATE workflows SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [workflowId]
  );
  return result.rows[0];
}

// ============ WORKFLOW STAGES ============

async function listWorkflowStages(workflowId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_stages WHERE workflow_id = $1 AND is_active = TRUE ORDER BY COALESCE(sequence_order, order_index, 0) ASC, created_at ASC",
    [workflowId]
  );
  return result.rows;
}

async function findStageById(stageId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_stages WHERE id = $1 AND is_active = TRUE LIMIT 1",
    [stageId]
  );
  return result.rows[0] || null;
}

async function findStageByIdIncludingInactive(stageId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_stages WHERE id = $1 LIMIT 1",
    [stageId]
  );
  return result.rows[0] || null;
}

async function upsertWorkflowStage(stage, client = pool) {
  const result = await client.query(
    `
      INSERT INTO workflow_stages (id, workflow_id, stage_name, name, description, sequence_order, is_final, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, (
        SELECT COALESCE(MAX(sequence_order), MAX(order_index), 0) + 1
        FROM workflow_stages
        WHERE workflow_id = $2
      )), $7, COALESCE($8, TRUE), NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET stage_name = EXCLUDED.stage_name,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          sequence_order = EXCLUDED.sequence_order,
          is_final = EXCLUDED.is_final,
          is_active = COALESCE(EXCLUDED.is_active, workflow_stages.is_active),
          updated_at = NOW()
      RETURNING *
    `,
    [
      stage.id,
      stage.workflow_id,
      stage.stage_name || stage.name,
      stage.name || stage.stage_name,
      stage.description,
      stage.sequence_order ?? null,
      stage.is_final,
      stage.is_active,
    ]
  );
  return result.rows[0];
}

async function findWorkflowByDepartmentId(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT w.*, d.name AS department_name
      FROM workflows w
      LEFT JOIN departments d ON d.id = w.department_id
      WHERE w.department_id = $1 AND w.is_active = TRUE
      LIMIT 1
    `,
    [departmentId],
  );

  return result.rows[0] || null;
}

async function deleteWorkflowPermanently(workflowId, client = pool) {
  const result = await client.query(
    "DELETE FROM workflows WHERE id = $1 RETURNING *",
    [workflowId],
  );

  return result.rows[0] || null;
}

async function replaceWorkflowStages(workflowId, stages, client = pool) {
  await client.query("DELETE FROM workflow_stages WHERE workflow_id = $1", [workflowId]);

  const savedStages = [];

  for (const stage of stages) {
    const result = await client.query(
      `
        INSERT INTO workflow_stages (
          id,
          workflow_id,
          stage_name,
          name,
          description,
          order_index,
          sequence_order,
          is_final,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $3, $4, $5, $5, $6, TRUE, NOW(), NOW())
        RETURNING *
      `,
      [
        stage.id,
        workflowId,
        stage.stage_name,
        stage.description || "",
        stage.sequence_order,
        stage.is_final === true,
      ],
    );

    savedStages.push(result.rows[0]);
  }

  return savedStages;
}

async function softDeleteWorkflowStage(stageId, client = pool) {
  const result = await client.query(
    "UPDATE workflow_stages SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [stageId]
  );
  return result.rows[0];
}

// ============ WORKFLOW TRANSITIONS ============

async function listWorkflowTransitions(workflowId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_transitions WHERE workflow_id = $1 AND is_active = TRUE ORDER BY created_at ASC",
    [workflowId]
  );
  return result.rows;
}

async function findTransitionById(transitionId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_transitions WHERE id = $1 AND is_active = TRUE LIMIT 1",
    [transitionId]
  );
  return result.rows[0] || null;
}

async function findTransitionByIdIncludingInactive(transitionId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_transitions WHERE id = $1 LIMIT 1",
    [transitionId]
  );
  return result.rows[0] || null;
}

async function upsertWorkflowTransition(transition, client = pool) {
  const result = await client.query(
    `
      INSERT INTO workflow_transitions 
        (id, workflow_id, from_stage_id, to_stage_id, action_name, required_permission, conditions, is_active, created_at, updated_at)
      VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8, TRUE), NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET workflow_id = EXCLUDED.workflow_id,
          from_stage_id = EXCLUDED.from_stage_id,
          to_stage_id = EXCLUDED.to_stage_id,
          action_name = EXCLUDED.action_name,
          required_permission = EXCLUDED.required_permission,
          conditions = EXCLUDED.conditions,
          is_active = COALESCE(EXCLUDED.is_active, workflow_transitions.is_active),
          updated_at = NOW()
      RETURNING *
    `,
    [transition.id || null, transition.workflow_id, transition.from_stage_id, 
     transition.to_stage_id, transition.action_name, transition.required_permission, 
     JSON.stringify(transition.conditions || {}), transition.is_active]
  );
  return result.rows[0];
}

async function softDeleteWorkflowTransition(transitionId, client = pool) {
  const result = await client.query(
    "UPDATE workflow_transitions SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [transitionId]
  );
  return result.rows[0];
}

// ============ DEPENDENCY CHECKS ============

/**
 * Check if a workflow is actively used (has tasks in active stages).
 */
async function checkWorkflowInUse(workflowId, client = pool) {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM tasks 
     WHERE workflow_id = $1
       AND COALESCE(lifecycle_status, 'assigned') NOT IN ('completed', 'cancelled')`,
    [workflowId]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Check if a workflow stage is actively used (has tasks in that stage).
 */
async function checkStageInUse(stageId, client = pool) {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM tasks 
     WHERE current_stage_id = $1
       AND COALESCE(lifecycle_status, 'assigned') NOT IN ('completed', 'cancelled')`,
    [stageId]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Get all dependencies (tasks, transitions) before deletion.
 */
async function getWorkflowDependencies(workflowId, client = pool) {
  const tasksResult = await client.query(
    `SELECT COUNT(*) as count FROM tasks WHERE workflow_id = $1`,
    [workflowId]
  );
  const taskCount = parseInt(tasksResult.rows[0].count, 10);

  const stagesResult = await client.query(
    `SELECT COUNT(*) as count FROM workflow_stages WHERE workflow_id = $1`,
    [workflowId]
  );
  const stageCount = parseInt(stagesResult.rows[0].count, 10);

  const transitionsResult = await client.query(
    `SELECT COUNT(*) as count FROM workflow_transitions WHERE workflow_id = $1`,
    [workflowId]
  );
  const transitionCount = parseInt(transitionsResult.rows[0].count, 10);

  return {
    tasks: taskCount,
    stages: stageCount,
    transitions: transitionCount,
    total: taskCount + stageCount + transitionCount,
  };
}

/**
 * Get all dependencies (transitions, tasks) before deleting a stage.
 */
async function getStageDependencies(stageId, client = pool) {
  const outgoingTransitions = await client.query(
    `SELECT COUNT(*) as count FROM workflow_transitions WHERE from_stage_id = $1`,
    [stageId]
  );

  const incomingTransitions = await client.query(
    `SELECT COUNT(*) as count FROM workflow_transitions WHERE to_stage_id = $1`,
    [stageId]
  );

  const tasksResult = await client.query(
    `SELECT COUNT(*) as count FROM tasks WHERE current_stage_id = $1`,
    [stageId]
  );

  return {
    outgoingTransitions: parseInt(outgoingTransitions.rows[0].count, 10),
    incomingTransitions: parseInt(incomingTransitions.rows[0].count, 10),
    tasks: parseInt(tasksResult.rows[0].count, 10),
  };
}

module.exports = {
  listWorkflows,
  findWorkflowById,
  findWorkflowByIdIncludingInactive,
  findWorkflowByDepartmentId,
  deleteWorkflowPermanently,
  replaceWorkflowStages,
  upsertWorkflow,
  softDeleteWorkflow,
  listWorkflowStages,
  findStageById,
  findStageByIdIncludingInactive,
  upsertWorkflowStage,
  softDeleteWorkflowStage,
  listWorkflowTransitions,
  findTransitionById,
  findTransitionByIdIncludingInactive,
  upsertWorkflowTransition,
  softDeleteWorkflowTransition,
  checkWorkflowInUse,
  checkStageInUse,
  getWorkflowDependencies,
  getStageDependencies,
};
