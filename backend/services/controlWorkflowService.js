const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const {
  PERMISSIONS,
} = require("../config/constants");
const {
  STAGE_STATUSES,
  SUBMISSION_STATUSES,
  REVISION_STATUSES,
  CONTROL_DESIGN_TEMPLATE_NAME,
  CONTROL_PROJECT_STATUSES,
  WORKFLOW_STATUSES,
  assertOtherReasonHasManualRemarks,
  calculateWorkflowProgress,
  canStartStage,
  canSubmitStage,
  createInitialStageRows,
  isApprovedForProgress,
  hasOpenRevision,
  isControlDesignLifecycleComplete,
  isControlDesignWorkspaceUser,
  isReadyForDispatch,
  nextUnlockedStage,
  normalizeControlText,
  normalizeRevisionReason,
} = require("../lib/controlWorkflow");
const {
  canAccessDepartment,
  canAccessUser,
  hasPermission,
} = require("./accessControlService");
const {
  persistControlWorkflowProofFile,
  removeControlWorkflowProofFile,
  resolveControlWorkflowProofPath,
} = require("../lib/controlWorkflowProofUpload");
const { findProjectByIdForDepartment, insertProjectByNumber } = require("../repositories/designProjectCatalogRepository");
const { findUserByEmployeeId, listUsers } = require("../repositories/usersRepository");
const controlWorkflowRepository = require("../repositories/controlWorkflowRepository");

function getActorId(actor) {
  return actor?.employee_id || null;
}

function requireActor(actor) {
  if (!getActorId(actor)) {
    throw new AppError(401, "Authentication required");
  }
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requireNonEmpty(value, fieldName) {
  const normalized = normalizeControlText(value);
  if (!normalized) {
    throw new AppError(400, `${fieldName} is required`);
  }
  return normalized;
}

function hasControlDesignPermission(actor, permission) {
  return hasPermission(actor, permission);
}

function hasControlDesignWorkspacePermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW);
}

function hasControlDesignViewAssignedPermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED);
}

function hasControlDesignViewAllPermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL);
}

function hasControlDesignCreatePermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE);
}

function hasControlDesignAssignPermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN);
}

function hasControlDesignReassignPermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN);
}

function hasControlDesignRevisionReviewPermission(actor) {
  return hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW);
}

function buildControlDesignCapabilities(actor, subDepartmentId = null) {
  const inScope = Boolean(getActorId(actor) && isControlDesignWorkspaceUser(actor, subDepartmentId));
  const canViewWorkspace = inScope && hasControlDesignWorkspacePermission(actor);
  const can = (permission) => canViewWorkspace && hasControlDesignPermission(actor, permission);

  return {
    canViewWorkspace,
    canViewAssignedProjects: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED),
    canViewAllProjects: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL),
    canCreateProject: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE),
    canEditProject: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_EDIT),
    canAssignProject: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN),
    canReassignProject: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN),
    canCancelProject: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_CANCEL),
    canStartStage: can(PERMISSIONS.CONTROL_DESIGN_STAGES_START),
    canSubmitStage: can(PERMISSIONS.CONTROL_DESIGN_STAGES_SUBMIT),
    canUpdatePath: can(PERMISSIONS.CONTROL_DESIGN_PATHS_UPDATE),
    canViewProof: can(PERMISSIONS.CONTROL_DESIGN_PROOFS_VIEW),
    canUploadProof: can(PERMISSIONS.CONTROL_DESIGN_PROOFS_UPLOAD),
    canReview: can(PERMISSIONS.CONTROL_DESIGN_APPROVALS_REVIEW),
    canApprove: can(PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE),
    canRequestChanges: can(PERMISSIONS.CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES),
    canRaiseRevision: can(PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE),
    canExecuteRevision: can(PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE),
    canReviewRevision: can(PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW),
    canMarkPreCompleted: can(PERMISSIONS.CONTROL_DESIGN_STAGES_MARK_PRE_COMPLETED),
    canOverrideUnlock: can(PERMISSIONS.CONTROL_DESIGN_STAGES_OVERRIDE_UNLOCK),
    canSkipStage: can(PERMISSIONS.CONTROL_DESIGN_STAGES_SKIP_OVERRIDE),
    canMarkDispatched: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED),
    canReopenAfterDispatch: can(PERMISSIONS.CONTROL_DESIGN_PROJECTS_REOPEN_AFTER_DISPATCH),
    canViewAudit: can(PERMISSIONS.CONTROL_DESIGN_AUDIT_VIEW),
    canViewReports: can(PERMISSIONS.CONTROL_DESIGN_REPORTS_VIEW),
  };
}

function requireControlDesignWorkspaceAccess(actor, subDepartmentId = null) {
  requireActor(actor);
  if (!isControlDesignWorkspaceUser(actor, subDepartmentId)) {
    throw new AppError(403, "Control Design workspace access requires Control department and Control Design subdivision membership");
  }
  if (!hasControlDesignWorkspacePermission(actor)) {
    throw new AppError(403, "Control Design workspace view permission is required");
  }
}

function requireControlDesignPermission(actor, permission, message) {
  if (!hasControlDesignPermission(actor, permission)) {
    throw new AppError(403, message || `Control Design permission is required: ${permission}`);
  }
}

function requireControlDesignCreatePermission(actor, subDepartmentId = null) {
  requireControlDesignWorkspaceAccess(actor, subDepartmentId);
  requireControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE, "Control Design project creation permission is required");
}

