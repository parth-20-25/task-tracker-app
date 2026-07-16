const CONTROL_DEPARTMENT_ID = "control";
const CONTROL_DEPARTMENT_NAME = "Control";

const CONTROL_SUB_DEPARTMENTS = [
  "Elec. Purchase",
  "Control Design",
  "PLC Programming",
  "Robo Programming",
  "Elec. Installation",
];

const CONTROL_DESIGN_TEMPLATE_NAME = "Control Design";

const CONTROL_DESIGN_STAGES = [
  "CO Creation",
  "ERP Budget Approval",
  "CO Release",
  "WBS Addition",
  "I/O List Preparation",
  "E-Plan Drawing Release",
  "Panel Material Issue",
  "Field Material Preparation",
  "Manual Preparation",
];

const WORKFLOW_STATUSES = {
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const CONTROL_PROJECT_STATUSES = {
  UNASSIGNED: "unassigned",
  ASSIGNED: "assigned",
  ACTIVE: "active",
  BLOCKED: "blocked",
  COMPLETED: "completed",
  READY_FOR_DISPATCH: "ready_for_dispatch",
  DISPATCHED: "dispatched",
  CANCELLED: "cancelled",
};

const STAGE_STATUSES = {
  LOCKED: "locked",
  AVAILABLE: "available",
  NOT_STARTED: "available",
  IN_PROGRESS: "in_progress",
  PENDING_APPROVAL: "pending_approval",
  SUBMITTED_FOR_APPROVAL: "pending_approval",
  CHANGES_REQUIRED: "changes_required",
  REVISION_REQUIRED: "changes_required",
  UPDATE_REQUIRED: "update_required",
  APPROVED: "approved",
  BLOCKED: "blocked",
  PRE_COMPLETED: "pre_completed",
  SKIPPED_BY_OVERRIDE: "skipped_by_override",
};

const SUBMISSION_STATUSES = {
  PENDING: "pending",
  APPROVED: "approved",
  REVISION_REQUIRED: "revision_required",
};

const REVISION_STATUSES = {
  NOT_STARTED: "not_started",
  CHANGES_REQUIRED: "changes_required",
  IN_PROGRESS: "in_progress",
  SUBMITTED_FOR_APPROVAL: "submitted_for_approval",
  APPROVED: "approved",
};

const REVISION_REASONS = [
  "ECN",
  "Customer Change",
  "Mechanical Design Change",
  "Internal Correction",
  "Scope Addition",
  "Scope Deletion",
  "Standardization Change",
  "Drawing Error Correction",
  "Vendor/Availability Issue",
  "Material Substitution",
  "Trial/Commissioning Feedback",
  "Other",
];

const APPROVED_PROGRESS_STATUSES = new Set([
  STAGE_STATUSES.APPROVED,
  STAGE_STATUSES.PRE_COMPLETED,
]);

const TERMINAL_STAGE_STATUSES = new Set([
  STAGE_STATUSES.APPROVED,
  STAGE_STATUSES.PRE_COMPLETED,
  STAGE_STATUSES.SKIPPED_BY_OVERRIDE,
]);

function normalizeControlText(value) {
  return String(value || "").trim();
}

function normalizeControlKey(value) {
  return normalizeControlText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isControlDepartmentUser(user) {
  const departmentId = normalizeControlKey(user?.department_id || user?.department?.id);
  const departmentName = normalizeControlKey(user?.department?.name);

  return departmentId === CONTROL_DEPARTMENT_ID || departmentName === normalizeControlKey(CONTROL_DEPARTMENT_NAME);
}

function isControlDesignSubdivisionUser(user, expectedSubDepartmentId = null) {
  const expectedId = normalizeControlText(expectedSubDepartmentId);
  const subdivisionId = normalizeControlText(user?.subdivision_id || user?.subdivision?.id);
  const subdivisionName = normalizeControlKey(user?.subdivision?.subdivision_name || user?.subdivision_name);

  return Boolean(expectedId && subdivisionId && subdivisionId === expectedId)
    || subdivisionName === normalizeControlKey(CONTROL_DESIGN_TEMPLATE_NAME);
}

function isControlDesignWorkspaceUser(user, expectedSubDepartmentId = null) {
  return isControlDepartmentUser(user) && isControlDesignSubdivisionUser(user, expectedSubDepartmentId);
}

function normalizeRevisionReason(value) {
  const incoming = normalizeControlText(value);
  return REVISION_REASONS.find((reason) => reason.toLowerCase() === incoming.toLowerCase()) || null;
}

function isApprovedForProgress(status) {
  return APPROVED_PROGRESS_STATUSES.has(status);
}

function isTerminalStageStatus(status) {
  return TERMINAL_STAGE_STATUSES.has(status);
}

function isOpenRevisionStatus(status) {
  return status && status !== REVISION_STATUSES.APPROVED;
}

function hasPendingSubmission(stages = []) {
  return stages.some((stage) => (stage.submissions || []).some((submission) => submission.status === SUBMISSION_STATUSES.PENDING));
}

function hasOpenRevision(stages = []) {
  return stages.some((stage) => (stage.revisions || []).some((revision) => isOpenRevisionStatus(revision.status)));
}

function isReadyForDispatch(stages = []) {
  const requiredStages = stages.filter((stage) => stage?.is_required !== false);
  return requiredStages.length > 0
    && requiredStages.every((stage) => isTerminalStageStatus(stage.status))
    && !requiredStages.some((stage) => stage.status === STAGE_STATUSES.BLOCKED)
    && !hasPendingSubmission(requiredStages)
    && !hasOpenRevision(requiredStages);
}
function isControlDesignLifecycleComplete(stages = []) {
  const requiredStages = stages.filter((stage) => stage?.is_required !== false);
  return requiredStages.length === CONTROL_DESIGN_STAGES.length
    && requiredStages.every((stage) => stage.status === STAGE_STATUSES.APPROVED)
    && !hasPendingSubmission(requiredStages)
    && !hasOpenRevision(requiredStages);
}


function calculateWorkflowProgress(stages = []) {
  const requiredStages = stages.filter((stage) => stage?.is_required !== false);
  const denominator = requiredStages.length || 0;
  const approvedOrPreCompleted = requiredStages.filter((stage) => isApprovedForProgress(stage.status)).length;
  const skippedByOverride = requiredStages.filter((stage) => stage.status === STAGE_STATUSES.SKIPPED_BY_OVERRIDE).length;

  return {
    approved_or_pre_completed_stages: approvedOrPreCompleted,
    skipped_by_override_stages: skippedByOverride,
    total_required_stages: denominator,
    percent: denominator === 0 ? 0 : Math.round((approvedOrPreCompleted / denominator) * 100),
  };
}

function nextUnlockedStage(stages = []) {
  const sorted = [...stages].sort((left, right) => Number(left.sequence_order) - Number(right.sequence_order));
  return sorted.find((stage) => !isTerminalStageStatus(stage.status)) || null;
}

function createInitialStageRows(templateStages = []) {
  return [...templateStages]
    .sort((left, right) => Number(left.sequence_order) - Number(right.sequence_order))
    .map((stage, index) => ({
      template_stage_id: stage.id || null,
      stage_name: stage.stage_name,
      sequence_order: Number(stage.sequence_order),
      is_required: stage.is_required !== false,
      status: index === 0 ? STAGE_STATUSES.NOT_STARTED : STAGE_STATUSES.LOCKED,
    }));
}

function canStartStage(stage) {
  return [STAGE_STATUSES.AVAILABLE, STAGE_STATUSES.CHANGES_REQUIRED].includes(stage?.status);
}

function canSubmitStage(stage) {
  return [STAGE_STATUSES.IN_PROGRESS, STAGE_STATUSES.CHANGES_REQUIRED].includes(stage?.status);
}

function assertOtherReasonHasManualRemarks(reason, manualReason) {
  if (reason === "Other" && !normalizeControlText(manualReason)) {
    const error = new Error("manual_reason is required when revision reason is Other");
    error.statusCode = 400;
    throw error;
  }
}

module.exports = {
  CONTROL_DEPARTMENT_ID,
  CONTROL_DEPARTMENT_NAME,
  CONTROL_PROJECT_STATUSES,
  CONTROL_DESIGN_STAGES,
  CONTROL_DESIGN_TEMPLATE_NAME,
  CONTROL_SUB_DEPARTMENTS,
  REVISION_REASONS,
  REVISION_STATUSES,
  STAGE_STATUSES,
  SUBMISSION_STATUSES,
  WORKFLOW_STATUSES,
  assertOtherReasonHasManualRemarks,
  calculateWorkflowProgress,
  canStartStage,
  canSubmitStage,
  createInitialStageRows,
  hasOpenRevision,
  hasPendingSubmission,
  isApprovedForProgress,
  isControlDepartmentUser,
  isControlDesignSubdivisionUser,
  isControlDesignWorkspaceUser,
  isControlDesignLifecycleComplete,
  isOpenRevisionStatus,
  isReadyForDispatch,
  isTerminalStageStatus,
  nextUnlockedStage,
  normalizeControlKey,
  normalizeControlText,
  normalizeRevisionReason,
};
