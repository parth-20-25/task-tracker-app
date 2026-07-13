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
  hasOpenRevision,
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
  if (workflow?.status === WORKFLOW_STATUSES.COMPLETED || workflow?.project_status === CONTROL_PROJECT_STATUSES.DISPATCHED) {
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

function deriveLifecycleStatus(workflow) {
  if (!workflow) {
    return CONTROL_PROJECT_STATUSES.UNASSIGNED;
  }

  if (workflow.project_status === CONTROL_PROJECT_STATUSES.DISPATCHED || workflow.status === WORKFLOW_STATUSES.COMPLETED) {
    return CONTROL_PROJECT_STATUSES.DISPATCHED;
  }

  const stages = workflow.stages || [];
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
    if (!firstStageId) {
      firstStageId = stageId;
    }
  }

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
  return {
    project_no: requireNonEmpty(payload.project_id ?? payload.projectId, "Project ID"),
    project_name: requireNonEmpty(payload.project_name ?? payload.projectName, "Project Name"),
    customer_name: requireNonEmpty(payload.customer ?? payload.customer_name ?? payload.customerName, "Customer"),
    budget_amount: normalizeBudgetAmount(payload.budget ?? payload.budget_amount ?? payload.budgetAmount),
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
    }, client);

    const existing = await controlWorkflowRepository.findActiveProjectWorkflow({
      projectId: project.project_id,
      subDepartmentId: controlDesign.id,
      templateId: template.id,
    }, client);
    if (existing) {
      throw new AppError(409, "An active Control Design workflow already exists for this project");
    }

    await insertWorkflowWithStages({
      projectId: project.project_id,
      template,
      assignedUserId: null,
      assignedBy: null,
    }, client);

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
  if (!hasControlDesignAssignPermission(actor) && !hasControlDesignReassignPermission(actor)) {
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
async function startStage(actor, stageId) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_STAGES_START, "Control Design stage start permission is required");
    requireWorkflowOwner(actor, workflow);
    requireWorkflowEditable(workflow);
    if (!canStartStage(stage)) {
      throw new AppError(409, `Stage cannot be started from status ${stage.status}`);
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.IN_PROGRESS,
      touch_started_at: true,
    }, client);
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
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

    if (stage.current_document_path !== newPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        old_path: stage.current_document_path || null,
        new_path: newPath,
        changed_by: getActorId(actor),
        change_remarks: payload.remarks || null,
      }, client);
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      current_document_path: newPath,
      remarks: payload.remarks || stage.remarks || null,
    }, client);
    await syncWorkflowLifecycle(workflow.id, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function submitStageForApproval(actor, stageId, payload = {}) {
  requireActor(actor);
  const submittedDocumentPath = requireNonEmpty(payload.submitted_document_path, "submitted_document_path");
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

    if (stage.current_document_path !== submittedDocumentPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
        old_path: stage.current_document_path || null,
        new_path: submittedDocumentPath,
        changed_by: getActorId(actor),
        change_remarks: "Submission document path",
      }, client);
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.SUBMITTED_FOR_APPROVAL,
      current_document_path: submittedDocumentPath,
      touch_submitted_at: true,
      remarks: payload.remarks || null,
    }, client);
    const submissionId = await controlWorkflowRepository.insertSubmission({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      submitted_by: getActorId(actor),
      submitted_document_path: submittedDocumentPath,
      remarks: payload.remarks || null,
    }, client);
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
    requireNotSelfReview(actor, submission.submitted_by);

    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.APPROVED,
      reviewed_by: getActorId(actor),
      review_remarks: payload.review_remarks || null,
    }, client);
    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.APPROVED,
      touch_approved_at: true,
      approved_by: getActorId(actor),
      remarks: payload.review_remarks || stage.remarks || null,
    }, client);
    await refreshCurrentStage(workflow.id, client);
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
  const requiredChanges = requireNonEmpty(payload.description || payload.required_changes, "required_changes");
  const dueDate = requireNonEmpty(payload.due_date, "due_date");
  const remarks = requireNonEmpty(payload.review_remarks || payload.remarks, "review_remarks");
  const reason = normalizeRevisionReason(payload.revision_reason || "Internal Correction");
  if (!reason) {
    throw new AppError(400, "revision_reason is invalid");
  }
  assertOtherReasonHasManualRemarks(reason, payload.manual_reason);
  const revisionPayload = {
    revision_reason: reason,
    manual_reason: payload.manual_reason || null,
    description: requiredChanges,
    due_date: dueDate,
    priority: payload.priority || null,
    remarks,
  };

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES, "Control Design changes-required permission is required");
    requireWorkflowEditable(workflow);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client);
    if (!submission) {
      throw new AppError(409, "No pending submission exists for this stage");
    }
    requireNotSelfReview(actor, submission.submitted_by);

    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.REVISION_REQUIRED,
      reviewed_by: getActorId(actor),
      review_remarks: remarks,
    }, client);

    if (revisionPayload) {
      await controlWorkflowRepository.insertRevision({
        workflow_stage_id: stage.id,
        workflow_id: workflow.id,
        revision_reason: revisionPayload.revision_reason,
        manual_reason: revisionPayload.manual_reason,
        description: revisionPayload.description,
        due_date: revisionPayload.due_date,
        priority: revisionPayload.priority,
        raised_by: getActorId(actor),
        assigned_to: workflow.assigned_user_id,
        remarks: revisionPayload.remarks,
      }, client);
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.REVISION_REQUIRED,
      remarks,
    }, client);
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
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
  if (!reason) {
    throw new AppError(400, "revision_reason is invalid");
  }
  assertOtherReasonHasManualRemarks(reason, payload.manual_reason);
  const description = requireNonEmpty(payload.description, "description");
  const dueDate = requireNonEmpty(payload.due_date, "due_date");

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE, "Control Design revision raise permission is required");
    requireWorkflowEditable(workflow);
    if (![STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status)) {
      throw new AppError(409, "Only approved or pre-completed stages can have post-approval revisions raised");
    }
    if (!workflow.assigned_user_id) {
      throw new AppError(409, "A project owner is required before raising a revision");
    }

    const hydrated = await loadWorkflowDetails(workflow.id, client);
    const affectedStageIds = normalizeAffectedStageIds(payload, hydrated, stage.id);
    const revisionId = await controlWorkflowRepository.insertRevision({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      revision_reason: reason,
      manual_reason: payload.manual_reason || null,
      description,
      due_date: dueDate,
      priority: payload.priority || null,
      affected_stage_ids: affectedStageIds,
      raised_by: getActorId(actor),
      assigned_to: workflow.assigned_user_id,
      remarks: payload.remarks || null,
    }, client);
    await syncWorkflowLifecycle(workflow.id, client);
    const updated = await loadWorkflowDetails(workflow.id, client);
    await notifyWorkflow(updated, {
      recipient_user_id: updated.assigned_user_id,
      notification_type: "CONTROL_REVISION_RAISED",
      title: "Control Design revision raised",
      message: stage.stage_name + " has a revision for " + (updated.project_no || updated.project_id) + ".",
      idempotency_key: "revision-raised:" + revisionId,
    }, client);
    return updated;
  });
}
async function startRevision(actor, revisionId) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) {
      throw new AppError(404, "Revision not found");
    }
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE, "Control Design revision execution permission is required");
    requireWorkflowEditable(workflow);
    if (revision.assigned_to !== getActorId(actor)) {
      throw new AppError(403, "Only the assigned project owner can start this revision");
    }
    if (![REVISION_STATUSES.NOT_STARTED, REVISION_STATUSES.CHANGES_REQUIRED].includes(revision.status)) {
      throw new AppError(409, `Revision cannot be started from status ${revision.status}`);
    }

    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.IN_PROGRESS,
      touch_started_at: true,
    }, client);
    await syncWorkflowLifecycle(revision.workflow_id, client);
    return loadWorkflowDetails(revision.workflow_id, client);
  });
}