function canCreateControlDesignProject(actor, subDepartmentId = null) {
  try {
    requireControlDesignCreatePermission(actor, subDepartmentId);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveControlDesignSubDepartment(client = pool) {
  const subDepartment = await controlWorkflowRepository.findSubDepartmentByName(CONTROL_DESIGN_TEMPLATE_NAME, client);
  if (!subDepartment || subDepartment.is_active === false) {
    throw new AppError(409, "Control Design subdivision is not configured");
  }

  return subDepartment;
}

async function getControlDesignCapabilities(actor) {
  requireActor(actor);
  const controlDesign = await resolveControlDesignSubDepartment();
  return buildControlDesignCapabilities(actor, controlDesign.id);
}

function isWorkflowOwner(actor, workflow) {
  return Boolean(getActorId(actor) && workflow?.assigned_user_id === getActorId(actor));
}

function canReadWorkflow(actor, workflow) {
  if (!actor || !workflow || !isControlDesignWorkspaceUser(actor, workflow.sub_department_id)) {
    return false;
  }

  return (isWorkflowOwner(actor, workflow) && hasControlDesignViewAssignedPermission(actor)) || hasControlDesignViewAllPermission(actor);
}

function requireWorkflowOwner(actor, workflow) {
  requireControlDesignWorkspaceAccess(actor, workflow?.sub_department_id || null);
  if (!isWorkflowOwner(actor, workflow)) {
    throw new AppError(403, "Only the assigned project owner can perform this workflow action");
  }
}

function requireWorkflowScopedPermission(actor, workflow, permission, message) {
  requireControlDesignWorkspaceAccess(actor, workflow?.sub_department_id || null);
  if (!canAccessDepartment(actor, workflow?.department_id || null)) {
    throw new AppError(403, "Control Design workflow is outside your department scope");
  }
  if (!canReadWorkflow(actor, workflow)) {
    throw new AppError(404, "Control Design workflow not found");
  }
  requireControlDesignPermission(actor, permission, message);
}

function requireWorkflowReadable(actor, workflow) {
  requireControlDesignWorkspaceAccess(actor, workflow?.sub_department_id || null);
  if (!canReadWorkflow(actor, workflow)) {
    throw new AppError(404, "Control Design workflow not found");
  }
}
function requireWorkflowEditable(workflow) {
  if (
    workflow?.status === WORKFLOW_STATUSES.CANCELLED
    || workflow?.project_status === CONTROL_PROJECT_STATUSES.DISPATCHED
  ) {
    throw new AppError(409, "Dispatched Control Design workflows cannot be edited");
  }
}

function requireReassignmentReason(workflow, assignedUserId, reason) {
  if (workflow?.assigned_user_id && workflow.assigned_user_id !== assignedUserId && !normalizeControlText(reason)) {
    throw new AppError(400, "Reassignment reason is required");
  }
}

function requireNotSelfReview(actor, submittedBy) {
  if (getActorId(actor) && submittedBy === getActorId(actor) && !hasPermission(actor, PERMISSIONS.SELF_APPROVE)) {
    throw new AppError(403, "Self approval requires explicit override permission");
  }
}

function requireSubmissionVersion(stage, submission) {
  if (Number(submission?.stage_version || 0) !== Number(stage?.version || 0)) {
    throw new AppError(409, "The stage changed after submission; refresh before reviewing");
  }
}

function requireProofEditableState(stage) {
  if (![STAGE_STATUSES.IN_PROGRESS, STAGE_STATUSES.CHANGES_REQUIRED, STAGE_STATUSES.UPDATE_REQUIRED].includes(stage?.status)) {
    throw new AppError(409, `Work proof cannot be changed from status ${stage?.status}`);
  }
}

async function findStageRevisionContext(stage, client) {
  const revision = await controlWorkflowRepository.findLatestOpenRevisionForStage(stage.id, client);
  return {
    revision,
    revisionNumber: Number(revision?.revision_number || 0),
  };
}

async function requireSubmissionEvidence(stage, revisionNumber, documentPath, client) {
  const proofCount = await controlWorkflowRepository.countWorkflowProofs(stage.id, revisionNumber, client);
  if (!normalizeControlText(documentPath) && proofCount === 0) {
    throw new AppError(400, "Add a work-proof file or stage document path before submitting.");
  }
}

function normalizeOptionalDate(value, fieldName) {
  const normalized = normalizeControlText(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `${fieldName} is invalid`);
  return date.toISOString();
}

function normalizeOptionalText(value) {
  return normalizeControlText(value) || null;
}

function deriveLifecycleStatus(workflow) {
  if (!workflow) {
    return CONTROL_PROJECT_STATUSES.UNASSIGNED;
  }

  if (workflow.project_status === CONTROL_PROJECT_STATUSES.DISPATCHED) {
    return CONTROL_PROJECT_STATUSES.DISPATCHED;
  }

  const stages = workflow.stages || [];
  if (isControlDesignLifecycleComplete(stages)) {
    return CONTROL_PROJECT_STATUSES.COMPLETED;
  }

  if (isReadyForDispatch(stages)) {
    return CONTROL_PROJECT_STATUSES.READY_FOR_DISPATCH;
  }

  if (stages.some((stage) => stage.status === STAGE_STATUSES.BLOCKED)) {
    return CONTROL_PROJECT_STATUSES.BLOCKED;
  }

  if (!workflow.assigned_user_id) {
    return CONTROL_PROJECT_STATUSES.UNASSIGNED;
  }

  if (hasOpenRevision(stages) || stages.some((stage) => [
    STAGE_STATUSES.IN_PROGRESS,
    STAGE_STATUSES.SUBMITTED_FOR_APPROVAL,
    STAGE_STATUSES.UPDATE_REQUIRED,
    STAGE_STATUSES.REVISION_REQUIRED,
  ].includes(stage.status))) {
    return CONTROL_PROJECT_STATUSES.ACTIVE;
  }

  return CONTROL_PROJECT_STATUSES.ASSIGNED;
}

async function syncWorkflowLifecycle(workflowId, client) {
  const workflow = await loadWorkflowDetails(workflowId, client);
  if (!workflow) {
    return null;
  }

  const lifecycleStatus = deriveLifecycleStatus(workflow);
  const workflowStatus = lifecycleStatus === CONTROL_PROJECT_STATUSES.COMPLETED
    || lifecycleStatus === CONTROL_PROJECT_STATUSES.DISPATCHED
    ? WORKFLOW_STATUSES.COMPLETED
    : WORKFLOW_STATUSES.ACTIVE;
  if (workflow.status !== WORKFLOW_STATUSES.CANCELLED && workflow.status !== workflowStatus) await controlWorkflowRepository.updateWorkflowStatus(workflow.id, workflowStatus, client);
  await controlWorkflowRepository.updateProjectControlLifecycle({
    project_id: workflow.project_id,
    sub_department_id: workflow.sub_department_id,
    lifecycle_status: lifecycleStatus,
  }, client);
  return lifecycleStatus;
}

function normalizeAffectedStageIds(payload, workflow, sourceStageId) {
  const incoming = Array.isArray(payload?.affected_stage_ids)
    ? payload.affected_stage_ids
    : Array.isArray(payload?.affectedStageIds)
      ? payload.affectedStageIds
      : [];
  const validStageIds = new Set((workflow?.stages || []).map((stage) => stage.id));

  return [...new Set(incoming.map(normalizeControlText))]
    .filter((stageId) => stageId && stageId !== sourceStageId && validStageIds.has(stageId));
}

async function notifyWorkflow(workflow, values, client) {
  const recipient = normalizeControlText(values.recipient_user_id);
  if (!recipient || !workflow?.id) {
    return null;
  }

  return controlWorkflowRepository.insertControlNotification({
    workflow_id: workflow.id,
    project_id: workflow.project_id,
    recipient_user_id: recipient,
    notification_type: values.notification_type,
    title: values.title,
    message: values.message,
    idempotency_key: `${workflow.id}:${values.notification_type}:${values.idempotency_key}`,
  }, client);
}

async function recordStageEvent(workflowId, stageId, eventType, actor, details, client, metadata = {}) {
  return controlWorkflowRepository.insertWorkflowEvent({
    workflow_id: workflowId,
    workflow_stage_id: stageId,
    event_type: eventType,
    actor_id: getActorId(actor),
    details,
    metadata,
  }, client);
}
async function requireAssignableOwner(actor, assignedUserId, subDepartmentId, client) {
  const assignee = await findUserByEmployeeId(assignedUserId, client);
  if (!assignee || assignee.is_active === false) {
    throw new AppError(400, "Assigned user must be active");
  }

  if (!isControlDesignWorkspaceUser(assignee, subDepartmentId)) {
    throw new AppError(400, "Assigned user must belong to the active Control Design subdivision");
  }

  if (actor.department_id !== assignee.department_id && !canAccessUser(actor, assignee)) {
    throw new AppError(403, "Assigned user is outside your assignable scope");
  }

  return assignee;
}

function attachProgress(workflow) {
  const progress = calculateWorkflowProgress(workflow?.stages || []);
  return {
    ...workflow,
    progress,
    current_stage: (workflow?.stages || []).find((stage) => stage.id === workflow.current_stage_id)
      || nextUnlockedStage(workflow?.stages || [])
      || null,
  };
}

async function loadWorkflowDetails(workflowId, client = pool) {
  const workflow = await controlWorkflowRepository.findWorkflowById(workflowId, client);
  const hydrated = await controlWorkflowRepository.hydrateWorkflowDetails(workflow, client);
  return hydrated ? attachProgress(hydrated) : null;
}

async function loadWorkflowForStage(stageId, client = pool) {
  const stage = await controlWorkflowRepository.findWorkflowStage(stageId, client);
  if (!stage) {
    throw new AppError(404, "Workflow stage not found");
  }

  const workflow = await controlWorkflowRepository.findWorkflowById(stage.workflow_id, client);
  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }

  return { workflow, stage };
}

async function refreshCurrentStage(workflowId, client) {
  const stages = await controlWorkflowRepository.listWorkflowStages(workflowId, client);
  let current = nextUnlockedStage(stages);

  if (current?.status === STAGE_STATUSES.LOCKED) {
    await controlWorkflowRepository.updateStage(current.id, { status: STAGE_STATUSES.NOT_STARTED }, client);
    current = { ...current, status: STAGE_STATUSES.NOT_STARTED };
  }

  if (!current) {
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflowId, null, client);
    await syncWorkflowLifecycle(workflowId, client);
    return null;
  }

  await controlWorkflowRepository.updateWorkflowCurrentStage(workflowId, current.id, client);
  await syncWorkflowLifecycle(workflowId, client);
  return current;
}

