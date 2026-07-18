const { pool } = require("../db");
const { listDesign2DCompletionTasks } = require("./tasksRepository");

async function lockDesign2DCompletionProject(projectId, client) {
  const result = await client.query(
    "SELECT id FROM design.projects WHERE id = $1 FOR UPDATE",
    [projectId],
  );
  return result.rowCount > 0;
}

async function getDesign2DCompletionProjectDepartment(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT project.department_id, department.name AS department_name
      FROM design.projects project
      LEFT JOIN departments department ON department.id = project.department_id
      WHERE project.id = $1
      LIMIT 1
    `,
    [projectId],
  );
  return result.rows[0] || null;
}

async function listProjectFixturesWith2DStatus(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT
        fixture.id AS fixture_id,
        fixture.fixture_no,
        fixture.part_name,
        fixture.is_workflow_complete AS workflow_complete,
        (
          COALESCE(fixture.is_workflow_complete, FALSE)
          OR EXISTS (
            SELECT 1
            FROM fixture_workflow_progress progress
            WHERE progress.fixture_id = fixture.id
              AND REGEXP_REPLACE(LOWER(COALESCE(progress.stage_name, '')), '[^a-z0-9]+', '', 'g')
                IN ('2d', '2dfinish')
              AND UPPER(COALESCE(progress.status, '')) IN ('APPROVED', 'COMPLETED')
          )
        ) AS two_d_complete
      FROM design.fixtures fixture
      WHERE fixture.project_id = $1
        AND COALESCE(fixture.removed_from_latest_ingestion, FALSE) = FALSE
      ORDER BY fixture.fixture_no, fixture.id
    `,
    [projectId],
  );
  return result.rows;
}

async function getLatestDesign2DCompletionTask(projectId, fixtureId, code, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM tasks
      WHERE task_type = 'design_2d_completion'
        AND project_id = $1
        AND completion_task_code = $2
        AND (
          ($3::uuid IS NULL AND scope_type = 'project' AND fixture_id IS NULL)
          OR ($3::uuid IS NOT NULL AND scope_type = 'fixture' AND fixture_id = $3)
        )
      ORDER BY completion_task_revision DESC, id DESC
      LIMIT 1
    `,
    [projectId, code, fixtureId || null],
  );
  return result.rows[0] || null;
}

async function markCompletionTaskNotRequired(taskId, actorEmployeeId, reason, client = pool) {
  await client.query(
    `
      UPDATE tasks
      SET status = 'closed',
          lifecycle_status = 'completed',
          completion_percent = 100,
          verification_status = 'approved',
          approval_stage = 'closed',
          proof_required = FALSE,
          completed_at = NOW(),
          submitted_at = NOW(),
          verified_at = NOW(),
          closed_at = NOW(),
          approved_at = NOW(),
          approved_by = $2,
          completion_task_not_required_reason = $3,
          completion_task_not_required_by = $2,
          completion_task_not_required_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [taskId, actorEmployeeId, reason],
  );
}

module.exports = {
  getDesign2DCompletionProjectDepartment,
  getLatestDesign2DCompletionTask,
  listDesign2DCompletionTasks,
  listProjectFixturesWith2DStatus,
  lockDesign2DCompletionProject,
  markCompletionTaskNotRequired,
};
