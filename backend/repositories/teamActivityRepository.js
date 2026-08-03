const { pool } = require("../db");
const { buildVisibleUsersCte } = require("./projectVisibility");

const ACTIVE_TEAM_TASK_STATUSES = [
  "created",
  "pending",
  "assigned",
  "in_progress",
  "on_hold",
  "under_review",
  "rework",
];

async function listTeamActivityRows(employeeId, client = pool) {
  const taskResult = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      , team_members AS (
        SELECT DISTINCT
          member.id::text AS user_uuid,
          member.employee_id,
          member.name
        FROM visible_users visible
        JOIN users member ON member.employee_id = visible.employee_id
        WHERE COALESCE(member.is_active, TRUE) = TRUE
      ),
      assigned_tasks AS (
        SELECT DISTINCT
          member.employee_id,
          task.*
        FROM team_members member
        JOIN tasks task ON (
          NULLIF(task.assigned_user_id, '') IN (member.employee_id, member.user_uuid)
          OR NULLIF(task.assigned_to, '') IN (member.employee_id, member.user_uuid)
          OR COALESCE(task.assignee_ids, '[]'::jsonb) ? member.employee_id
          OR COALESCE(task.assignee_ids, '[]'::jsonb) ? member.user_uuid
        )
        WHERE LOWER(COALESCE(task.status, '')) = ANY($2::text[])
          AND LOWER(COALESCE(task.lifecycle_status, 'assigned')) NOT IN ('completed', 'cancelled', 'archived')
          AND LOWER(COALESCE(task.verification_status, 'pending')) <> 'approved'
      )
      SELECT
        member.employee_id,
        member.name AS employee_name,
        task.id AS task_id,
        task.task_type,
        task.title,
        task.internal_identifier,
        task.description,
        task.project_no,
        task.fixture_no,
        task.quantity_index,
        task.stage,
        task.status,
        task.lifecycle_status,
        task.verification_status,
        task.deadline,
        task.submitted_at,
        task.approved_at,
        COALESCE(task.proof_url, '{}'::text[]) AS proof_url,
        COALESCE(project.project_no, NULLIF(task.project_no, '')) AS resolved_project_no,
        COALESCE(fixture.fixture_no, NULLIF(task.fixture_no, ''), NULLIF(task.quantity_index, '')) AS resolved_fixture_no,
        fixture.part_name AS resolved_fixture_name,
        COALESCE(progress.stage_name, NULLIF(task.stage, ''), stage.stage_name, stage.name) AS resolved_stage_name,
        COALESCE(project.status, 'active') AS project_status,
        current_task.task_id AS current_task_id
      FROM team_members member
      LEFT JOIN assigned_tasks task ON task.employee_id = member.employee_id
      LEFT JOIN design.projects project ON project.id = task.project_id
      LEFT JOIN design.fixtures fixture ON fixture.id = task.fixture_id
      LEFT JOIN workflow_stages stage ON stage.id = task.current_stage_id
      LEFT JOIN fixture_workflow_progress progress
        ON progress.fixture_id = task.fixture_id
        AND progress.department_id = task.department_id
        AND LOWER(progress.stage_name) = LOWER(COALESCE(NULLIF(task.stage, ''), stage.stage_name, stage.name))
      LEFT JOIN desktop_current_tasks current_task
        ON current_task.user_id = member.employee_id
        AND current_task.task_id = task.id
      ORDER BY member.name, member.employee_id, task.id
    `,
    [employeeId, ACTIVE_TEAM_TASK_STATUSES],
  );

  const controlResult = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      , team_members AS (
        SELECT DISTINCT
          member.employee_id,
          member.name
        FROM visible_users visible
        JOIN users member ON member.employee_id = visible.employee_id
        WHERE COALESCE(member.is_active, TRUE) = TRUE
      )
      SELECT
        member.employee_id,
        member.name AS employee_name,
        'control-workflow:' || workflow.id::text AS task_id,
        'control_workflow' AS task_type,
        COALESCE(stage.stage_name, 'Control workflow') AS title,
        NULL::text AS internal_identifier,
        NULL::text AS description,
        project.project_no,
        NULL::text AS fixture_no,
        NULL::text AS quantity_index,
        stage.stage_name AS stage,
        CASE WHEN stage.status = 'in_progress' THEN 'in_progress' ELSE 'assigned' END AS status,
        'assigned'::text AS lifecycle_status,
        'pending'::text AS verification_status,
        stage.due_date AS deadline,
        stage.submitted_at,
        stage.approved_at,
        '{}'::text[] AS proof_url,
        project.project_no AS resolved_project_no,
        NULL::text AS resolved_fixture_no,
        NULL::text AS resolved_fixture_name,
        stage.stage_name AS resolved_stage_name,
        COALESCE(project.status, 'active') AS project_status,
        NULL::text AS current_task_id
      FROM team_members member
      JOIN project_workflows workflow ON workflow.assigned_user_id = member.employee_id
      JOIN design.projects project ON project.id = workflow.project_id
      LEFT JOIN project_workflow_stages stage ON stage.id = workflow.current_stage_id
      WHERE workflow.status = 'active'

      UNION ALL

      SELECT
        member.employee_id,
        member.name AS employee_name,
        'control-revision:' || revision.id::text AS task_id,
        'control_revision' AS task_type,
        revision.description AS title,
        NULL::text AS internal_identifier,
        revision.revision_reason AS description,
        project.project_no,
        NULL::text AS fixture_no,
        NULL::text AS quantity_index,
        stage.stage_name AS stage,
        CASE WHEN revision.status = 'in_progress' THEN 'in_progress' ELSE 'assigned' END AS status,
        'assigned'::text AS lifecycle_status,
        'pending'::text AS verification_status,
        revision.due_date AS deadline,
        revision.submitted_at,
        revision.approved_at,
        '{}'::text[] AS proof_url,
        project.project_no AS resolved_project_no,
        NULL::text AS resolved_fixture_no,
        NULL::text AS resolved_fixture_name,
        stage.stage_name AS resolved_stage_name,
        COALESCE(project.status, 'active') AS project_status,
        NULL::text AS current_task_id
      FROM team_members member
      JOIN workflow_stage_revisions revision ON revision.assigned_to = member.employee_id
      JOIN project_workflows workflow ON workflow.id = revision.workflow_id
      JOIN project_workflow_stages stage ON stage.id = revision.workflow_stage_id
      JOIN design.projects project ON project.id = workflow.project_id
      WHERE workflow.status = 'active'
        AND revision.status <> 'approved'
    `,
    [employeeId],
  );

  return [...taskResult.rows, ...controlResult.rows];
}

module.exports = {
  ACTIVE_TEAM_TASK_STATUSES,
  listTeamActivityRows,
};