async function listControlSubDepartments(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  return [controlDesign];
}

async function getWorkflowTemplateBySubDepartment(actor, subDepartmentId) {
  const normalizedSubDepartmentId = requireNonEmpty(subDepartmentId, "sub_department_id");
  requireControlDesignWorkspaceAccess(actor, normalizedSubDepartmentId);
  const template = await controlWorkflowRepository.findTemplateBySubDepartment(normalizedSubDepartmentId);

  if (!template) {
    throw new AppError(404, "Workflow template not found for this sub-department");
  }

  return template;
}

async function ensureControlDesignTemplate(subDepartmentId, client, templateId = null) {
  const template = templateId
    ? await controlWorkflowRepository.findTemplateById(templateId, client)
    : await controlWorkflowRepository.findTemplateBySubDepartment(subDepartmentId, client);

  if (!template || template.is_active === false || template.sub_department_id !== subDepartmentId) {
    throw new AppError(404, "Active workflow template not found for Control Design");
  }

  if (!Array.isArray(template.stages) || template.stages.length === 0) {
    throw new AppError(409, "Control Design workflow template has no configured stages");
  }

  return template;
}

async function insertWorkflowWithStages({ projectId, template, assignedUserId, assignedBy }, client) {
  let workflowId;
  try {
    workflowId = await controlWorkflowRepository.insertProjectWorkflow({
      project_id: projectId,
      department_id: template.department_id,
      sub_department_id: template.sub_department_id,
      template_id: template.id,
      assigned_user_id: assignedUserId,
      assigned_by: assignedBy || null,
    }, client);
  } catch (error) {
    if (error?.code === "23505") {
      throw new AppError(409, "An active Control Design workflow already exists for this project");
    }
    throw error;
  }

  const initialStages = createInitialStageRows(template.stages);
  let firstStageId = null;
  for (const stage of initialStages) {
    const stageId = await controlWorkflowRepository.insertProjectWorkflowStage({
      ...stage,
      workflow_id: workflowId,
    }, client);
    await controlWorkflowRepository.insertWorkflowEvent({
      workflow_id: workflowId,
      workflow_stage_id: stageId,
      event_type: "stage_initialized",
      actor_id: assignedBy || null,
      details: `${stage.stage_name} initialized`,
    }, client);
    if (!firstStageId) {
      firstStageId = stageId;
      await controlWorkflowRepository.insertWorkflowEvent({
        workflow_id: workflowId,
        workflow_stage_id: stageId,
        event_type: "stage_unlocked",
        actor_id: assignedBy || null,
        details: `${stage.stage_name} is available`,
      }, client);
    }
  }

  if (firstStageId && assignedUserId) {
    await controlWorkflowRepository.insertWorkflowEvent({
      workflow_id: workflowId,
      workflow_stage_id: firstStageId,
      event_type: "assignment_changed",
      actor_id: assignedBy || null,
      details: "Assigned to " + assignedUserId,
      metadata: { assigned_user_id: assignedUserId },
    }, client);
  }
  await controlWorkflowRepository.insertWorkflowEvent({
    workflow_id: workflowId,
    event_type: "workflow_initialized",
    actor_id: assignedBy || null,
    details: "Control Design lifecycle initialized",
    metadata: { project_id: projectId },
  }, client);
  await controlWorkflowRepository.updateWorkflowCurrentStage(workflowId, firstStageId, client);
  await syncWorkflowLifecycle(workflowId, client);
  return loadWorkflowDetails(workflowId, client);
}

async function createProjectWorkflow(actor, payload = {}) {
  requireActor(actor);
  const projectId = requireNonEmpty(payload.project_id, "project_id");
  const subDepartmentId = requireNonEmpty(payload.sub_department_id, "sub_department_id");
  const assignedUserId = requireNonEmpty(payload.assigned_user_id, "assigned_user_id");
  requireControlDesignWorkspaceAccess(actor, subDepartmentId);
  requireControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN, "Control Design project assignment permission is required");

  return withTransaction(async (client) => {
    const template = await ensureControlDesignTemplate(subDepartmentId, client, payload.template_id || null);
    const project = await findProjectByIdForDepartment(projectId, template.department_id, { activeOnly: false }, client);
    if (!project) {
      throw new AppError(404, "Control Design project not found");
    }

    const existing = await controlWorkflowRepository.findActiveProjectWorkflow({
      projectId,
      subDepartmentId,
      templateId: template.id,
    }, client);
    if (existing) {
      throw new AppError(409, "An active Control Design workflow already exists for this project");
    }

    await requireAssignableOwner(actor, assignedUserId, subDepartmentId, client);
    return insertWorkflowWithStages({
      projectId,
      template,
      assignedUserId,
      assignedBy: getActorId(actor),
    }, client);
  });
}

async function reassignProjectWorkflowOwner(actor, workflowId, assignedUserId, reason = null) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const workflow = await controlWorkflowRepository.findWorkflowById(requireNonEmpty(workflowId, "workflow_id"), client);
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }
    requireControlDesignWorkspaceAccess(actor, workflow.sub_department_id);
    requireControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN, "Control Design project reassignment permission is required");
    const normalizedAssignedUserId = requireNonEmpty(assignedUserId, "assigned_user_id");
    requireWorkflowEditable(workflow);
    requireReassignmentReason(workflow, normalizedAssignedUserId, reason);
    await requireAssignableOwner(actor, normalizedAssignedUserId, workflow.sub_department_id, client);
    await controlWorkflowRepository.updateWorkflowOwner(workflow.id, normalizedAssignedUserId, getActorId(actor), reason, client);
    await syncWorkflowLifecycle(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: normalizedAssignedUserId,
      notification_type: "CONTROL_PROJECT_REASSIGNED",
      title: "Control Design project reassigned",
      message: `${updated.project_no || updated.project_id} has been assigned to you.`,
      idempotency_key: `reassigned:${normalizedAssignedUserId}:${updated.assigned_at || Date.now()}`,
    }, client);
    await recordStageEvent(
      workflow.id,
      workflow.current_stage_id,
      "assignment_changed",
      actor,
      `Assigned to ${normalizedAssignedUserId}`,
      client,
      { previous_user_id: workflow.assigned_user_id || null, assigned_user_id: normalizedAssignedUserId, reason: reason || null },
    );
    if (workflow.assigned_user_id && workflow.assigned_user_id !== normalizedAssignedUserId) {
      await notifyWorkflow(updated, {
        recipient_user_id: workflow.assigned_user_id,
        notification_type: "CONTROL_PROJECT_REASSIGNED_FROM_YOU",
        title: "Control Design project reassigned",
        message: `${updated.project_no || updated.project_id} was reassigned from you.`,
        idempotency_key: `reassigned-from:${workflow.assigned_user_id}:${updated.assigned_at || Date.now()}`,
      }, client);
    }
    return updated;
  });
}

async function getProjectWorkflow(actor, payload = {}) {
  requireActor(actor);
  const projectId = requireNonEmpty(payload.project_id, "project_id");
  const subDepartmentId = requireNonEmpty(payload.sub_department_id, "sub_department_id");
  requireControlDesignWorkspaceAccess(actor, subDepartmentId);
  const workflow = await controlWorkflowRepository.findActiveProjectWorkflow({
    projectId,
    subDepartmentId,
    templateId: payload.template_id || null,
  });

  if (!workflow) {
    return null;
  }

  requireWorkflowReadable(actor, workflow);
  return loadWorkflowDetails(workflow.id);
}

