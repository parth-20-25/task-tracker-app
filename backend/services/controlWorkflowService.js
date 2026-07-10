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
  WORKFLOW_STATUSES,
  assertOtherReasonHasManualRemarks,
  calculateWorkflowProgress,
  canStartStage,
  canSubmitStage,
  createInitialStageRows,
  isControlDesignWorkspaceUser,
  isTerminalStageStatus,
  nextUnlockedStage,
  normalizeControlText,
  normalizeRevisionReason,
} = require("../lib/controlWorkflow");
const {
  canAccessDepartment,
  canAccessUser,
  canAssignTo,
  hasPermission,
} = require("./accessControlService");
const { findProjectByIdForDepartment } = require("../repositories/designProjectCatalogRepository");
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

function hasControlDesignViewAllPermission(actor) {
  return hasPermission(actor, PERMISSIONS.CONTROL_DESIGN_VIEW_ALL_PROJECTS)
    || hasPermission(actor, PERMISSIONS.CONTROL_DESIGN_ASSIGN_PROJECTS)
    || hasPermission(actor, PERMISSIONS.CONTROL_DESIGN_REASSIGN_PROJECTS)
    || hasPermission(actor, PERMISSIONS.ASSIGN_TASK);
}

function hasControlDesignAssignPermission(actor) {
  return hasPermission(actor, PERMISSIONS.CONTROL_DESIGN_ASSIGN_PROJECTS)
    || hasPermission(actor, PERMISSIONS.ASSIGN_TASK);
}

function hasControlDesignReassignPermission(actor) {
  return hasPermission(actor, PERMISSIONS.CONTROL_DESIGN_REASSIGN_PROJECTS)
    || hasControlDesignAssignPermission(actor);
}

function hasControlDesignReviewPermission(actor) {
  return hasPermission(actor, PERMISSIONS.APPROVE_COMPLETED_TASK)
    || hasPermission(actor, PERMISSIONS.CHANGE_FIXTURE_STAGE)
    || hasControlDesignAssignPermission(actor);
}

function requireControlDesignWorkspaceAccess(actor, subDepartmentId = null) {
  requireActor(actor);
  if (!isControlDesignWorkspaceUser(actor, subDepartmentId)) {
    throw new AppError(403, "Control Design workspace access requires Control department and Control Design subdivision membership");
  }
}

async function resolveControlDesignSubDepartment(client = pool) {
  const subDepartment = await controlWorkflowRepository.findSubDepartmentByName(CONTROL_DESIGN_TEMPLATE_NAME, client);
  if (!subDepartment || subDepartment.is_active === false) {
    throw new AppError(409, "Control Design subdivision is not configured");
  }

  return subDepartment;
}

function isWorkflowOwner(actor, workflow) {
  return Boolean(getActorId(actor) && workflow?.assigned_user_id === getActorId(actor));
}

function canReviewWorkflow(actor, workflow) {
  return Boolean(
    actor
    && workflow
    && isControlDesignWorkspaceUser(actor, workflow.sub_department_id)
    && hasControlDesignReviewPermission(actor)
    && canAccessDepartment(actor, workflow.department_id)
  );
}

function canReadWorkflow(actor, workflow) {
  if (!actor || !workflow || !isControlDesignWorkspaceUser(actor, workflow.sub_department_id)) {
    return false;
  }

  return isWorkflowOwner(actor, workflow) || hasControlDesignViewAllPermission(actor);
}

function requireWorkflowOwner(actor, workflow) {
  requireControlDesignWorkspaceAccess(actor, workflow?.sub_department_id || null);
  if (!isWorkflowOwner(actor, workflow)) {
    throw new AppError(403, "Only the assigned project owner can perform this workflow action");
  }
}

function requireWorkflowReviewer(actor, workflow) {
  requireControlDesignWorkspaceAccess(actor, workflow?.sub_department_id || null);
  if (!canReviewWorkflow(actor, workflow)) {
    throw new AppError(403, "Control Design workflow review requires approval or assignment permission");
  }
}

function requireWorkflowReadable(actor, workflow) {
  requireControlDesignWorkspaceAccess(actor, workflow?.sub_department_id || null);
  if (!canReadWorkflow(actor, workflow)) {
    throw new AppError(403, "You do not have access to this Control Design workflow");
  }
}

