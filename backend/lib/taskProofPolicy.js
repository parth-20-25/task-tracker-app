const { TASK_TYPES } = require("../config/constants");
const { normalizeAdditionalDesignTaskKind, normalizeAdditionalDesignTeam } = require("./additionalDesignTasks");
const { normalizeDesignStageName } = require("./designWorkflowStages");

const THREE_D_PROJECT_PROOF_OPTIONAL_KINDS = Object.freeze([
  "Project Process",
  "Pin Matrix",
  "PPT",
  "CBO",
  "Line Layout",
  "CDRM",
]);

function isDapWorkflowTask(task) {
  return normalizeDesignStageName(task?.workflow_stage || task?.stage || task?.current_stage_name) === "dap";
}

function isThreeDProjectAdditionalTask(task) {
  return task?.task_type === TASK_TYPES.ADDITIONAL_DESIGN
    && normalizeAdditionalDesignTeam(task?.design_team) === "3D"
    && String(task?.scope_type || "").trim().toLowerCase() === "project"
    && !task?.fixture_id;
}

function isProofOptionalThreeDProjectAdditionalTask(task) {
  return isThreeDProjectAdditionalTask(task)
    && THREE_D_PROJECT_PROOF_OPTIONAL_KINDS.includes(normalizeAdditionalDesignTaskKind(task?.additional_task_kind, "3D"));
}

function hasTaskWorkProof(task) {
  if (Array.isArray(task?.proof_url)) {
    return task.proof_url.filter(Boolean).length > 0;
  }

  return Boolean(String(task?.proof_url || "").trim() || task?.latest_proof?.file_url);
}

function isTaskWorkProofRequired(task) {
  if (task?.proof_required === false) {
    return false;
  }

  if (task?.task_type === TASK_TYPES.DESIGN_2D_COMPLETION || isDapWorkflowTask(task)) {
    return false;
  }

  return !isProofOptionalThreeDProjectAdditionalTask(task);
}

module.exports = {
  THREE_D_PROJECT_PROOF_OPTIONAL_KINDS,
  hasTaskWorkProof,
  isDapWorkflowTask,
  isProofOptionalThreeDProjectAdditionalTask,
  isTaskWorkProofRequired,
  isThreeDProjectAdditionalTask,
};