async function listControlDesignProjects(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  if (!hasControlDesignViewAllPermission(actor) && !hasControlDesignViewAssignedPermission(actor)) {
    throw new AppError(403, "Control Design project visibility permission is required");
  }
  return controlWorkflowRepository.listControlDesignProjects({
    subDepartmentId: controlDesign.id,
    assignedUserId: hasControlDesignViewAllPermission(actor) ? null : getActorId(actor),
    activeOnly: false,
  });
}

async function getControlDesignSummary(actor) {
  const projects = await listControlDesignProjects(actor);
  const isCompleted = (project) => project.lifecycle_summary?.completed === true;
  const isActive = (project) => !isCompleted(project) && !["cancelled", "completed", "dispatched"].includes(project.project_status);
  return {
    total: projects.length,
    active: projects.filter(isActive).length,
    pending: projects.filter((project) => Number(project.lifecycle_summary?.pending_approval_count || 0) > 0).length,
    updates: projects.filter((project) => Number(project.lifecycle_summary?.updates_required_count || 0) > 0).length,
    completed: projects.filter(isCompleted).length,
  };
}

function normalizeBudgetAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new AppError(400, "Budget is required");
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new AppError(400, "Budget must be a non-negative decimal amount");
  }

  const [whole, fraction = ""] = raw.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  return `${normalizedWhole}.${fraction.padEnd(2, "0")}`;
}

function normalizeControlDesignProjectPayload(payload = {}) {
  const priority = normalizeOptionalText(payload.priority);
  if (priority && !["low", "medium", "high", "urgent"].includes(priority.toLowerCase())) {
    throw new AppError(400, "Priority is invalid");
  }
  const plannedStartDate = normalizeOptionalDate(payload.planned_start_date ?? payload.plannedStartDate, "Planned start date");
  const targetCompletionDate = normalizeOptionalDate(payload.target_completion_date ?? payload.targetCompletionDate, "Target completion date");
  if (plannedStartDate && targetCompletionDate && new Date(targetCompletionDate) < new Date(plannedStartDate)) {
    throw new AppError(400, "Target completion date cannot be before planned start date");
  }

  return {
    project_no: requireNonEmpty(payload.project_id ?? payload.projectId, "Project ID"),
    project_name: requireNonEmpty(payload.project_name ?? payload.projectName, "Project Name"),
    customer_name: requireNonEmpty(payload.customer ?? payload.customer_name ?? payload.customerName, "Customer"),
    budget_amount: normalizeBudgetAmount(payload.budget ?? payload.budget_amount ?? payload.budgetAmount),
    assigned_user_id: requireNonEmpty(payload.assigned_user_id ?? payload.assignedUserId, "Assigned Control Design member"),
    priority: priority?.toLowerCase() || null,
    planned_start_date: plannedStartDate,
    target_completion_date: targetCompletionDate,
    project_root_path: normalizeOptionalText(payload.project_root_path ?? payload.projectRootPath),
    notes: normalizeOptionalText(payload.notes),
  };
}

function normalizeBudgetCurrency(value) {
  const currency = String(value || "INR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError(400, "budget_currency must be a three-letter currency code");
  }

  return currency;
}

async function createControlDesignProject(actor, payload = {}) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignCreatePermission(actor, controlDesign.id);

  const normalized = normalizeControlDesignProjectPayload(payload);

  return withTransaction(async (client) => {
    await requireAssignableOwner(actor, normalized.assigned_user_id, controlDesign.id, client);
    const template = await ensureControlDesignTemplate(controlDesign.id, client);
    let project;

    try {
      project = await insertProjectByNumber({
        project_no: normalized.project_no,
        project_name: normalized.project_name,
        customer_name: normalized.customer_name,
        department_id: controlDesign.department_id,
        uploaded_by: getActorId(actor),
        created_by_user_id: getActorId(actor),
      }, client);
    } catch (error) {
      if (error?.code === "23505") {
        throw new AppError(409, "A project with this Project ID already exists.");
      }
      throw error;
    }

    await controlWorkflowRepository.upsertProjectControlRecord({
      project_id: project.project_id,
      sub_department_id: controlDesign.id,
      budget_amount: normalized.budget_amount,
      budget_currency: "INR",
      created_by: getActorId(actor),
      lifecycle_status: CONTROL_PROJECT_STATUSES.UNASSIGNED,
      priority: normalized.priority,
      planned_start_date: normalized.planned_start_date,
      target_completion_date: normalized.target_completion_date,
      project_root_path: normalized.project_root_path,
      notes: normalized.notes,
    }, client);

    const existing = await controlWorkflowRepository.findActiveProjectWorkflow({
      projectId: project.project_id,
      subDepartmentId: controlDesign.id,
      templateId: template.id,
    }, client);
    if (existing) {
      throw new AppError(409, "An active Control Design workflow already exists for this project");
    }

    const workflow = await insertWorkflowWithStages({
      projectId: project.project_id,
      template,
      assignedUserId: normalized.assigned_user_id,
      assignedBy: getActorId(actor),
    }, client);

    await recordStageEvent(
      workflow.id,
      null,
      "project_created",
      actor,
      `${normalized.project_no} created`,
      client,
      { project_id: project.project_id, project_no: normalized.project_no },
    );

    return controlWorkflowRepository.findControlDesignProject(project.project_id, controlDesign.id, client);
  });
}
async function createControlDesignCo(actor, payload = {}) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  requireControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_EDIT, "Control Design project edit permission is required");

  const projectId = requireNonEmpty(payload.project_id, "project_id");
  const budgetAmount = normalizeBudgetAmount(payload.budget_amount);
  const budgetCurrency = normalizeBudgetCurrency(payload.budget_currency);

  return withTransaction(async (client) => {
    const project = await findProjectByIdForDepartment(projectId, controlDesign.department_id, { activeOnly: false }, client);
    if (!project) {
      throw new AppError(404, "Control Design project not found");
    }

    return controlWorkflowRepository.upsertProjectControlRecord({
      project_id: projectId,
      sub_department_id: controlDesign.id,
      budget_amount: budgetAmount,
      budget_currency: budgetCurrency,
      created_by: getActorId(actor),
    }, client);
  });
}

async function listControlDesignAssignableUsers(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  if (!hasControlDesignAssignPermission(actor) && !hasControlDesignReassignPermission(actor) && !hasControlDesignCreatePermission(actor)) {
    throw new AppError(403, "Control Design assignment permission is required");
  }

  const users = await listUsers();
  return users
    .filter((candidate) => (
      candidate?.is_active !== false
      && isControlDesignWorkspaceUser(candidate, controlDesign.id)
      && (actor.department_id === candidate.department_id || canAccessUser(actor, candidate))
    ))
    .sort((left, right) => String(left.name || left.employee_id).localeCompare(String(right.name || right.employee_id)));
}

