const { AppError } = require("./AppError");
const { normalizeDesignStageName } = require("./designWorkflowStages");

const OUTSOURCE_ASSIGNMENT_STATUSES = Object.freeze({
  OUTSOURCED: "OUTSOURCED",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  PENDING_INTERNAL_REVIEW: "PENDING_INTERNAL_REVIEW",
  CHANGES_REQUIRED: "CHANGES_REQUIRED",
  APPROVED: "APPROVED",
  CANCELLED: "CANCELLED",
});

const OUTSOURCE_ACTIVE_STATUSES = Object.freeze(
  Object.values(OUTSOURCE_ASSIGNMENT_STATUSES)
    .filter((status) => status !== OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED),
);

const OUTSOURCE_PRIORITIES = Object.freeze(["low", "medium", "high", "critical"]);

const OUTSOURCE_SKIP_CODES = Object.freeze({
  FIXTURE_NOT_IN_PROJECT: "FIXTURE_NOT_IN_PROJECT",
  PROJECT_NOT_ACTIVE: "PROJECT_NOT_ACTIVE",
  STAGE_NOT_FOUND: "STAGE_NOT_FOUND",
  PREREQUISITES_INCOMPLETE: "PREREQUISITES_INCOMPLETE",
  STAGE_COMPLETED: "STAGE_COMPLETED",
  STAGE_NOT_ASSIGNABLE: "STAGE_NOT_ASSIGNABLE",
  ALREADY_ASSIGNED_INTERNAL: "ALREADY_ASSIGNED_INTERNAL",
  ALREADY_OUTSOURCED: "ALREADY_OUTSOURCED",
});

