const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { assertSafeScriptExecution } = require("../lib/scriptGuards");

assertSafeScriptExecution("scripts/backfillStartedTaskState.js");

const { pool } = require("../db");

const BACKFILL_STARTED_TASK_STATE_SQL = `
  WITH invalid_tasks AS (
    SELECT
      t.id,
      t.fixture_id,
      t.department_id,
      t.assigned_to,
      COALESCE(t.started_at, t.assigned_at, t.created_at, NOW()) AS effective_started_at,
      COALESCE(NULLIF(t.stage, ''), ws.stage_name, ws.name, current_progress.stage_name) AS stage_name
    FROM tasks t
    LEFT JOIN workflow_stages ws ON ws.id = t.current_stage_id
    LEFT JOIN LATERAL (
      SELECT fwp.stage_name
      FROM fixture_workflow_progress fwp
      WHERE fwp.fixture_id = t.fixture_id
        AND fwp.department_id = t.department_id
        AND fwp.status <> 'APPROVED'
      ORDER BY fwp.stage_order ASC NULLS LAST, fwp.updated_at DESC
      LIMIT 1
    ) current_progress ON TRUE
    WHERE COALESCE(t.completion_percent, 0) > 0
      AND LOWER(COALESCE(t.status, '')) IN ('assigned', 'pending')
  ),
  updated_tasks AS (
    UPDATE tasks t
    SET status = 'in_progress',
        lifecycle_status = 'in_progress',
        started_at = invalid_tasks.effective_started_at,
        verification_status = COALESCE(NULLIF(t.verification_status, ''), 'pending'),
        approval_stage = COALESCE(NULLIF(t.approval_stage, ''), 'execution'),
        completed_at = NULL,
        closed_at = NULL,
        submitted_at = NULL,
        updated_at = NOW()
    FROM invalid_tasks
    WHERE t.id = invalid_tasks.id
    RETURNING
      t.id,
      invalid_tasks.fixture_id,
      invalid_tasks.department_id,
      invalid_tasks.assigned_to,
      invalid_tasks.effective_started_at,
      invalid_tasks.stage_name
  ),
  updated_progress AS (
    UPDATE fixture_workflow_progress fwp
    SET status = 'IN_PROGRESS',
        assigned_to = COALESCE(NULLIF(fwp.assigned_to, ''), updated_tasks.assigned_to),
        assigned_at = COALESCE(fwp.assigned_at, updated_tasks.effective_started_at),
        started_at = COALESCE(fwp.started_at, updated_tasks.effective_started_at),
        completed_at = NULL,
        duration_minutes = NULL,
        updated_at = NOW()
    FROM updated_tasks
    WHERE fwp.fixture_id = updated_tasks.fixture_id
      AND fwp.department_id = updated_tasks.department_id
      AND LOWER(fwp.stage_name) = LOWER(updated_tasks.stage_name)
    RETURNING fwp.fixture_id
  )
  SELECT
    (SELECT COUNT(*)::int FROM invalid_tasks) AS candidates,
    (SELECT COUNT(*)::int FROM updated_tasks) AS tasks_updated,
    (SELECT COUNT(*)::int FROM updated_progress) AS workflow_progress_updated
`;

const REMAINING_INVALID_TASKS_SQL = `
  SELECT COUNT(*)::int AS remaining_invalid_tasks
  FROM tasks
  WHERE COALESCE(completion_percent, 0) > 0
    AND LOWER(COALESCE(status, '')) IN ('assigned', 'pending')
`;

async function runBackfill() {
  const result = await pool.query(BACKFILL_STARTED_TASK_STATE_SQL);
  const remaining = await pool.query(REMAINING_INVALID_TASKS_SQL);

  return {
    ...result.rows[0],
    ...remaining.rows[0],
  };
}

if (require.main === module) {
  runBackfill()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = {
  BACKFILL_STARTED_TASK_STATE_SQL,
  REMAINING_INVALID_TASKS_SQL,
  runBackfill,
};