async function requireAssignableOwner(actor, assignedUserId, subDepartmentId, client) {
  const assignee = await findUserByEmployeeId(assignedUserId, client);
  if (!assignee || assignee.is_active === false) {
    throw new AppError(400, "Assigned user must be active");
  }

  if (!isControlDesignWorkspaceUser(assignee, subDepartmentId)) {
    throw new AppError(400, "Assigned user must belong to the active Control Design subdivision");
  }

  if (!canAssignTo(actor, assignee) && !(canAccessUser(actor, assignee) && actor.department_id === assignee.department_id)) {
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
    await controlWorkflowRepository.updateWorkflowStatus(workflowId, WORKFLOW_STATUSES.COMPLETED, client);
    return null;
  }

  await controlWorkflowRepository.updateWorkflowCurrentStage(workflowId, current.id, client);
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
  return loadWorkflowDetails(workflowId, client);
}

async function createProjectWorkflow(actor, payload = {}) {
  requireActor(actor);
  const projectId = requireNonEmpty(payload.project_id, "project_id");
  const subDepartmentId = requireNonEmpty(payload.sub_department_id, "sub_department_id");
  const assignedUserId = requireNonEmpty(payload.assigned_user_id, "assigned_user_id");
  requireControlDesignWorkspaceAccess(actor, subDepartmentId);
  if (!hasControlDesignAssignPermission(actor)) {
    throw new AppError(403, "Control Design project assignment permission is required");
  }

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

async function reassignProjectWorkflowOwner(actor, workflowId, assignedUserId) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const workflow = await controlWorkflowRepository.findWorkflowById(requireNonEmpty(workflowId, "workflow_id"), client);
    if (!workflow) {
      throw new AppError(404, "Workflow not found");
    }
    requireControlDesignWorkspaceAccess(actor, workflow.sub_department_id);
    if (!hasControlDesignReassignPermission(actor)) {
      throw new AppError(403, "Control Design project reassignment permission is required");
    }
    await requireAssignableOwner(actor, requireNonEmpty(assignedUserId, "assigned_user_id"), workflow.sub_department_id, client);
    await controlWorkflowRepository.updateWorkflowOwner(workflow.id, assignedUserId, getActorId(actor), client);
    return loadWorkflowDetails(workflow.id, client);
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
  return controlWorkflowRepository.listControlDesignProjects({
    subDepartmentId: controlDesign.id,
    assignedUserId: hasControlDesignViewAllPermission(actor) ? null : getActorId(actor),
    activeOnly: false,
  });
}

function normalizeBudgetAmount(value) {
  if (value === null || value === undefined || value === "") {
    throw new AppError(400, "budget_amount is required");
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError(400, "budget_amount must be a non-negative number");
  }

  return Math.round(amount * 100) / 100;
}

function normalizeBudgetCurrency(value) {
  const currency = String(value || "INR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError(400, "budget_currency must be a three-letter currency code");
  }

  return currency;
}

async function createControlDesignCo(actor, payload = {}) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  if (!hasControlDesignAssignPermission(actor)) {
    throw new AppError(403, "Control Design CO creation requires assignment permission");
  }

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
  if (!hasControlDesignAssignPermission(actor)) {
    throw new AppError(403, "Control Design assignment permission is required");
  }

  const users = await listUsers();
  return users
    .filter((candidate) => (
      candidate?.is_active !== false
      && isControlDesignWorkspaceUser(candidate, controlDesign.id)
      && (canAssignTo(actor, candidate) || (canAccessUser(actor, candidate) && actor.department_id === candidate.department_id))
    ))
    .sort((left, right) => String(left.name || left.employee_id).localeCompare(String(right.name || right.employee_id)));
}

