const OPERATIONAL_STATES = {
  VERIFICATION: "VERIFICATION",
  REWORK: "REWORK",
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

function isWorkflowVerificationPending(progress = null) {
  return String(progress?.status || "").toUpperCase() === "SUBMITTED_FOR_VERIFICATION";
}

function isWorkflowRejected(progress = null) {
  return String(progress?.status || "").toUpperCase() === "REJECTED";
}

function isActiveWorkflowAssignment(progress = null) {
  const status = String(progress?.status || "").toUpperCase();
  return status === "IN_PROGRESS" || status === "SUBMITTED_FOR_VERIFICATION";
}

function isCurrentStageClaimed(progress = null) {
  return Boolean(String(progress?.assigned_to || "").trim()) || isActiveWorkflowAssignment(progress);
}

function resolveFixtureOperationalState({ task = null, progress = null, workflowComplete = false } = {}) {
  if (isReviewPendingTask(task) || isWorkflowVerificationPending(progress)) {
    return OPERATIONAL_STATES.VERIFICATION;
  }

  if (String(task?.status || "").toLowerCase() === "rework" || isWorkflowRejected(progress)) {
    return OPERATIONAL_STATES.REWORK;
  }

  if (workflowComplete) {
    return OPERATIONAL_STATES.WORKFLOW_COMPLETE;
  }

  if (task && String(task.status || "").toLowerCase() !== "cancelled") {
    const completionPercent = Number(task.completion_percent || 0);
    if (completionPercent > 0) {
      return OPERATIONAL_STATES.IN_PROGRESS;
    }

    return OPERATIONAL_STATES.ASSIGNED;
  }

  if (isCurrentStageClaimed(progress)) {
    return OPERATIONAL_STATES.ASSIGNED;
  }

  return OPERATIONAL_STATES.UNASSIGNED;
}

function resolveTaskOperationalState(task = null, { workflowComplete = false, progress = null } = {}) {
  return resolveFixtureOperationalState({ task, progress, workflowComplete });
}

function activeTaskStatusSqlArray() {
  return `ARRAY[${ACTIVE_TASK_STATUSES.map((status) => `'${status}'`).join(", ")}]::text[]`;
}

function fixtureWorkflowCompleteSql(fixtureAlias = "f", projectAlias = "p", { includeOutsourceCheck = true } = {}) {
  const noActiveOutsourceSql = includeOutsourceCheck
    ? `AND NOT EXISTS (
        SELECT 1
        FROM design.fixture_outsource_records active_outsource
        WHERE active_outsource.fixture_id = ${fixtureAlias}.id
          AND active_outsource.outsource_status = 'outsourced'
      )`
    : `AND COALESCE(${fixtureAlias}.is_outsourced, FALSE) IS FALSE`;

  return `(
    (
      ${fixtureAlias}.is_workflow_complete IS TRUE
      ${noActiveOutsourceSql}
    )
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
      ${noActiveOutsourceSql}
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

function currentProgressLateral(fixtureAlias = "f", projectAlias = "p", alias = "current_progress") {
  return `
      LEFT JOIN LATERAL (
        SELECT
          fwp.stage_name,
          fwp.stage_order,
          fwp.stage_version,
          fwp.status,
          fwp.assigned_to,
          fwp.assigned_at,
          fwp.started_at,
          fwp.completed_at,
          fwp.updated_at,
          COUNT(*) OVER()::integer AS total_stages
        FROM fixture_workflow_progress fwp
        WHERE fwp.fixture_id = ${fixtureAlias}.id
          AND fwp.department_id = ${projectAlias}.department_id
        ORDER BY
          CASE WHEN fwp.status <> 'APPROVED' THEN 0 ELSE 1 END ASC,
          CASE WHEN fwp.status <> 'APPROVED' THEN fwp.stage_order END ASC NULLS LAST,
          CASE WHEN fwp.status = 'APPROVED' THEN fwp.stage_order END DESC NULLS LAST
        LIMIT 1
      ) ${alias} ON TRUE
  `;
}

function operationalStateSqlCase({
  fixtureAlias = "f",
  projectAlias = "p",
  taskAlias = "operational_task",
  progressAlias = "current_progress",
  includeOutsourceCompletionCheck = true,
} = {}) {
  return `CASE
    WHEN ${taskAlias}.status = 'under_review' AND ${taskAlias}.verification_status = 'pending' THEN '${OPERATIONAL_STATES.VERIFICATION}'
    WHEN ${progressAlias}.status = 'SUBMITTED_FOR_VERIFICATION' THEN '${OPERATIONAL_STATES.VERIFICATION}'
    WHEN ${taskAlias}.status = 'rework' THEN '${OPERATIONAL_STATES.REWORK}'
    WHEN ${progressAlias}.status = 'REJECTED' THEN '${OPERATIONAL_STATES.REWORK}'
    WHEN ${fixtureWorkflowCompleteSql(fixtureAlias, projectAlias, { includeOutsourceCheck: includeOutsourceCompletionCheck })} THEN '${OPERATIONAL_STATES.WORKFLOW_COMPLETE}'
    WHEN ${taskAlias}.id IS NOT NULL AND COALESCE(${taskAlias}.completion_percent, 0) > 0 THEN '${OPERATIONAL_STATES.IN_PROGRESS}'
    WHEN ${taskAlias}.id IS NOT NULL THEN '${OPERATIONAL_STATES.ASSIGNED}'
    WHEN ${progressAlias}.assigned_to IS NOT NULL OR ${progressAlias}.status IN ('IN_PROGRESS', 'SUBMITTED_FOR_VERIFICATION') THEN '${OPERATIONAL_STATES.ASSIGNED}'
    ELSE '${OPERATIONAL_STATES.UNASSIGNED}'
  END`;
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  OPERATIONAL_STATES,
  activeTaskLateral,
  currentProgressLateral,
  fixtureWorkflowCompleteSql,
  isActiveWorkflowAssignment,
  isCurrentStageClaimed,
  isReviewPendingTask,
  isWorkflowRejected,
  isWorkflowVerificationPending,
  operationalStateSqlCase,
  resolveFixtureOperationalState,
  resolveTaskOperationalState,
};