async function assignControlDesignProjectOwner(actor, projectId, assignedUserId, reason = null) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);

  const normalizedProjectId = requireNonEmpty(projectId, "project_id");
  const normalizedAssignedUserId = requireNonEmpty(assignedUserId, "assigned_user_id");

  return withTransaction(async (client) => {
    const template = await ensureControlDesignTemplate(controlDesign.id, client);
    const project = await findProjectByIdForDepartment(normalizedProjectId, template.department_id, { activeOnly: false }, client);
    if (!project) {
      throw new AppError(404, "Control Design project not found");
    }

    const existing = await controlWorkflowRepository.findActiveProjectWorkflow({
      projectId: normalizedProjectId,
      subDepartmentId: controlDesign.id,
      templateId: template.id,
    }, client);

    if (existing) {
      if (!hasControlDesignReassignPermission(actor)) {
        throw new AppError(403, "Control Design project reassignment permission is required");
      }
      requireWorkflowEditable(existing);
      requireReassignmentReason(existing, normalizedAssignedUserId, reason);
      await requireAssignableOwner(actor, normalizedAssignedUserId, controlDesign.id, client);
      await controlWorkflowRepository.updateWorkflowOwner(existing.id, normalizedAssignedUserId, getActorId(actor), reason, client);
      await syncWorkflowLifecycle(existing.id, client);
      await recordStageEvent(
        existing.id,
        existing.current_stage_id,
        "assignment_changed",
        actor,
        "Assigned to " + normalizedAssignedUserId,
        client,
        { previous_user_id: existing.assigned_user_id || null, assigned_user_id: normalizedAssignedUserId, reason: reason || null },
      );
      const updated = await loadWorkflowDetails(existing.id, client);
      await notifyWorkflow(updated, {
        recipient_user_id: normalizedAssignedUserId,
        notification_type: existing.assigned_user_id ? "CONTROL_PROJECT_REASSIGNED" : "CONTROL_PROJECT_ASSIGNED",
        title: "Control Design project assigned",
        message: `${updated.project_no || updated.project_id} has been assigned to you.`,
        idempotency_key: `assigned:${normalizedAssignedUserId}:${updated.assigned_at || Date.now()}`,
      }, client);
      if (existing.assigned_user_id && existing.assigned_user_id !== normalizedAssignedUserId) {
        await notifyWorkflow(updated, {
          recipient_user_id: existing.assigned_user_id,
          notification_type: "CONTROL_PROJECT_REASSIGNED_FROM_YOU",
          title: "Control Design project reassigned",
          message: `${updated.project_no || updated.project_id} was reassigned from you.`,
          idempotency_key: `reassigned-from:${existing.assigned_user_id}:${updated.assigned_at || Date.now()}`,
        }, client);
      }
      return updated;
    }

    requireControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN, "Control Design project assignment permission is required");
    await requireAssignableOwner(actor, normalizedAssignedUserId, controlDesign.id, client);
    const workflow = await insertWorkflowWithStages({
      projectId: normalizedProjectId,
      template,
      assignedUserId: normalizedAssignedUserId,
      assignedBy: getActorId(actor),
    }, client);
    await notifyWorkflow(workflow, {
      recipient_user_id: normalizedAssignedUserId,
      notification_type: "CONTROL_PROJECT_ASSIGNED",
      title: "Control Design project assigned",
      message: `${workflow.project_no || workflow.project_id} has been assigned to you.`,
      idempotency_key: `assigned:${normalizedAssignedUserId}:${workflow.assigned_at || Date.now()}`,
    }, client);
    return workflow;
  });
}
async function addStageComment(actor, stageId, payload = {}) {
  requireActor(actor);
  const comment = requireNonEmpty(payload.comment, "comment");
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowReadable(actor, workflow);
    await recordStageEvent(workflow.id, stage.id, "comment_added", actor, comment, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function startStage(actor, stageId, payload = {}) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_STAGES_START, "Control Design stage start permission is required");
    requireWorkflowOwner(actor, workflow);
    requireWorkflowEditable(workflow);
    if (!canStartStage(stage)) {
      throw new AppError(409, `Stage cannot be started from status ${stage.status}`);
    }

    const stages = await controlWorkflowRepository.listWorkflowStages(workflow.id, client);
    const stageIndex = stages.findIndex((item) => item.id === stage.id);
    const previousStage = stageIndex > 0 ? stages[stageIndex - 1] : null;
    if (previousStage && !isApprovedForProgress(previousStage.status)) {
      throw new AppError(409, "The previous stage must be approved before this stage can start");
    }

    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.IN_PROGRESS,
      touch_started_at: true,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before starting it");
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    await recordStageEvent(workflow.id, stage.id, "stage_started", actor, `${stage.stage_name} started`, client);
    await syncWorkflowLifecycle(workflow.id, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function updateDocumentPath(actor, stageId, payload = {}) {
  requireActor(actor);
  const newPath = requireNonEmpty(payload.document_path, "document_path");
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_PATHS_UPDATE, "Control Design path update permission is required");
    requireWorkflowOwner(actor, workflow);
    requireWorkflowEditable(workflow);
    requireProofEditableState(stage);
    const { revisionNumber } = await findStageRevisionContext(stage, client);

    if (stage.current_document_path !== newPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        revision_number: revisionNumber,
        old_path: stage.current_document_path || null,
        new_path: newPath,
        changed_by: getActorId(actor),
        change_remarks: payload.remarks || null,
      }, client);
    }

    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      current_document_path: newPath,
      remarks: payload.remarks || stage.remarks || null,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before updating its path");
    await syncWorkflowLifecycle(workflow.id, client);
    await recordStageEvent(workflow.id, stage.id, "path_updated", actor, payload.remarks || "Stage path updated", client, { document_path: newPath, revision_number: revisionNumber });
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function submitStageForApproval(actor, stageId, payload = {}) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_STAGES_SUBMIT, "Control Design stage submit permission is required");
    requireWorkflowOwner(actor, workflow);
    requireWorkflowEditable(workflow);
    if (!canSubmitStage(stage)) {
      throw new AppError(409, `Stage cannot be submitted from status ${stage.status}`);
    }
    if (await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client)) {
      throw new AppError(409, "A pending submission already exists for this stage");
    }
    if (await controlWorkflowRepository.findLatestOpenRevisionForStage(stage.id, client)) {
      throw new AppError(409, "Submit post-approval updates through the active revision");
    }

    const submittedDocumentPath = normalizeOptionalText(payload.submitted_document_path) || stage.current_document_path || null;
    await requireSubmissionEvidence(stage, 0, submittedDocumentPath, client);

    if (submittedDocumentPath && stage.current_document_path !== submittedDocumentPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        revision_number: 0,
        old_path: stage.current_document_path || null,
        new_path: submittedDocumentPath,
        changed_by: getActorId(actor),
        change_remarks: "Submission document path",
      }, client);
    }

    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.PENDING_APPROVAL,
      current_document_path: submittedDocumentPath,
      touch_submitted_at: true,
      remarks: payload.remarks || null,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before submitting");
    const submissionId = await controlWorkflowRepository.insertSubmission({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      submitted_by: getActorId(actor),
      submitted_document_path: submittedDocumentPath,
      stage_version: updatedStage.version,
      remarks: payload.remarks || null,
    }, client);
    await recordStageEvent(workflow.id, stage.id, "stage_submitted", actor, payload.remarks || `${stage.stage_name} submitted for approval`, client, { submission_id: submissionId, revision_number: 0 });
    await syncWorkflowLifecycle(workflow.id, client);
    await notifyWorkflow(workflow, {
      recipient_user_id: workflow.assigned_by,
      notification_type: "CONTROL_STAGE_SUBMITTED",
      title: "Control Design stage submitted",
      message: `${stage.stage_name} was submitted for ${workflow.project_no || workflow.project_id}.`,
      idempotency_key: `stage-submitted:${stage.id}:${submissionId}`,
    }, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function approveStageSubmission(actor, stageId, payload = {}) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE, "Control Design approval permission is required");
    requireWorkflowEditable(workflow);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client);
    if (!submission) {
      throw new AppError(409, "No pending submission exists for this stage");
    }
    if (stage.status !== STAGE_STATUSES.PENDING_APPROVAL) {
      throw new AppError(409, `Stage cannot be approved from status ${stage.status}`);
    }
    requireSubmissionVersion(stage, submission);
    requireNotSelfReview(actor, submission.submitted_by);

    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.APPROVED,
      reviewed_by: getActorId(actor),
      review_remarks: payload.review_remarks || null,
    }, client);
    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.APPROVED,
      touch_approved_at: true,
      approved_by: getActorId(actor),
      remarks: payload.review_remarks || stage.remarks || null,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before approving");
    const unlockedStage = await refreshCurrentStage(workflow.id, client);
    await recordStageEvent(workflow.id, stage.id, "stage_approved", actor, payload.review_remarks || `${stage.stage_name} approved`, client, { submission_id: submission.id });
    if (unlockedStage && unlockedStage.id !== stage.id) await recordStageEvent(workflow.id, unlockedStage.id, "stage_unlocked", actor, `${unlockedStage.stage_name} unlocked`, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_STAGE_APPROVED",
      title: "Control Design stage approved",
      message: `${stage.stage_name} was approved for ${updated.project_no || updated.project_id}.`,
      idempotency_key: `stage-approved:${stage.id}:${submission.id}`,
    }, client);
    return updated;
  });
}

