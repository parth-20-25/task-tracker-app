const { pool } = require("../db");
const { AppError } = require("../lib/AppError");

async function getWorkflow(workflowId) {
  const result = await pool.query(
    "SELECT * FROM workflows WHERE id = $1 AND is_active = TRUE",
    [workflowId],
  );

  return result.rows[0] || null;
}

async function getWorkflowStages(workflowId) {
  const result = await pool.query(
    `
      SELECT *
      FROM workflow_stages
      WHERE workflow_id = $1
        AND is_active = TRUE
      ORDER BY sequence_order ASC, created_at ASC
    `,
    [workflowId],
  );

  return result.rows;
}

async function getStageById(stageId, client = pool) {
  const result = await client.query(
    "SELECT * FROM workflow_stages WHERE id = $1 AND is_active = TRUE LIMIT 1",
    [stageId],
  );

  return result.rows[0] || null;
}

async function getAdjacentWorkflowStage(workflowId, currentStageId, direction) {
  const stages = await getWorkflowStages(workflowId);
  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);

  if (currentIndex === -1) {
    throw new AppError(400, "Current workflow stage is not valid");
  }

  const adjacentIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
  return stages[adjacentIndex] || null;
}

module.exports = {
  getWorkflow,
  getWorkflowStages,
  getStageById,
  getAdjacentWorkflowStage,
};
