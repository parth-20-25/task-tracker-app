const ASSIGNED_TASK_STATUSES = new Set(["assigned", "created", "pending"]);
const CANCELLABLE_TASK_STATUSES = new Set(["assigned", "created", "pending", "in_progress", "rework"]);
const { hasTaskWorkProof, isDapWorkflowTask, isTaskWorkProofRequired } = require("../lib/taskProofPolicy");

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCompletion(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function shouldAutoStartTask(task, completionPercent) {
  return completionPercent > 0 && ASSIGNED_TASK_STATUSES.has(normalizeStatus(task?.status));
}

function hasTaskProofForState(task) {
  return hasTaskWorkProof(task);
}

function isWorkProofRequiredForState(task) {
  return isTaskWorkProofRequired(task);
}

function shouldSubmitForVerification(task, completionPercent) {
  return completionPercent === 100
    && normalizeStatus(task?.status) === "in_progress"
    && (!isWorkProofRequiredForState(task) || hasTaskProofForState(task));
}

function shouldAdvanceFixtureWorkflow(task, nextStatus) {
  return nextStatus === "closed"
    && task?.task_type === "department_workflow"
    && Boolean(task?.workflow_id && task?.current_stage_id && task?.fixture_id);
}

function canCancelAssignedTask(task) {
  return normalizeStatus(task?.status) === "assigned"
    && normalizeCompletion(task?.completion_percent) === 0
    && normalizeStatus(task?.verification_status || "pending") !== "approved"
    && !task?.approved_at;
}

function canCancelOperationalTask(task) {
  const status = normalizeStatus(task?.status);
  return CANCELLABLE_TASK_STATUSES.has(status)
    && normalizeStatus(task?.verification_status || "pending") !== "approved"
    && !task?.approved_at;
}

module.exports = {
  canCancelAssignedTask,
  canCancelOperationalTask,
  hasTaskProofForState,
  isDapWorkflowTask,
  isWorkProofRequiredForState,
  shouldAutoStartTask,
  shouldAdvanceFixtureWorkflow,
  shouldSubmitForVerification,
};
