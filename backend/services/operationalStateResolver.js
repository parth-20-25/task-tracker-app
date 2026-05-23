const OPERATIONAL_STATES = {
  VERIFICATION: "VERIFICATION",
  UNASSIGNED: "UNASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  ASSIGNED: "ASSIGNED",
  WORKFLOW_COMPLETE: "WORKFLOW_COMPLETE",
};

const ACTIVE_TASK_STATUSES = ["assigned", "in_progress", "on_hold", "under_review", "rework"];

function isReviewPendingTask(task = null) {
  return String(task?.status || "").toLowerCase() === "under_review"
    && String(task?.verification_status || "").toLowerCase() === "pending";
}

function resolveTaskOperationalState(task = null, { workflowComplete = false } = {}) {
  if (workflowComplete) {
    return OPERATIONAL_STATES.WORKFLOW_COMPLETE;
  }

  if (!task) {
    return OPERATIONAL_STATES.UNASSIGNED;
  }

  if (isReviewPendingTask(task)) {
    return OPERATIONAL_STATES.VERIFICATION;
  }

  return Number(task.completion_percent || 0) > 0
    ? OPERATIONAL_STATES.IN_PROGRESS
    : OPERATIONAL_STATES.ASSIGNED;
}

function activeTaskStatusSqlArray() {
  return `ARRAY[${ACTIVE_TASK_STATUSES.map((status) => `'${status}'`).join(", ")}]::text[]`;
}

function fixtureWorkflowCompleteSql(fixtureAlias = "f", projectAlias = "p") {
  return `(
    ${fixtureAlias}.is_workflow_complete IS TRUE
    OR (
      EXISTS (
        SELECT 1
        FROM fixture_workflow_progress complete_progress
        WHERE complete_progress.fixture_id = ${fixtureAlias}.id
          AND complete_progress.department_id = ${projectAlias}.department_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM fixture_workflow_progress incomplete_progress
        WHERE incomplete_progress.fixture_id = ${fixtureAlias}.id
          AND incomplete_progress.department_id = ${projectAlias}.department_id
          AND UPPER(COALESCE(incomplete_progress.status, '')) <> 'APPROVED'
      )
    )
  )`;
}

function activeTaskLateral(fixtureAlias = "f", alias = "operational_task") {
  return `
      LEFT JOIN LATERAL (
        SELECT
          t.id,
          t.status,
          t.verification_status,
          t.completion_percent,
          t.assigned_to,
          t.assigned_user_id,
          t.deadline,
          t.submitted_at,
          t.completed_at,
          t.started_at,
          t.updated_at
        FROM tasks t
        WHERE t.fixture_id = ${fixtureAlias}.id
          AND t.status = ANY(${activeTaskStatusSqlArray()})
        ORDER BY
          CASE
            WHEN t.status = 'under_review' AND t.verification_status = 'pending' THEN 0
            WHEN t.status = 'rework' THEN 1
            WHEN t.status = 'in_progress' THEN 2
            WHEN t.status = 'on_hold' THEN 3
            WHEN t.status = 'assigned' THEN 4
            ELSE 5
          END,
          t.updated_at DESC,
          t.id DESC
        LIMIT 1
      ) ${alias} ON TRUE
  `;
}

function operationalStateSqlCase({
  fixtureAlias = "f",
  projectAlias = "p",
  taskAlias = "operational_task",
} = {}) {
  return `CASE
    WHEN ${fixtureWorkflowCompleteSql(fixtureAlias, projectAlias)} THEN '${OPERATIONAL_STATES.WORKFLOW_COMPLETE}'
    WHEN ${taskAlias}.status = 'under_review' AND ${taskAlias}.verification_status = 'pending' THEN '${OPERATIONAL_STATES.VERIFICATION}'
    WHEN ${taskAlias}.id IS NULL THEN '${OPERATIONAL_STATES.UNASSIGNED}'
    WHEN COALESCE(${taskAlias}.completion_percent, 0) = 0 THEN '${OPERATIONAL_STATES.ASSIGNED}'
    ELSE '${OPERATIONAL_STATES.IN_PROGRESS}'
  END`;
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  OPERATIONAL_STATES,
  activeTaskLateral,
  fixtureWorkflowCompleteSql,
  isReviewPendingTask,
  operationalStateSqlCase,
  resolveTaskOperationalState,
};
