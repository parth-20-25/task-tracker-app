const ASSIGNED_TASK_STATUSES = new Set(["assigned", "pending"]);
const { normalizeDesignStageName } = require("../lib/designWorkflowStages");

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
  if (Array.isArray(task?.proof_url)) {
    return task.proof_url.filter(Boolean).length > 0;
  }

  return Boolean(String(task?.proof_url || "").trim() || task?.latest_proof?.file_url);
}

function isDapWorkflowTask(task) {
  return normalizeDesignStageName(task?.workflow_stage || task?.stage || task?.current_stage_name) === "dap";
}

function isWorkProofRequiredForState(task) {
  return !isDapWorkflowTask(task);
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
  return ["assigned", "in_progress"].includes(status)
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