async function submitRevisionForApproval(actor, revisionId, payload = {}) {
  requireActor(actor);
  const submittedDocumentPath = requireNonEmpty(payload.submitted_document_path, "submitted_document_path");
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) {
      throw new AppError(404, "Revision not found");
    }
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
    if (stage.current_document_path !== submittedDocumentPath) {
      await controlWorkflowRepository.insertDocumentHistory({
        workflow_stage_id: stage.id,
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
    await controlWorkflowRepository.updateStage(stage.id, {
      status: [STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status) ? null : STAGE_STATUSES.SUBMITTED_FOR_APPROVAL,
      current_document_path: [STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status) ? stage.current_document_path : submittedDocumentPath,
      touch_submitted_at: true,
      remarks: payload.remarks || stage.remarks || null,
    }, client);
    const submissionId = await controlWorkflowRepository.insertSubmission({
      workflow_stage_id: stage.id,
      workflow_id: revision.workflow_id,
      revision_id: revision.id,
      submitted_by: getActorId(actor),
      submitted_document_path: submittedDocumentPath,
      remarks: payload.remarks || null,
    }, client);
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
    if (!revision) {
      throw new AppError(404, "Revision not found");
    }
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW, "Control Design revision review permission is required");
    requireWorkflowEditable(workflow);
    if (revision.status !== REVISION_STATUSES.SUBMITTED_FOR_APPROVAL) {
      throw new AppError(409, `Revision cannot be approved from status ${revision.status}`);
    }

    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(revision.workflow_stage_id, client);
    if (!submission) {
      throw new AppError(409, "No pending revision submission exists");
    }
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
    await controlWorkflowRepository.updateStage(revision.workflow_stage_id, {
      status: [STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status) ? null : STAGE_STATUSES.APPROVED,
      current_document_path: submission.submitted_document_path,
      touch_approved_at: true,
      approved_by: getActorId(actor),
      remarks: payload.review_remarks || stage.remarks || null,
    }, client);
    await refreshCurrentStage(workflow.id, client);
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
  const remarks = requireNonEmpty(payload.review_remarks || payload.required_changes || payload.remarks, "review_remarks");
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) {
      throw new AppError(404, "Revision not found");
    }
    const workflow = await controlWorkflowRepository.findWorkflowById(revision.workflow_id, client);
    requireWorkflowScopedPermission(actor, workflow, PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW, "Control Design revision review permission is required");
    requireWorkflowEditable(workflow);
    if (revision.status !== REVISION_STATUSES.SUBMITTED_FOR_APPROVAL) {
      throw new AppError(409, `Revision cannot be marked changes required from status ${revision.status}`);
    }
    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(revision.workflow_stage_id, client);
    if (!submission) {
      throw new AppError(409, "No pending revision submission exists");
    }
    requireNotSelfReview(actor, submission.submitted_by);
    await controlWorkflowRepository.updateSubmissionReview(submission.id, {
      status: SUBMISSION_STATUSES.REVISION_REQUIRED,
      reviewed_by: getActorId(actor),
      review_remarks: remarks,
    }, client);
    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.CHANGES_REQUIRED,
      remarks,
    }, client);
    await controlWorkflowRepository.updateStage(stage.id, {
      status: [STAGE_STATUSES.APPROVED, STAGE_STATUSES.PRE_COMPLETED].includes(stage.status) ? null : STAGE_STATUSES.REVISION_REQUIRED,
      remarks,
    }, client);
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
  approveRevision,
  approveStageSubmission,
  assignControlDesignProjectOwner,
  canCreateControlDesignProject,
  createControlDesignCo,
  createControlDesignProject,
  createProjectWorkflow,
  getControlDesignCapabilities,
  getProjectWorkflow,
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
};