async function markStageRevisionRequired(actor, stageId, payload = {}) {
  requireActor(actor);
  const reason = requireNonEmpty(payload.reason || payload.rejection_reason, "reason");
  const instruction = requireNonEmpty(payload.detailed_instruction || payload.required_changes || payload.review_remarks, "detailed_instruction");
  const dueDate = normalizeOptionalDate(payload.correction_deadline || payload.due_date, "correction_deadline");

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES, "Control Design changes-required permission is required");
    requireWorkflowEditable(workflow);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client);
    if (!submission) {
      throw new AppError(409, "No pending submission exists for this stage");
    }
    if (stage.status !== STAGE_STATUSES.PENDING_APPROVAL) {
      throw new AppError(409, `Stage cannot be marked changes required from status ${stage.status}`);
    }
    requireSubmissionVersion(stage, submission);
    requireNotSelfReview(actor, submission.submitted_by);

    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.REVISION_REQUIRED,
      reviewed_by: getActorId(actor),
      review_remarks: instruction,
      rejection_reason: reason,
      correction_deadline: dueDate,
    }, client);

    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.CHANGES_REQUIRED,
      touch_rejected_at: true,
      rejection_reason: reason,
      due_date: dueDate,
      remarks: instruction,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before requesting changes");
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    await recordStageEvent(workflow.id, stage.id, "changes_required", actor, instruction, client, { revision_number: 0, submission_id: submission.id, reason, correction_deadline: dueDate });
    await syncWorkflowLifecycle(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_STAGE_CHANGES_REQUIRED",
      title: "Control Design changes required",
      message: stage.stage_name + " needs changes for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "stage-changes-required:" + stage.id + ":" + submission.id,
    }, client);
    return updated;
  });
}
async function raiseRevision(actor, stageId, payload = {}) {
  requireActor(actor);
  const reason = normalizeRevisionReason(payload.revision_reason);
  if (!reason) throw new AppError(400, "revision_reason is invalid");
  assertOtherReasonHasManualRemarks(reason, payload.manual_reason);
  const description = requireNonEmpty(payload.description, "description");
  const dueDate = normalizeOptionalDate(requireNonEmpty(payload.due_date, "due_date"), "due_date");

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE, "Control Design revision raise permission is required");
    requireWorkflowEditable(workflow);
    if (![STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status)) {
      throw new AppError(409, "Only approved or pre-completed stages can have post-approval revisions raised");
    }
    if (!workflow.assigned_user_id) throw new AppError(409, "A project owner is required before raising a revision");

    const hydrated = await loadWorkflowDetails(workflow.id, client);
    const affectedStageIds = normalizeAffectedStageIds(payload, hydrated, stage.id);
    const revisionRow = await controlWorkflowRepository.insertRevision({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      revision_reason: reason,
      reference_path: payload.reference_path || stage.current_document_path || null,
      manual_reason: payload.manual_reason || null,
      description,
      due_date: dueDate,
      priority: payload.priority || null,
      affected_stage_ids: affectedStageIds,
      raised_by: getActorId(actor),
      assigned_to: workflow.assigned_user_id,
      remarks: payload.remarks || null,
    }, client);
    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.UPDATE_REQUIRED,
      due_date: dueDate,
      remarks: description,
      actor_id: getActorId(actor),
    }, client);
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    await recordStageEvent(workflow.id, stage.id, "update_requested", actor, description, client, {
      revision_id: revisionRow.id,
      revision_number: revisionRow.revision_number,
      reason,
      due_date: dueDate,
      affected_stage_ids: affectedStageIds,
    });
    await syncWorkflowLifecycle(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_REVISION_RAISED",
      title: "Control Design revision raised",
      message: stage.stage_name + " has a revision for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "revision-raised:" + revisionRow.id,
    }, client);
    return updated;
  });
}

async function startRevision(actor, revisionId) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) throw new AppError(404, "Revision not found");
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE, "Control Design revision execution permission is required");
    requireWorkflowEditable(workflow);
    if (revision.assigned_to !== getActorId(actor)) {
      throw new AppError(403, "Only the assigned project owner can start this revision");
    }
    if (![REVISION_STATUSES.NOT_STARTED, REVISION_STATUSES.CHANGES_REQUIRED].includes(revision.status)) {
      throw new AppError(409, `Revision cannot be started from status ${revision.status}`);
    }

    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.IN_PROGRESS,
      touch_started_at: true,
    }, client);
    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.UPDATE_REQUIRED,
      actor_id: getActorId(actor),
    }, client);
    await recordStageEvent(workflow.id, stage.id, "update_started", actor, "Revision work started", client, {
      revision_id: revision.id,
      revision_number: revision.revision_number,
    });
    await syncWorkflowLifecycle(revision.workflow_id, client);
    return loadWorkflowDetails(revision.workflow_id, client);
  });
}
async function submitRevisionForApproval(actor, revisionId, payload = {}) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) throw new AppError(404, "Revision not found");
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE, "Control Design revision execution permission is required");
    requireWorkflowEditable(workflow);
    if (revision.assigned_to !== getActorId(actor)) {
      throw new AppError(403, "Only the assigned project owner can submit this revision");
    }
    if (revision.status !== REVISION_STATUSES.IN_PROGRESS) {
      throw new AppError(409, `Revision cannot be submitted from status ${revision.status}`);
    }

    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    if (await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client)) {
      throw new AppError(409, "A pending submission already exists for this stage");
    }
    const submittedDocumentPath = normalizeOptionalText(payload.submitted_document_path) || stage.current_document_path || null;
    await requireSubmissionEvidence(stage, revision.revision_number, submittedDocumentPath, client);
    if (submittedDocumentPath && stage.current_document_path !== submittedDocumentPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        revision_number: revision.revision_number,
        old_path: stage.current_document_path || null,
        new_path: submittedDocumentPath,
        changed_by: getActorId(actor),
        change_remarks: payload.remarks || "Revision submission document path",
      }, client);
    }

    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.SUBMITTED_FOR_APPROVAL,
      touch_submitted_at: true,
      remarks: payload.remarks || revision.remarks || null,
    }, client);
    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.PENDING_APPROVAL,
      current_document_path: submittedDocumentPath,
      touch_submitted_at: true,
      remarks: payload.remarks || stage.remarks || null,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before submitting the revision");
    const submissionId = await controlWorkflowRepository.insertSubmission({
      workflow_stage_id: stage.id,
      workflow_id: revision.workflow_id,
      revision_id: revision.id,
      submitted_by: getActorId(actor),
      submitted_document_path: submittedDocumentPath,
      stage_version: updatedStage.version,
      remarks: payload.remarks || null,
    }, client);
    await recordStageEvent(workflow.id, stage.id, "revision_submitted", actor, payload.remarks || "Updated work submitted for approval", client, {
      revision_id: revision.id,
      revision_number: revision.revision_number,
      submission_id: submissionId,
    });
    await syncWorkflowLifecycle(revision.workflow_id, client);
    await notifyWorkflow(workflow, {
      recipient_user_id: workflow.assigned_by,
      notification_type: "CONTROL_REVISION_SUBMITTED",
      title: "Control Design revision submitted",
      message: stage.stage_name + " revision was submitted for " + (workflow.project_no || workflow.project_id) + ".",
      idempotency_key: "revision-submitted:" + revision.id + ":" + submissionId,
    }, client);
    return loadWorkflowDetails(revision.workflow_id, client);
  });
}
async function approveRevision(actor, revisionId, payload = {}) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) throw new AppError(404, "Revision not found");
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW, "Control Design revision review permission is required");
    requireWorkflowEditable(workflow);
    if (revision.status !== REVISION_STATUSES.SUBMITTED_FOR_APPROVAL) {
      throw new AppError(409, `Revision cannot be approved from status ${revision.status}`);
    }

    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(revision.workflow_stage_id, client);
    if (!submission) throw new AppError(409, "No pending revision submission exists");
    if (stage.status !== STAGE_STATUSES.PENDING_APPROVAL) {
      throw new AppError(409, `Stage cannot be approved from status ${stage.status}`);
    }
    requireSubmissionVersion(stage, submission);
    requireNotSelfReview(actor, submission.submitted_by);
    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.APPROVED,
      reviewed_by: getActorId(actor),
      review_remarks: payload.review_remarks || null,
    }, client);
    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.APPROVED,
      approved_by: getActorId(actor),
      touch_approved_at: true,
      remarks: payload.review_remarks || revision.remarks || null,
    }, client);
    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.APPROVED,
      current_document_path: submission.submitted_document_path || stage.current_document_path || null,
      touch_approved_at: true,
      approved_by: getActorId(actor),
      remarks: payload.review_remarks || stage.remarks || null,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before approving the revision");
    await refreshCurrentStage(workflow.id, client);
    await recordStageEvent(workflow.id, stage.id, "revision_approved", actor, payload.review_remarks || "Updated work approved", client, {
      revision_id: revision.id,
      revision_number: revision.revision_number,
      submission_id: submission.id,
    });
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_REVISION_APPROVED",
      title: "Control Design revision approved",
      message: stage.stage_name + " revision was approved for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "revision-approved:" + revision.id + ":" + submission.id,
    }, client);
    return updated;
  });
}