async function assignControlDesignProjectOwner(actor, projectId, assignedUserId) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  if (!hasControlDesignAssignPermission(actor)) {
    throw new AppError(403, "Control Design project assignment permission is required");
  }

  const normalizedProjectId = requireNonEmpty(projectId, "project_id");
  const normalizedAssignedUserId = requireNonEmpty(assignedUserId, "assigned_user_id");

  return withTransaction(async (client) => {
    const template = await ensureControlDesignTemplate(controlDesign.id, client);
    const project = await findProjectByIdForDepartment(normalizedProjectId, template.department_id, { activeOnly: false }, client);
    if (!project) {
      throw new AppError(404, "Control Design project not found");
    }

    await requireAssignableOwner(actor, normalizedAssignedUserId, controlDesign.id, client);
    const existing = await controlWorkflowRepository.findActiveProjectWorkflow({
      projectId: normalizedProjectId,
      subDepartmentId: controlDesign.id,
      templateId: template.id,
    }, client);

    if (existing) {
      if (!hasControlDesignReassignPermission(actor)) {
        throw new AppError(403, "Control Design project reassignment permission is required");
      }
      await controlWorkflowRepository.updateWorkflowOwner(existing.id, normalizedAssignedUserId, getActorId(actor), client);
      return loadWorkflowDetails(existing.id, client);
    }

    return insertWorkflowWithStages({
      projectId: normalizedProjectId,
      template,
      assignedUserId: normalizedAssignedUserId,
      assignedBy: getActorId(actor),
    }, client);
  });
}
async function startStage(actor, stageId) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowOwner(actor, workflow);
    if (!canStartStage(stage)) {
      throw new AppError(409, `Stage cannot be started from status ${stage.status}`);
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.IN_PROGRESS,
      touch_started_at: true,
    }, client);
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function updateDocumentPath(actor, stageId, payload = {}) {
  requireActor(actor);
  const newPath = requireNonEmpty(payload.document_path, "document_path");
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowOwner(actor, workflow);

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
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function submitStageForApproval(actor, stageId, payload = {}) {
  requireActor(actor);
  const submittedDocumentPath = requireNonEmpty(payload.submitted_document_path, "submitted_document_path");
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowOwner(actor, workflow);
    if (!canSubmitStage(stage)) {
      throw new AppError(409, `Stage cannot be submitted from status ${stage.status}`);
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
    await controlWorkflowRepository.insertSubmission({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      submitted_by: getActorId(actor),
      submitted_document_path: submittedDocumentPath,
      remarks: payload.remarks || null,
    }, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function approveStageSubmission(actor, stageId, payload = {}) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowReviewer(actor, workflow);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client);
    if (!submission) {
      throw new AppError(409, "No pending submission exists for this stage");
    }

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
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function markStageRevisionRequired(actor, stageId, payload = {}) {
  requireActor(actor);
  const remarks = requireNonEmpty(payload.review_remarks || payload.description || payload.remarks, "review_remarks");
  const shouldCreateRevision = Boolean(payload.description || payload.due_date || payload.revision_reason);
  let revisionPayload = null;

  if (shouldCreateRevision) {
    const reason = normalizeRevisionReason(payload.revision_reason || "Internal Correction");
    if (!reason) {
      throw new AppError(400, "revision_reason is invalid");
    }
    assertOtherReasonHasManualRemarks(reason, payload.manual_reason);
    revisionPayload = {
      revision_reason: reason,
      manual_reason: payload.manual_reason || null,
      description: requireNonEmpty(payload.description || remarks, "description"),
      due_date: requireNonEmpty(payload.due_date, "due_date"),
      priority: payload.priority || null,
      remarks: payload.remarks || null,
    };
  }

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowReviewer(actor, workflow);
    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(stage.id, client);
    if (!submission) {
      throw new AppError(409, "No pending submission exists for this stage");
    }

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
    return loadWorkflowDetails(workflow.id, client);
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
    requireWorkflowReviewer(actor, workflow);

    await controlWorkflowRepository.insertRevision({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      revision_reason: reason,
      manual_reason: payload.manual_reason || null,
      description,
      due_date: dueDate,
      priority: payload.priority || null,
      raised_by: getActorId(actor),
      assigned_to: workflow.assigned_user_id,
      remarks: payload.remarks || null,
    }, client);
    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.REVISION_REQUIRED,
      remarks: description,
    }, client);
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function startRevision(actor, revisionId) {
  requireActor(actor);
  return withTransaction(async (client) => {
    const revision = await controlWorkflowRepository.findRevisionById(requireNonEmpty(revisionId, "revision_id"), client);
    if (!revision) {
      throw new AppError(404, "Revision not found");
    }
    if (revision.assigned_to !== getActorId(actor)) {
      throw new AppError(403, "Only the assigned project owner can start this revision");
    }
    if (revision.status !== REVISION_STATUSES.NOT_STARTED) {
      throw new AppError(409, `Revision cannot be started from status ${revision.status}`);
    }

    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.IN_PROGRESS,
      touch_started_at: true,
    }, client);
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
    if (revision.assigned_to !== getActorId(actor)) {
      throw new AppError(403, "Only the assigned project owner can submit this revision");
    }
    if (revision.status !== REVISION_STATUSES.IN_PROGRESS) {
      throw new AppError(409, `Revision cannot be submitted from status ${revision.status}`);
    }

    const stage = await controlWorkflowRepository.findWorkflowStage(revision.workflow_stage_id, client);
    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.SUBMITTED_FOR_APPROVAL,
      touch_submitted_at: true,
      remarks: payload.remarks || revision.remarks || null,
    }, client);
    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.SUBMITTED_FOR_APPROVAL,
      current_document_path: submittedDocumentPath,
      touch_submitted_at: true,
      remarks: payload.remarks || stage.remarks || null,
    }, client);
    await controlWorkflowRepository.insertSubmission({
      workflow_stage_id: stage.id,
      workflow_id: revision.workflow_id,
      revision_id: revision.id,
      submitted_by: getActorId(actor),
      submitted_document_path: submittedDocumentPath,
      remarks: payload.remarks || null,
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
    requireWorkflowReviewer(actor, workflow);
    if (revision.status !== REVISION_STATUSES.SUBMITTED_FOR_APPROVAL) {
      throw new AppError(409, `Revision cannot be approved from status ${revision.status}`);
    }

    const submission = await controlWorkflowRepository.findPendingSubmissionForStage(revision.workflow_stage_id, client);
    if (submission) {
      await controlWorkflowRepository.updateSubmissionReview(submission.id, {
        status: SUBMISSION_STATUSES.APPROVED,
        reviewed_by: getActorId(actor),
        review_remarks: payload.review_remarks || null,
      }, client);
    }
    await controlWorkflowRepository.updateRevision(revision.id, {
      status: REVISION_STATUSES.APPROVED,
      approved_by: getActorId(actor),
      touch_approved_at: true,
      remarks: payload.review_remarks || revision.remarks || null,
    }, client);
    await controlWorkflowRepository.updateStage(revision.workflow_stage_id, {
      status: STAGE_STATUSES.APPROVED,
      touch_approved_at: true,
      approved_by: getActorId(actor),
      remarks: payload.review_remarks || null,
    }, client);
    await refreshCurrentStage(workflow.id, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function markStagePreCompleted(actor, stageId, payload = {}) {
  requireActor(actor);
  const completionDate = requireNonEmpty(payload.completion_date, "completion_date");
  const documentPath = requireNonEmpty(payload.document_path, "document_path");
  const approvedBy = requireNonEmpty(payload.approved_by || getActorId(actor), "approved_by");

  return withTransaction(async (client) => {
    const { workflow, stage } = await loadWorkflowForStage(requireNonEmpty(stageId, "stage_id"), client);
    requireWorkflowReviewer(actor, workflow);

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
    return loadWorkflowDetails(workflow.id, client);
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
    requireWorkflowReviewer(actor, workflow);
    const stages = await controlWorkflowRepository.listWorkflowStages(workflow.id, client);
    const sorted = [...stages].sort((left, right) => left.sequence_order - right.sequence_order);

    for (const candidate of sorted) {
      if (candidate.sequence_order >= stage.sequence_order) {
        break;
      }
      if (!isTerminalStageStatus(candidate.status)) {
        await controlWorkflowRepository.updateStage(candidate.id, {
          status: STAGE_STATUSES.SKIPPED_BY_OVERRIDE,
          remarks: `Bypassed by override before ${stage.stage_name}: ${reason}`,
        }, client);
      }
    }

    await controlWorkflowRepository.updateStage(stage.id, {
      status: STAGE_STATUSES.NOT_STARTED,
      remarks,
    }, client);
    await controlWorkflowRepository.insertOverride({
      workflow_stage_id: stage.id,
      workflow_id: workflow.id,
      unlocked_by: getActorId(actor),
      reason,
      remarks,
    }, client);
    await controlWorkflowRepository.updateWorkflowCurrentStage(workflow.id, stage.id, client);
    return loadWorkflowDetails(workflow.id, client);
  });
}

async function listPendingApprovals(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  if (!hasControlDesignReviewPermission(actor)) {
    return [];
  }
  return controlWorkflowRepository.listPendingApprovalQueue({ departmentId: controlDesign.department_id });
}

async function listRevisionQueue(actor) {
  const controlDesign = await resolveControlDesignSubDepartment();
  requireControlDesignWorkspaceAccess(actor, controlDesign.id);
  const reviewer = hasControlDesignReviewPermission(actor);
  return controlWorkflowRepository.listRevisionQueue({
    departmentId: controlDesign.department_id,
    assignedTo: reviewer ? null : getActorId(actor),
  });
}

module.exports = {
  approveRevision,
  approveStageSubmission,
  assignControlDesignProjectOwner,
  createControlDesignCo,
  createProjectWorkflow,
  getProjectWorkflow,
  getWorkflowTemplateBySubDepartment,
  listControlDesignAssignableUsers,
  listControlDesignProjects,
  listControlSubDepartments,
  listPendingApprovals,
  listRevisionQueue,
  markStagePreCompleted,
  markStageRevisionRequired,
  overrideUnlockStage,
  raiseRevision,
  reassignProjectWorkflowOwner,
  startRevision,
  startStage,
  submitRevisionForApproval,
  submitStageForApproval,
  updateDocumentPath,
};
