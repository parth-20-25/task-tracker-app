const ASSIGNED_TASK_STATUSES = new Set(["assigned", "pending"]);

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

function shouldSubmitForVerification(task, completionPercent) {
  return completionPercent === 100
    && normalizeStatus(task?.status) === "in_progress"
    && hasTaskProofForState(task);
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
  shouldAutoStartTask,
  shouldSubmitForVerification,
};