async function markRevisionChangesRequired(actor, revisionId, payload = {}) {
  requireActor(actor);
  const reason = requireNonEmpty(payload.reason || payload.rejection_reason, "reason");
  const instruction = requireNonEmpty(payload.detailed_instruction || payload.required_changes || payload.review_remarks, "detailed_instruction");
  const dueDate = normalizeOptionalDate(payload.correction_deadline || payload.due_date, "correction_deadline");
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) throw new AppError(404, "Revision not found");
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW, "Control Design revision review permission is required");
    requireWorkflowEditable(workflow);
    if (revision.status !== REVISION_STATUSES.SUBMITTED_FOR_APPROVAL) {
      throw new AppError(409, `Revision cannot be marked changes required from status ${revision.status}`);
    }
    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client);
    if (!submission) throw new AppError(409, "No pending revision submission exists");
    if (stage.status !== STAGE_STATUSES.PENDING_APPROVAL) {
      throw new AppError(409, `Stage cannot be marked changes required from status ${stage.status}`);
    }
    requireSubmissionVersion(stage, submission);
    requireNotSelfReview(actor, submission.submitted_by);
    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.REVISION_REQUIRED,
      reviewed_by: getActorId(actor),
      review_remarks: instruction,
      rejection_reason: reason,
      correction_deadline: dueDate,
    }, client);
    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.CHANGES_REQUIRED,
      remarks: instruction,
    }, client);
    const updatedStage = await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.CHANGES_REQUIRED,
      touch_rejected_at: true,
      rejection_reason: reason,
      due_date: dueDate,
      remarks: instruction,
      actor_id: getActorId(actor),
      expected_version: Number.isInteger(payload.version) ? payload.version : null,
    }, client);
    if (!updatedStage) throw new AppError(409, "Stage changed; refresh before requesting revision changes");
    await recordStageEvent(workflow.id, stage.id, "revision_changes_required", actor, instruction, client, {
      revision_id: revision.id,
      revision_number: revision.revision_number,
      submission_id: submission.id,
      reason,
      correction_deadline: dueDate,
    });
    await syncWorkflowLifecycle(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_REVISION_CHANGES_REQUIRED",
      title: "Control Design revision changes required",
      message: stage.stage_name + " revision needs changes for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "revision-changes-required:" + revision.id + ":" + submission.id,
    }, client);
    return updated;
  });
}
async function uploadWorkflowProof(actor, stageId, file, payload = {}) {
  requireActor(actor);
  if (!file) throw new AppError(400, "Work-proof file is required");
  let storedFile = null;
  try {
    return await withTransaction(async (client) => {
      const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
      requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_PROOFS_UPLOAD, "Control Design proof upload permission is required");
      requireWorkflowOwner(actor, workflow);
      requireWorkflowEditable(workflow);
      requireProofEditableState(stage);
      const { revisionNumber } = await findStageRevisionContext(stage, client);
      storedFile = await persistControlWorkflowProofFile(file);
      const proof = await controlWorkflowRepository.insertWorkflowProof({
        workflow_id: workflow.id,
        project_id: workflow.project_id,
        workflow_stage_id: stage.id,
        revision_number: revisionNumber,
        original_filename: storedFile.originalName,
        storage_key: storedFile.storageKey,
        file_path: storedFile.filePath,
        mime_type: storedFile.mimeType,
        file_size: file.size || file.buffer.length,
        uploaded_by: getActorId(actor),
        comment: normalizeOptionalText(payload.comment),
      }, client);
      await recordStageEvent(workflow.id, stage.id, "proof_uploaded", actor, `${storedFile.originalName} uploaded`, client, {
        proof_id: proof.id,
        revision_number: revisionNumber,
        filename: storedFile.originalName,
        file_size: Number(file.size || file.buffer.length),
      });
      return proof;
    });
  } catch (error) {
    if (storedFile?.storageKey) await removeControlWorkflowProofFile(storedFile.storageKey);
    throw error;
  }
}

async function removeWorkflowProof(actor, proofId) {
  requireActor(actor);
  const removed = await withTransaction(async (client) => {
    const proof = await controlWorkflowRepository.findWorkflowProofById(requireNonEmpty(proofId, "proof_id"), client);
    if (!proof) throw new AppError(404, "Work proof not found");
    const workflow = await controlWorkflowRepository.findWorkflowById(proof.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_PROOFS_UPLOAD, "Control Design proof upload permission is required");
    requireWorkflowOwner(actor, workflow);
    requireWorkflowEditable(workflow);
    const stage = await controlWorkflowRepository.findWorkflowStage(proof.workflow_stage_id, client);
    requireProofEditableState(stage);
    const { revisionNumber } = await findStageRevisionContext(stage, client);
    if (Number(proof.revision_number) !== revisionNumber) {
      throw new AppError(409, "Proofs from an earlier submission or revision cannot be removed");
    }
    await controlWorkflowRepository.deleteWorkflowProof(proof.id, client);
    await recordStageEvent(workflow.id, stage.id, "proof_removed", actor, `${proof.original_filename} removed`, client, {
      proof_id: proof.id,
      revision_number: proof.revision_number,
      filename: proof.original_filename,
    });
    return proof;
  });
  try {
    await removeControlWorkflowProofFile(removed.storage_key);
  } catch (error) {
    console.warn("Failed to remove Control Design proof file", { proof_id: removed.id, error: error.message });
  }
  return { id: removed.id };
}