const STATUS_TRANSITIONS = Object.freeze({
  [OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED]: [
    OUTSOURCE_ASSIGNMENT_STATUSES.IN_PROGRESS,
    OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
  ],
  [OUTSOURCE_ASSIGNMENT_STATUSES.IN_PROGRESS]: [
    OUTSOURCE_ASSIGNMENT_STATUSES.SUBMITTED,
    OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
  ],
  [OUTSOURCE_ASSIGNMENT_STATUSES.SUBMITTED]: [
    OUTSOURCE_ASSIGNMENT_STATUSES.PENDING_INTERNAL_REVIEW,
    OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
  ],
  [OUTSOURCE_ASSIGNMENT_STATUSES.PENDING_INTERNAL_REVIEW]: [
    OUTSOURCE_ASSIGNMENT_STATUSES.CHANGES_REQUIRED,
    OUTSOURCE_ASSIGNMENT_STATUSES.APPROVED,
    OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
  ],
  [OUTSOURCE_ASSIGNMENT_STATUSES.CHANGES_REQUIRED]: [
    OUTSOURCE_ASSIGNMENT_STATUSES.IN_PROGRESS,
    OUTSOURCE_ASSIGNMENT_STATUSES.SUBMITTED,
    OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
  ],
  [OUTSOURCE_ASSIGNMENT_STATUSES.APPROVED]: [],
  [OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED]: [],
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value, field, maxLength = 4000) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new AppError(400, `${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw new AppError(400, `${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function optionalText(value, field, maxLength = 4000) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requiredText(value, field, maxLength);
}

function requiredUuid(value, field) {
  const normalized = requiredText(value, field, 36);
  if (!UUID_PATTERN.test(normalized)) {
    throw new AppError(400, `${field} must be a valid UUID`);
  }
  return normalized;
}

function normalizeOutsourceStageCode(value) {
  const stageName = requiredText(value, "workflow_stage", 100);
  const normalized = normalizeDesignStageName(stageName) || stageName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    throw new AppError(400, "workflow_stage must contain letters or numbers");
  }
  return normalized;
}

function validateBulkOutsourcePayload(payload = {}) {
  const scope = String(payload.scope || "").trim().toLowerCase();
  if (!["all_assignable", "selected"].includes(scope)) {
    throw new AppError(400, "scope must be all_assignable or selected");
  }

  const fixtureIds = [...new Set(
    (Array.isArray(payload.fixture_ids) ? payload.fixture_ids : [])
      .map((fixtureId) => requiredUuid(fixtureId, "fixture_ids")),
  )];
  if (scope === "selected" && fixtureIds.length === 0) {
    throw new AppError(400, "fixture_ids is required for selected scope");
  }

  const deadlineValue = requiredText(payload.deadline, "deadline", 100);
  const deadline = new Date(deadlineValue);
  if (Number.isNaN(deadline.getTime())) {
    throw new AppError(400, "deadline must be a valid date or timestamp");
  }

  const priority = requiredText(payload.priority, "priority", 20).toLowerCase();
  if (!OUTSOURCE_PRIORITIES.includes(priority)) {
    throw new AppError(400, `priority must be one of ${OUTSOURCE_PRIORITIES.join(", ")}`);
  }

  const workflowStage = requiredText(payload.workflow_stage, "workflow_stage", 100);
  return {
    project_id: requiredUuid(payload.project_id, "project_id"),
    workflow_stage: workflowStage,
    workflow_stage_code: normalizeOutsourceStageCode(workflowStage),
    scope,
    fixture_ids: fixtureIds,
    vendor_id: requiredUuid(payload.vendor_id, "vendor_id"),
    internal_coordinator_id: requiredText(payload.internal_coordinator_id, "internal_coordinator_id", 50),
    deadline: deadline.toISOString(),
    priority,
    instructions: requiredText(payload.instructions, "instructions", 10000),
    work_order_reference: optionalText(payload.work_order_reference, "work_order_reference", 255),
    expected_deliverables: optionalText(payload.expected_deliverables, "expected_deliverables", 10000),
    reference_path: optionalText(payload.reference_path, "reference_path", 2000),
  };
}

function validateVendorPayload(payload = {}) {
  return {
    name: requiredText(payload.name, "name", 255),
    code: optionalText(payload.code, "code", 100),
    contact_name: optionalText(payload.contact_name, "contact_name", 255),
    contact_email: optionalText(payload.contact_email, "contact_email", 320),
    contact_phone: optionalText(payload.contact_phone, "contact_phone", 100),
  };
}

function validateReasonPayload(payload = {}) {
  return { reason: requiredText(payload.reason, "reason", 2000) };
}

function validateOutsourceStatusPayload(payload = {}) {
  const status = requiredText(payload.status, "status", 100).toUpperCase();
  if (!Object.values(OUTSOURCE_ASSIGNMENT_STATUSES).includes(status)) {
    throw new AppError(400, "Invalid outsourcing status");
  }
  return {
    status,
    reason: optionalText(payload.reason, "reason", 2000),
  };
}

function assertOutsourceStatusTransition(fromStatus, toStatus) {
  if (!(STATUS_TRANSITIONS[fromStatus] || []).includes(toStatus)) {
    throw new AppError(409, `Outsourcing status cannot change from ${fromStatus} to ${toStatus}`);
  }
}

function skip(code, message) {
  return { code, message };
}

function classifyFixtureOutsourceEligibility(row = {}) {
  const stageName = row.stage_name || row.workflow_stage_name || null;
  const stageStatus = String(row.stage_status || row.progress_status || "").toUpperCase();
  const stageExists = row.stage_exists === undefined ? Boolean(stageName) : row.stage_exists === true;
  const alreadyOutsourced = Boolean(row.active_outsource_id) || row.already_outsourced === true;
  const internallyAssigned = row.internal_assignment_active === true || row.internally_assigned === true;

  if (!row.fixture_id || row.fixture_belongs_to_project === false) {
    return skip(OUTSOURCE_SKIP_CODES.FIXTURE_NOT_IN_PROJECT, "Fixture does not belong to the selected project");
  }
  if (String(row.project_status || "active").toLowerCase() !== "active") {
    return skip(OUTSOURCE_SKIP_CODES.PROJECT_NOT_ACTIVE, "Project is not active");
  }
  if (!stageExists) {
    return skip(OUTSOURCE_SKIP_CODES.STAGE_NOT_FOUND, "Selected workflow stage does not exist for this fixture");
  }
  const stageCode = row.workflow_stage_code || normalizeOutsourceStageCode(stageName);
  if (stageCode === "release") {
    return skip(OUTSOURCE_SKIP_CODES.STAGE_NOT_ASSIGNABLE, "Release is not an outsourcing assignment stage");
  }
  if (row.is_workflow_complete === true || stageStatus === "APPROVED") {
    return skip(OUTSOURCE_SKIP_CODES.STAGE_COMPLETED, "Selected workflow stage is already completed");
  }
  if (row.prerequisites_complete !== true) {
    return skip(OUTSOURCE_SKIP_CODES.PREREQUISITES_INCOMPLETE, "Required prerequisite stages are not complete");
  }
  if (alreadyOutsourced) {
    return skip(OUTSOURCE_SKIP_CODES.ALREADY_OUTSOURCED, "Fixture stage is already outsourced");
  }
  if (internallyAssigned) {
    return skip(OUTSOURCE_SKIP_CODES.ALREADY_ASSIGNED_INTERNAL, "Fixture is already assigned internally");
  }
  if (row.stage_assignable === false || !["PENDING", "REJECTED"].includes(stageStatus)) {
    return skip(OUTSOURCE_SKIP_CODES.STAGE_NOT_ASSIGNABLE, "Selected workflow stage is not assignable");
  }
  return null;
}

module.exports = {
  OUTSOURCE_ACTIVE_STATUSES,
  OUTSOURCE_ASSIGNMENT_STATUSES,
  OUTSOURCE_PRIORITIES,
  OUTSOURCE_SKIP_CODES,
  STATUS_TRANSITIONS,
  assertOutsourceStatusTransition,
  classifyFixtureOutsourceEligibility,
  normalizeOutsourceStageCode,
  validateBulkOutsourcePayload,
  validateOutsourceStatusPayload,
  validateReasonPayload,
  validateVendorPayload,
};