async function getWorkflowProofFile(actor, proofId) {
  requireActor(actor);
  const proof = await controlWorkflowRepository.findWorkflowProofById(requireNonEmpty(proofId, "proof_id"));
  if (!proof) throw new AppError(404, "Work proof not found");
  const workflow = await controlWorkflowRepository.findWorkflowById(proof.workflow_id);
  requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_PROOFS_VIEW, "Control Design proof view permission is required");
  return {
    ...proof,
    file_path: resolveControlWorkflowProofPath(proof.storage_key),
  };
}
async function markStagePreCompleted(actor, stageId, payload = {}) {
  requireActor(actor);
  const completionDate = requireNonEmpty(payload.completion_date, "completion_date");
  const documentPath = requireNonEmpty(payload.document_path, "document_path");
  const approvedBy = requireNonEmpty(payload.approved_by || getActorId(actor), "approved_by");

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_STAGES_MARK_PRE_COMPLETED, "Control Design pre-complete permission is required");
    requireWorkflowEditable(workflow);

    if (stage.current_document_path !== documentPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        old_path: stage.current_document_path || null,
        new_path: documentPath,
        changed_by: getActorId(actor),
        change_remarks: payload.remarks || "Pre-Completed document path",
      }, client);
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.PRE_COMPLETED,
      current_document_path: documentPath,
      touch_approved_at: true,
      approved_at: completionDate,
      approved_by: approvedBy,
      remarks: payload.remarks || null,
    }, client);
    await recordStageEvent(workflow.id, stage.id, "stage_pre_completed", actor, payload.remarks || (stage.stage_name + " marked pre-completed"), client, { approved_by: approvedBy, completion_date: completionDate });
    await refreshCurrentStage(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_STAGE_PRE_COMPLETED",
      title: "Control Design stage pre-completed",
      message: stage.stage_name + " was marked pre-completed for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "stage-pre-completed:" + stage.id + ":" + completionDate,
    }, client);
    return updated;
  });
}

async function overrideUnlockStage(actor, stageId, payload = {}) {
  requireActor(actor);
  const reason = requireNonEmpty(payload.reason, "reason");
  const remarks = requireNonEmpty(payload.remarks, "remarks");
  if (payload.confirm_history_record !== true) {
    throw new AppError(400, "Override confirmation is required");
  }

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_STAGES_OVERRIDE_UNLOCK, "Control Design override unlock permission is required");
    requireWorkflowEditable(workflow);
    if (stage.status !== STAGE_STATUSES.LOCKED) {
      throw new AppError(409, "Only locked stages can be override-unlocked");
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.NOT_STARTED,
      remarks,
    }, client);
    await controlWorkflowRepository.insertOverride({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      unlocked_by: getActorId(actor),
      action_type: "override_unlock",
      reason,
      remarks,
    }, client);
    await recordStageEvent(workflow.id, stage.id, "override_performed", actor, remarks, client, { action: "override_unlock", reason });
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    await syncWorkflowLifecycle(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_OVERRIDE_UNLOCK",
      title: "Control Design stage override-unlocked",
      message: stage.stage_name + " was override-unlocked for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "override-unlock:" + stage.id + ":" + reason,
    }, client);
    return updated;
  });
}

async function skipStageByOverride(actor, stageId, payload = {}) {
  requireActor(actor);
  const reason = requireNonEmpty(payload.reason, "reason");
  const supportingDocumentPath = requireNonEmpty(payload.supporting_document_path || payload.document_path, "supporting_document_path");
  const remarks = requireNonEmpty(payload.remarks, "remarks");
  const approvedBy = requireNonEmpty(payload.approved_by || getActorId(actor), "approved_by");

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_STAGES_SKIP_OVERRIDE, "Control Design skip override permission is required");
    requireWorkflowEditable(workflow);
    if ([STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status)) {
      throw new AppError(409, "Approved stages cannot be skipped by override");
    }
    if (stage.current_document_path !== supportingDocumentPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        old_path: stage.current_document_path || null,
        new_path: supportingDocumentPath,
        changed_by: getActorId(actor),
        change_remarks: remarks,
      }, client);
    }
    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.SKIPPED_BY_OVERRIDE,
      current_document_path: supportingDocumentPath,
      approved_by: approvedBy,
      touch_approved_at: true,
      remarks,
    }, client);
    await controlWorkflowRepository.insertOverride({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      unlocked_by: getActorId(actor),
      action_type: "skip_by_override",
      reason,
      supporting_document_path: supportingDocumentPath,
      approved_by: approvedBy,
      remarks,
    }, client);
    await recordStageEvent(workflow.id, stage.id, "override_performed", actor, remarks, client, { action: "skip_by_override", reason, approved_by: approvedBy, supporting_document_path: supportingDocumentPath });
    await refreshCurrentStage(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_STAGE_SKIPPED_BY_OVERRIDE",
      title: "Control Design stage skipped by override",
      message: stage.stage_name + " was skipped by override for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "skip-by-override:" + stage.id + ":" + reason,
    }, client);
    return updated;
  });
}

async function markWorkflowDispatched(actor, workflowId, payload = {}) {
  requireActor(actor);
  const dispatchDate = requireNonEmpty(payload.dispatch_date, "dispatch_date");
  const remarks = requireNonEmpty(payload.remarks, "remarks");

  return withTransaction(async (client) => {
    const workflow = await controlWorkflowRepository.findWorkflowById(requireNonEmpty(workflowId, "workflow_id"), client);
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED, "Control Design dispatch permission is required");
    requireWorkflowEditable(workflow);
    const hydrated = await loadWorkflowDetails(workflow.id, client);
    if (!isReadyForDispatch(hydrated.stages || [])) {
      throw new AppError(409, "Control Design project is not ready for dispatch");
    }
    await controlWorkflowRepository.updateProjectControlLifecycle({
      project_id: workflow.project_id,
      sub_department_id: workflow.sub_department_id,
      lifecycle_status: CONTROL_PROJECT_STATUSES.DISPATCHED,
      mark_dispatched: true,
      dispatched_by: getActorId(actor),
      dispatched_at: dispatchDate,
      dispatch_remarks: remarks,
    }, client);
    await controlWorkflowRepository.updateWorkflowStatus(workflow.id, WORKFLOW_STATUSES.COMPLETED, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_PROJECT_DISPATCHED",
      title: "Control Design project dispatched",
      message: (updated.project_no || updated.project_id) + " has been marked dispatched.",
      idempotency_key: "project-dispatched:" + workflow.id + ":" + dispatchDate,
    }, client);
    return updated;
  });
}
async function listPendingApprovals(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  requireControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_APPROVALS_REVIEW, "Control Design approval queue permission is required");
  return controlWorkflowRepository.listPendingApprovalQueue({ departmentId: controlDesign.department_id });
}

async function listRevisionQueue(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  const reviewer = hasControlDesignRevisionReviewPermission(actor);
  const executor = hasControlDesignPermission(actor, PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE);
  if (!reviewer && !executor) {
    throw new AppError(403, "Control Design revision queue permission is required");
  }
  return controlWorkflowRepository.listRevisionQueue({
    departmentId: controlDesign.department_id,
    assignedTo: reviewer ? null : getActorId(actor),
  });
}

module.exports = {
  addStageComment,
  approveRevision,
  approveStageSubmission,
  assignControlDesignProjectOwner,
  canCreateControlDesignProject,
  createControlDesignCo,
  createControlDesignProject,
  createProjectWorkflow,
  getControlDesignCapabilities,
  getControlDesignSummary,
  getProjectWorkflow,
  getWorkflowProofFile,
  getWorkflowTemplateBySubDepartment,
  listControlDesignAssignableUsers,
  listControlDesignProjects,
  listControlSubDepartments,
  listPendingApprovals,
  listRevisionQueue,
  markRevisionChangesRequired,
  markStagePreCompleted,
  markStageRevisionRequired,
  normalizeBudgetAmount,
  normalizeControlDesignProjectPayload,
  markWorkflowDispatched,
  removeWorkflowProof,
  overrideUnlockStage,
  raiseRevision,
  reassignProjectWorkflowOwner,
  requireControlDesignCreatePermission,
  skipStageByOverride,
  startRevision,
  startStage,
  submitRevisionForApproval,
  submitStageForApproval,
  updateDocumentPath,
  uploadWorkflowProof,
};
