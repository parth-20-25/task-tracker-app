const {
  TASK_SOURCES,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TASK_TYPES,
  VERIFICATION_STATUSES,
} = require("../config/constants");
const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");
const { getAdjacentWorkflowStage, getWorkflow, getStageById } = require("./workflowService");
const { releaseFixtureStageAssignment, advanceWorkflowAfterTaskApproval } = require("./fixtureWorkflowService");
const { AppError } = require("../lib/AppError");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  addTaskLog,
  appendTaskActivity,
  cancelTask,
  findTaskById,
  insertTask,
  listTaskActivity,
  listTasksByAccess,
  listVerificationTasksByAccess,
  updateTaskDetails,
  updateTaskProof,
  updateTaskStatus,
  updateTaskVerification,
} = require("../repositories/tasksRepository");
const {
  findUserByEmployeeId,
  listUsers,
} = require("../repositories/usersRepository");
const { listDepartments } = require("../repositories/departmentsRepository");
const { countProjectsByDepartment } = require("../repositories/designProjectCatalogRepository");
const {
  findWorkflowTemplateById,
  listWorkflowTemplates,
} = require("../repositories/workflowTemplatesRepository");
const { canAccessTask, canAssignTo, canVerifyTask, getTaskAccess, isAdmin, isTaskAssignee } = require("./accessControlService");
const { getEscalationSchedule } = require("./escalationService");
const { notifyDepartment, notifyTaskAssignees } = require("./notificationService");
const { refreshPerformanceAnalyticsForDepartment } = require("./performanceAnalyticsService");
const { ensureDepartmentWorkflow } = require("./workflowRecoveryService");

async function listTasksForUser(user) {
  return listTasksByAccess(getTaskAccess(user));
}

async function listVerificationTasksForUser(user) {
  return listVerificationTasksByAccess(getTaskAccess(user), user.employee_id);
}

async function refreshTaskPerformanceAnalytics(taskOrDepartmentId) {
  const departmentId = typeof taskOrDepartmentId === "string"
    ? taskOrDepartmentId
    : taskOrDepartmentId?.department_id || null;

  await refreshPerformanceAnalyticsForDepartment(departmentId);
}

function isWorkflowManagedTask(task) {
  return Boolean(task?.workflow_id && task?.current_stage_id);
}

function getStageDisplayName(stage) {
  return stage?.stage_name || stage?.name || stage?.id || "workflow stage";
}

function hasTaskProofUpdate(payload) {
  return ["proof_url", "proof_type", "proof_name", "proof_mime", "proof_size"]
    .some((field) => Object.prototype.hasOwnProperty.call(payload || {}, field));
}

function mergeTaskProofPayload(task, payload) {
  const nextProofUrls = Array.isArray(task?.proof_url) ? [...task.proof_url] : [];
  const incomingProofUrl = typeof payload?.proof_url === "string" ? payload.proof_url.trim() : "";

  if (incomingProofUrl) {
    nextProofUrls.push(incomingProofUrl);
  }

  return {
    ...task,
    proof_url: Object.prototype.hasOwnProperty.call(payload, "proof_url")
      ? nextProofUrls
      : (Array.isArray(task?.proof_url) ? task.proof_url : []),
    proof_type: Object.prototype.hasOwnProperty.call(payload, "proof_type")
      ? payload.proof_type || null
      : task.proof_type,
    proof_name: Object.prototype.hasOwnProperty.call(payload, "proof_name")
      ? payload.proof_name || null
      : task.proof_name,
    proof_mime: Object.prototype.hasOwnProperty.call(payload, "proof_mime")
      ? payload.proof_mime || null
      : task.proof_mime,
    proof_size: Object.prototype.hasOwnProperty.call(payload, "proof_size")
      ? payload.proof_size || null
      : task.proof_size,
  };
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload || {}, key);
}

function normalizeTaskType(taskType) {
  if (!taskType) {
    return null;
  }

  const normalized = String(taskType).trim().toLowerCase();
  if (Object.values(TASK_TYPES).includes(normalized)) {
    return normalized;
  }

  throw new AppError(400, `Unsupported task_type "${taskType}"`);
}

function normalizeTaskSource(source, fallback = TASK_SOURCES.ADMIN_MANUAL) {
  const normalized = String(source || fallback).trim().toLowerCase();
  if (Object.values(TASK_SOURCES).includes(normalized)) {
    return normalized;
  }

  throw new AppError(400, `Unsupported task source "${source}"`);
}

function normalizeTags(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return [...new Set(value.map((tag) => String(tag || "").trim()).filter(Boolean))];
  }

  return [...new Set(
    String(value)
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolveTaskTypeFromPayload(payload) {
  const normalizedTaskType = normalizeTaskType(payload.task_type);
  if (normalizedTaskType) {
    return normalizedTaskType;
  }

  if (payload.workflow_template_id || payload.project_id || payload.scope_id || payload.fixture_id || payload.current_stage_id) {
    return TASK_TYPES.DEPARTMENT_WORKFLOW;
  }

  if (payload.title) {
    return TASK_TYPES.CUSTOM;
  }

  return TASK_TYPES.CUSTOM;
}

function getTaskProofUrls(task) {
  if (Array.isArray(task?.proof_url)) {
    return task.proof_url.filter(Boolean);
  }

  if (typeof task?.proof_url === "string" && task.proof_url.trim()) {
    return [task.proof_url.trim()];
  }

  return [];
}

function taskHasProof(task) {
  return getTaskProofUrls(task).length > 0;
}

function isApprovalRequired(task) {
  return task?.approval_required !== false;
}

function isProofRequired(task) {
  return task?.proof_required === true;
}

function ensureTaskProofUpdateAllowed(user, task) {
  if (task.assigned_to !== user.employee_id) {
    throw new AppError(403, "Only assignee can upload proof");
  }

  if (task.status === TASK_STATUSES.CLOSED) {
    throw new AppError(409, "Proof cannot be modified for a completed task");
  }
}

function hasTaskDetailUpdate(payload) {
  return [
    "title",
    "description",
    "priority",
    "deadline",
    "department_id",
    "planned_minutes",
    "machine_id",
    "machine_name",
    "location_tag",
    "recurrence_rule",
    "dependency_ids",
    "requires_quality_approval",
    "approval_required",
    "proof_required",
    "tags",
    "assigned_to",
    "assignee_ids",
  ].some((field) => hasOwn(payload, field));
}

function hasExecutionUpdate(payload) {
  return hasOwn(payload, "action") || hasOwn(payload, "status");
}

function ensureTaskTransitionAllowed(currentStatus, nextStatus, { allowSameStatus = false } = {}) {
  if (allowSameStatus && currentStatus === nextStatus) {
    return;
  }

  if (!TASK_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
    throw new AppError(400, `Invalid status transition from "${currentStatus}" to "${nextStatus}"`);
  }
}

function hasVerificationUpdate(payload) {
  return hasOwn(payload, "verification_action") || hasOwn(payload, "verification_status");
}

function validateTaskUpdatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError(400, "Invalid payload");
  }

  if (Object.keys(payload).length === 0) {
    throw new AppError(400, "Empty payload is not allowed");
  }

  if (hasOwn(payload, "action") && hasOwn(payload, "status")) {
    throw new AppError(400, "Cannot send both action and status");
  }

  if (hasOwn(payload, "verification_action") && hasOwn(payload, "verification_status")) {
    throw new AppError(400, "Cannot send both verification_action and verification_status");
  }

  if (hasExecutionUpdate(payload) && hasVerificationUpdate(payload)) {
    throw new AppError(400, "Execution and verification updates must be sent separately");
  }
}

function normalizeVerificationStatus(payload) {
  if (payload.verification_action) {
    const action = String(payload.verification_action || "").trim().toLowerCase();

    if (action === "approve") {
      return VERIFICATION_STATUSES.APPROVED;
    }

    if (action === "reject") {
      return VERIFICATION_STATUSES.REJECTED;
    }

    throw new AppError(400, `Unsupported verification_action "${action}"`);
  }

  if (!hasOwn(payload, "verification_status")) {
    return null;
  }

  if (
    payload.verification_status !== VERIFICATION_STATUSES.APPROVED
    && payload.verification_status !== VERIFICATION_STATUSES.REJECTED
  ) {
    throw new AppError(400, "Only approved or rejected verification_status values are supported");
  }

  return payload.verification_status;
}

function mapLegacyPayloadToWorkflowAction(task, payload) {
  if (payload.action) {
    const action = String(payload.action || "").trim().toLowerCase();

    if (!["start", "resume", "hold", "submit"].includes(action)) {
      throw new AppError(400, `Unsupported action "${action}"`);
    }

    return action;
  }

  if (payload.status) {
    if (payload.status === TASK_STATUSES.IN_PROGRESS && task.status === TASK_STATUSES.ASSIGNED) {
      return "start";
    }

    if (payload.status === TASK_STATUSES.IN_PROGRESS && task.status === TASK_STATUSES.ON_HOLD) {
      return "resume";
    }

    if (payload.status === TASK_STATUSES.IN_PROGRESS && task.status === TASK_STATUSES.REWORK) {
      return "resume";
    }

    if (payload.status === TASK_STATUSES.ON_HOLD && task.status === TASK_STATUSES.IN_PROGRESS) {
      return "hold";
    }

    if (payload.status === TASK_STATUSES.UNDER_REVIEW && task.status === TASK_STATUSES.IN_PROGRESS) {
      return "submit";
    }
  }

  if (payload.verification_status === VERIFICATION_STATUSES.APPROVED) {
    return task.approval_stage === "quality" ? "approve_quality" : "approve";
  }

  if (payload.verification_status === VERIFICATION_STATUSES.REJECTED) {
    return task.approval_stage === "quality" ? "reject_quality" : "reject";
  }

  console.warn("⚠️ Invalid workflow mapping", {
    taskId: task.id,
    currentStatus: task.status,
    payload
  });

  return null;
}

function mapExecutionPayloadToStatus(task, payload) {
  const action = mapLegacyPayloadToWorkflowAction(task, payload);

  if (!action) {
    return null;
  }

  switch (action) {
    case "start":
    case "resume":
      return TASK_STATUSES.IN_PROGRESS;
    case "hold":
      return TASK_STATUSES.ON_HOLD;
    case "submit":
      return isApprovalRequired(task) ? TASK_STATUSES.UNDER_REVIEW : TASK_STATUSES.CLOSED;
    default:
      return null;
  }
}

async function applyWorkflowActionUpdate(user, task, actionName, remarks) {
  if (!isTaskAssignee(user, task)) {
    throw new AppError(403, "Only the assignee can update task status");
  }

  const action = String(actionName || "").trim();
  const eventTime = new Date();
  let nextStatus = task.status;
  let nextVerificationStatus = task.verification_status;
  let nextApprovalStage = task.approval_stage;
  let nextLifecycleStatus = task.lifecycle_status || TASK_STATUSES.ASSIGNED;
  let completedAt = task.completed_at;
  let closedAt = task.closed_at;
  let approvedAt = task.approved_at;
  let approvedBy = task.approved_by || null;

  switch (action) {
    case "start":
      if (task.status !== TASK_STATUSES.ASSIGNED) {
        throw new AppError(400, `Invalid action "${action}" for current task state "${task.status}"`);
      }
      await ensureDependenciesClosed(task);
      nextStatus = TASK_STATUSES.IN_PROGRESS;
      nextLifecycleStatus = TASK_STATUSES.IN_PROGRESS;
      nextVerificationStatus = VERIFICATION_STATUSES.PENDING;
      nextApprovalStage = "execution";
      break;
    case "resume":
      if (![TASK_STATUSES.ON_HOLD, TASK_STATUSES.REWORK].includes(task.status)) {
        throw new AppError(400, `Invalid action "${action}" for current task state "${task.status}"`);
      }
      await ensureDependenciesClosed(task);
      nextStatus = TASK_STATUSES.IN_PROGRESS;
      nextLifecycleStatus = TASK_STATUSES.IN_PROGRESS;
      nextVerificationStatus = VERIFICATION_STATUSES.PENDING;
      nextApprovalStage = "execution";
      break;
    case "hold":
      if (task.status !== TASK_STATUSES.IN_PROGRESS) {
        throw new AppError(400, `Invalid action "${action}" for current task state "${task.status}"`);
      }
      nextStatus = TASK_STATUSES.ON_HOLD;
      nextLifecycleStatus = TASK_STATUSES.IN_PROGRESS;
      nextApprovalStage = "execution";
      break;
    case "submit":
      if (task.status !== TASK_STATUSES.IN_PROGRESS) {
        throw new AppError(400, `Invalid action "${action}" for current task state "${task.status}"`);
      }
      if (isProofRequired(task) && !taskHasProof(task)) {
        throw new AppError(400, "Proof is required before completing the task");
      }
      nextStatus = isApprovalRequired(task) ? TASK_STATUSES.UNDER_REVIEW : TASK_STATUSES.CLOSED;
      nextLifecycleStatus = nextStatus === TASK_STATUSES.CLOSED ? "completed" : TASK_STATUSES.IN_PROGRESS;
      nextVerificationStatus = nextStatus === TASK_STATUSES.CLOSED
        ? VERIFICATION_STATUSES.APPROVED
        : VERIFICATION_STATUSES.PENDING;
      nextApprovalStage = nextStatus === TASK_STATUSES.CLOSED ? "closed" : "manager";
      completedAt = eventTime;
      closedAt = nextStatus === TASK_STATUSES.CLOSED ? eventTime : null;
      approvedAt = nextStatus === TASK_STATUSES.CLOSED ? eventTime : null;
      approvedBy = nextStatus === TASK_STATUSES.CLOSED ? user.employee_id : null;
      break;
    default:
      throw new AppError(400, `Unsupported workflow action "${action}"`);
  }

  ensureTaskTransitionAllowed(task.status, nextStatus);

  const startedAt = nextStatus === TASK_STATUSES.IN_PROGRESS && !task.started_at ? eventTime : task.started_at;
  const actualMinutes = completedAt && startedAt
    ? calculateActualMinutes({ ...task, started_at: startedAt, completed_at: completedAt }, completedAt)
    : task.actual_minutes || 0;

  await updateTaskStatus(task.id, {
    status: nextStatus,
    started_at: startedAt,
    completed_at: completedAt,
    verification_status: nextVerificationStatus,
    actual_minutes: actualMinutes,
    approval_stage: nextApprovalStage,
    closed_at: closedAt,
    current_stage_id: task.current_stage_id,
    lifecycle_status: nextLifecycleStatus,
    submitted_at: nextStatus === TASK_STATUSES.UNDER_REVIEW || nextStatus === TASK_STATUSES.CLOSED ? eventTime : task.submitted_at,
    approved_at: approvedAt,
    approved_by: approvedBy,
  });

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType: "status_changed",
    notes: remarks || null,
    metadata: {
      from: task.status,
      to: nextStatus,
      workflow_stage_id: task.current_stage_id,
      lifecycle_status: nextLifecycleStatus,
      workflow_action: action,
    },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_status_updated",
    targetType: "task",
    targetId: task.id,
    metadata: {
      from: task.status,
      to: nextStatus,
      workflow_stage_id: task.current_stage_id,
      lifecycle_status: nextLifecycleStatus,
      workflow_action: action,
    },
  });

  if (action === "submit") {
    await notifyDepartment(task.department_id, "Task ready for review", task.title, "approval", {
      targetType: "task",
      targetId: task.id,
    });
  }
}

async function resolveFixtureContextForTask({
  departmentId,
  projectId = null,
  scopeId = null,
  fixtureId = null,
  fixtureNo = null,
  projectNo = null,
  scopeName = null,
  quantityIndex = null,
  currentStageId,
}) {
  const normalizedProjectId = String(projectId || "").trim() || null;
  const normalizedScopeId = String(scopeId || "").trim() || null;
  const normalizedFixtureId = String(fixtureId || "").trim() || null;
  const normalizedFixtureNo = String(fixtureNo || quantityIndex || "").trim() || null;
  const normalizedProjectNo = String(projectNo || "").trim() || null;
  const normalizedScopeName = String(scopeName || "").trim() || null;

  if (normalizedFixtureId || (normalizedProjectId && normalizedScopeId && normalizedFixtureNo)) {
    const canonicalFixtureContext = await pool.query(
      `
        SELECT
          f.id AS fixture_id,
          f.project_id,
          f.scope_id,
          f.fixture_no,
          p.project_no,
          s.scope_name,
          COALESCE(NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id) AS stage_name
        FROM design.fixtures f
        JOIN design.scopes s ON s.id = f.scope_id
        JOIN design.projects p ON p.id = s.project_id
        LEFT JOIN workflow_stages ws ON ws.id = $5
        WHERE p.department_id = $1
          AND ($2::uuid IS NULL OR p.id = $2::uuid)
          AND ($3::uuid IS NULL OR s.id = $3::uuid)
          AND ($4::uuid IS NULL OR f.id = $4::uuid)
          AND ($6::text IS NULL OR f.fixture_no = $6)
        ORDER BY
          CASE WHEN $4::uuid IS NOT NULL AND f.id = $4::uuid THEN 0 ELSE 1 END,
          f.id ASC
        LIMIT 1
      `,
      [
        departmentId,
        normalizedProjectId,
        normalizedScopeId,
        normalizedFixtureId,
        currentStageId,
        normalizedFixtureNo,
      ],
    );

    if (canonicalFixtureContext.rows[0]) {
      return canonicalFixtureContext.rows[0];
    }
  }

  if (normalizedProjectNo && normalizedScopeName && normalizedFixtureNo) {
    const legacyFixtureContext = await pool.query(
      `
        SELECT
          f.id AS fixture_id,
          f.project_id,
          f.scope_id,
          f.fixture_no,
          p.project_no,
          s.scope_name,
          COALESCE(NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id) AS stage_name
        FROM design.fixtures f
        JOIN design.scopes s ON s.id = f.scope_id
        JOIN design.projects p ON p.id = s.project_id
        LEFT JOIN workflow_stages ws ON ws.id = $5
        WHERE p.department_id = $1
          AND p.project_no = $2
          AND s.scope_name = $3
          AND f.fixture_no = $4
        LIMIT 1
      `,
      [departmentId, normalizedProjectNo, normalizedScopeName, normalizedFixtureNo, currentStageId],
    );

    return legacyFixtureContext.rows[0] || null;
  }

  return null;
}

async function createTaskForUser(user, payload = {}) {
  const {
    title,
    description,
    assigned_to: assignedTo,
    assignee_ids: requestedAssigneeIds,
    priority,
    deadline,
    task_type: ignoredTaskType,
    department_id: requestedDepartmentId = null,
    workflow_template_id: workflowTemplateId = null,
    approval_required: requestedApprovalRequired,
    proof_required: requestedProofRequired,
    source: requestedSource = null,
    tags: requestedTags = [],
    machine_id: machineId = null,
    machine_name: machineName = null,
    location_tag: locationTag = null,
    recurrence_rule: recurrenceRule = null,
    dependency_ids: dependencyIds = [],
    project_id: projectId = null,
    scope_id: scopeId = null,
    fixture_id: payloadFixtureId = null,
    fixture_no: payloadFixtureNo = null,
    project_no: projectNo = null,
    project_name: projectName = null,
    customer_name: customerName = null,
    project_description: projectDescription = null,
    scope_name: scopeName = null,
    quantity_index: quantityIndex = null,
    instance_count: instanceCount = null,
    current_stage_id: currentStageId = null,
    rework_date: reworkDate = null,
  } = payload;

  const assigneeIds = [...new Set([assignedTo, ...(requestedAssigneeIds || [])].filter(Boolean))];
  const taskType = resolveTaskTypeFromPayload({ ...payload, task_type: ignoredTaskType });
  const normalizedTags = normalizeTags(requestedTags);
  const normalizedSource = normalizeTaskSource(
    requestedSource,
    taskType === TASK_TYPES.DEPARTMENT_WORKFLOW && (projectId || scopeId || payloadFixtureId || currentStageId)
      ? TASK_SOURCES.WORKFLOW_AUTO
      : TASK_SOURCES.ADMIN_MANUAL,
  );

  if (assigneeIds.length === 0) {
    throw new AppError(400, "Assignee is required");
  }

  const assignees = await Promise.all(assigneeIds.map((employeeId) => findUserByEmployeeId(employeeId)));

  if (assignees.some((assignee) => !assignee)) {
    throw new AppError(400, "Assigned user not found");
  }

  if (assignees.some((assignee) => !canAssignTo(user, assignee))) {
    throw new AppError(403, "Cannot assign to this user");
  }

  const primaryAssignee = assignees[0];
  const resolvedTaskStatus = TASK_STATUSES.ASSIGNED;
  const legacyWorkflowManaged = taskType === TASK_TYPES.DEPARTMENT_WORKFLOW
    && !workflowTemplateId
    && Boolean(projectId || scopeId || payloadFixtureId || currentStageId || projectNo || scopeName || quantityIndex);
  const resolvedDepartmentId = String(
    requestedDepartmentId
    || (taskType === TASK_TYPES.DEPARTMENT_WORKFLOW ? primaryAssignee.department_id || user.department_id || "" : requestedDepartmentId || ""),
  ).trim() || null;
  let workflowTemplate = null;
  let workflow = null;
  let resolvedCurrentStageId = null;

  if (taskType === TASK_TYPES.DEPARTMENT_WORKFLOW) {
    if (!resolvedDepartmentId) {
      throw new AppError(400, "department_id is required for department workflow tasks");
    }

    if (!workflowTemplateId && !legacyWorkflowManaged) {
      throw new AppError(400, "workflow_template_id is required for department workflow tasks");
    }

    if (primaryAssignee.department_id !== resolvedDepartmentId) {
      throw new AppError(400, "Department workflow tasks can only be assigned within the selected department");
    }

    if (workflowTemplateId) {
      workflowTemplate = await findWorkflowTemplateById(String(workflowTemplateId).trim());

      if (!workflowTemplate || workflowTemplate.is_active === false) {
        throw new AppError(404, "Workflow template not found");
      }

      if (workflowTemplate.department_id !== resolvedDepartmentId) {
        throw new AppError(400, "Workflow template does not belong to the selected department");
      }

      if (
        Array.isArray(workflowTemplate.eligible_role_ids)
        && workflowTemplate.eligible_role_ids.length > 0
        && !workflowTemplate.eligible_role_ids.includes(primaryAssignee.role_id)
      ) {
        throw new AppError(400, "Selected assignee is not eligible for this workflow template");
      }
    }

    if (legacyWorkflowManaged) {
      workflow = await resolveWorkflowForDepartment(resolvedDepartmentId);
      resolvedCurrentStageId = String(currentStageId || workflow.first_stage_id || "").trim();

      if (!resolvedCurrentStageId) {
        throw new AppError(409, "A valid workflow stage is required to create this task");
      }
    }
  }

  if (!Object.values(TASK_STATUSES).includes(resolvedTaskStatus)) {
    throw new AppError(500, `Invalid task status configuration: ${resolvedTaskStatus}`);
  }

  const resolvedPriority = priority || workflowTemplate?.default_priority || null;
  const resolvedDeadline = deadline
    ? new Date(deadline)
    : (
      workflowTemplate?.default_due_days !== null
      && workflowTemplate?.default_due_days !== undefined
      ? addDays(new Date(), Number(workflowTemplate.default_due_days))
      : null
    );

  if (!resolvedPriority || !resolvedDeadline || Number.isNaN(resolvedDeadline.getTime())) {
    throw new AppError(400, "Priority and deadline are required");
  }

  if (taskType === TASK_TYPES.CUSTOM) {
    if (!String(title || "").trim()) {
      throw new AppError(400, "title is required for custom tasks");
    }

    if (!String(description || "").trim()) {
      throw new AppError(400, "description is required for custom tasks");
    }
  }

  const resolvedApprovalRequired = taskType === TASK_TYPES.DEPARTMENT_WORKFLOW
    ? (requestedApprovalRequired ?? workflowTemplate?.default_approval_required ?? true)
    : requestedApprovalRequired === true;
  const resolvedProofRequired = taskType === TASK_TYPES.DEPARTMENT_WORKFLOW
    ? (requestedProofRequired ?? workflowTemplate?.default_proof_required ?? true)
    : requestedProofRequired === true;

  const fixtureContext = legacyWorkflowManaged
    ? await resolveFixtureContextForTask({
      departmentId: resolvedDepartmentId,
      projectId,
      scopeId,
      fixtureId: payloadFixtureId,
      fixtureNo: payloadFixtureNo,
      projectNo,
      scopeName,
      quantityIndex,
      currentStageId: resolvedCurrentStageId,
    })
    : null;

  const fixtureId = fixtureContext?.fixture_id || null;
  const resolvedProjectId = fixtureContext?.project_id || (projectId ? String(projectId).trim() : null);
  const resolvedScopeId = fixtureContext?.scope_id || (scopeId ? String(scopeId).trim() : null);
  const resolvedFixtureNo = fixtureContext?.fixture_no || payloadFixtureNo || quantityIndex || null;
  const resolvedProjectNo = fixtureContext?.project_no || projectNo;
  const resolvedScopeName = fixtureContext?.scope_name || scopeName;
  const stage = fixtureContext?.stage_name || null;

  if (fixtureId && stage) {
    const dupCheck = await pool.query(`
      SELECT 1 FROM tasks
      WHERE fixture_id = $1 AND LOWER(stage) = LOWER($2) AND status != 'cancelled'
      LIMIT 1
    `, [fixtureId, stage]);
    if (dupCheck.rows.length > 0) {
      throw new AppError(400, "Stage already assigned");
    }
  }

  const internalIdentifier = generateInternalTaskIdentifier({
    departmentId: resolvedDepartmentId || user.department_id || taskType,
    projectNo: resolvedProjectNo || workflowTemplate?.template_name || String(title || "").trim() || taskType,
    scopeName: resolvedScopeName || null,
    instanceCount,
  });
  const escalationSchedule = await getEscalationSchedule({
    departmentId: resolvedDepartmentId,
    priority: resolvedPriority,
    deadline: resolvedDeadline.toISOString(),
  });
  const resolvedTitle = taskType === TASK_TYPES.DEPARTMENT_WORKFLOW
    ? (workflowTemplate?.template_name || String(title || "").trim() || internalIdentifier)
    : String(title || "").trim();

  const taskId = await insertTask({
    title: resolvedTitle,
    internal_identifier: internalIdentifier,
    task_type: taskType,
    description: String(description || "").trim(),
    assigned_to: primaryAssignee.employee_id,
    assignee_ids: assigneeIds,
    assigned_by: user.employee_id,
    created_by: user.employee_id,
    department_id: resolvedDepartmentId,
    workflow_template_id: workflowTemplate?.id || null,
    status: resolvedTaskStatus,
    priority: resolvedPriority,
    deadline: resolvedDeadline.toISOString(),
    verification_status: VERIFICATION_STATUSES.PENDING,
    approval_required: resolvedApprovalRequired,
    proof_required: resolvedProofRequired,
    planned_minutes: Number(payload.planned_minutes) || 0,
    machine_id: machineId,
    machine_name: machineName,
    location_tag: locationTag,
    recurrence_rule: recurrenceRule,
    dependency_ids: dependencyIds,
    requires_quality_approval: payload.requires_quality_approval === true && resolvedApprovalRequired === true,
    source: normalizedSource,
    tags: normalizedTags,
    next_escalation_at: escalationSchedule.nextEscalationAt,
    last_escalated_at: null,
    approval_stage: "execution",
    workflow_id: workflow?.id || null,
    current_stage_id: resolvedCurrentStageId,
    lifecycle_status: resolvedTaskStatus,
    project_id: resolvedProjectId,
    scope_id: resolvedScopeId,
    fixture_id: fixtureId,
    fixture_no: resolvedFixtureNo,
    project_no: resolvedProjectNo,
    project_name: projectName,
    customer_name: customerName,
    project_description: projectDescription,
    scope_name: resolvedScopeName,
    quantity_index: quantityIndex,
    instance_count: instanceCount,
    rework_date: reworkDate,
    stage: stage,
  });

  await appendTaskActivity(taskId, {
    userEmployeeId: user.employee_id,
    actionType: "task_created",
    metadata: { assignee_ids: assigneeIds, internal_identifier: internalIdentifier },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_created",
    targetType: "task",
    targetId: taskId,
    metadata: {
      task_type: taskType,
      department_id: resolvedDepartmentId,
      workflow_template_id: workflowTemplate?.id || null,
      approval_required: resolvedApprovalRequired,
      proof_required: resolvedProofRequired,
      source: normalizedSource,
      tags: normalizedTags,
      internal_identifier: internalIdentifier,
      assignee_ids: assigneeIds,
    },
  });

  const task = await findTaskById(taskId);
  await notifyTaskAssignees(task, "New task assigned", task.internal_identifier, "task");
  await refreshTaskPerformanceAnalytics(task);
  return task;
}

function generateInternalTaskIdentifier({ departmentId, projectNo, scopeName, instanceCount }) {
  const prefix = [departmentId, projectNo, scopeName, instanceCount]
    .filter(Boolean)
    .map((part) => String(part).trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-");
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  return [prefix || "TASK", suffix].join("-");
}

async function resolveWorkflowForDepartment(departmentId) {
  if (!departmentId) {
    throw new AppError(409, "No active workflow is configured for this department");
  }

  const workflow = await ensureDepartmentWorkflow(departmentId, pool);
  if (!workflow?.id) {
    throw new AppError(409, "No active workflow is configured for this department");
  }

  if (!workflow.first_stage_id) {
    throw new AppError(409, "Department workflow has no stages configured");
  }

  return {
    ...workflow,
    first_stage_id: workflow.first_stage_id,
  };
}

async function getAssignableUsersForTaskContext(user, {
  taskType = TASK_TYPES.CUSTOM,
  departmentId = null,
  workflowTemplateId = null,
} = {}) {
  const allUsers = await listUsers();
  let candidates = allUsers.filter((candidate) => canAssignTo(user, candidate));

  if (taskType === TASK_TYPES.DEPARTMENT_WORKFLOW) {
    if (!departmentId) {
      throw new AppError(400, "department_id is required for workflow assignment");
    }

    candidates = candidates.filter((candidate) => candidate.department_id === departmentId);

    if (workflowTemplateId) {
      const template = await findWorkflowTemplateById(workflowTemplateId);
      if (!template || template.is_active === false) {
        throw new AppError(404, "Workflow template not found");
      }

      if (template.department_id !== departmentId) {
        throw new AppError(400, "Workflow template does not belong to the selected department");
      }

      if (Array.isArray(template.eligible_role_ids) && template.eligible_role_ids.length > 0) {
        candidates = candidates.filter((candidate) => template.eligible_role_ids.includes(candidate.role_id));
      }
    }
  }

  return candidates;
}

async function listAssignmentReferenceDataForUser(user) {
  const [departments, assignableUsers] = await Promise.all([
    listDepartments(),
    getAssignableUsersForTaskContext(user, { taskType: TASK_TYPES.CUSTOM }),
  ]);

  const visibleDepartmentIds = isAdmin(user)
    ? null
    : new Set(assignableUsers.map((candidate) => candidate.department_id).filter(Boolean));

  if (visibleDepartmentIds && user.department_id) {
    visibleDepartmentIds.add(user.department_id);
  }

  return {
    departments: visibleDepartmentIds
      ? departments.filter((department) => visibleDepartmentIds.has(department.id))
      : departments,
    assignable_users: assignableUsers,
  };
}

async function listWorkflowTemplatesForUser(user, departmentId) {
  const normalizedDepartmentId = String(departmentId || "").trim();
  if (!normalizedDepartmentId) {
    throw new AppError(400, "department_id is required");
  }

  const referenceData = await listAssignmentReferenceDataForUser(user);
  const hasDepartmentAccess = referenceData.departments.some((department) => department.id === normalizedDepartmentId);

  if (!hasDepartmentAccess) {
    throw new AppError(403, "You do not have access to this department");
  }

  return listWorkflowTemplates({
    departmentId: normalizedDepartmentId,
    isActive: true,
  });
}

async function resolveDepartmentAssignmentContextForUser(user, departmentId) {
  const normalizedDepartmentId = String(departmentId || "").trim();

  if (!normalizedDepartmentId) {
    throw new AppError(400, "department_id is required");
  }

  const referenceData = await listAssignmentReferenceDataForUser(user);
  const hasDepartmentAccess = referenceData.departments.some((department) => department.id === normalizedDepartmentId);

  if (!hasDepartmentAccess) {
    throw new AppError(403, "You do not have access to this department");
  }

  const projectCount = await countProjectsByDepartment(normalizedDepartmentId);
  const hasProjectCatalog = projectCount > 0;

  return {
    department_id: normalizedDepartmentId,
    flow_type: hasProjectCatalog ? "project_catalog" : "workflow_template",
    has_project_catalog: hasProjectCatalog,
    project_count: projectCount,
  };
}


async function updateTaskForUser(user, taskId, payload = {}) {
  validateTaskUpdatePayload(payload);

  if (Number.isNaN(Number(taskId))) {
    throw new AppError(400, "Invalid task ID");
  }

  const existingTask = await findTaskById(Number(taskId));

  if (!existingTask) {
    throw new AppError(404, "Task not found");
  }

  if (existingTask.status === TASK_STATUSES.CANCELLED) {
    throw new AppError(409, "Cancelled tasks cannot be updated");
  }

  if (!canAccessTask(user, existingTask)) {
    throw new AppError(403, "You do not have permission to access this task");
  }

  const verificationStatus = normalizeVerificationStatus(payload);
  const hasProofUpdate = hasTaskProofUpdate(payload);
  const hasDetailUpdate = hasTaskDetailUpdate(payload);
  const workflowAction = isWorkflowManagedTask(existingTask) && !verificationStatus && hasExecutionUpdate(payload)
    ? mapLegacyPayloadToWorkflowAction(existingTask, payload)
    : null;
  const taskForWorkflow = hasProofUpdate ? mergeTaskProofPayload(existingTask, payload) : existingTask;
  let handled = false;

  if (verificationStatus) {
    await applyTaskVerificationUpdate(user, existingTask, verificationStatus, payload.remarks);
    handled = true;
  }

  if (isWorkflowManagedTask(taskForWorkflow)) {
    if (hasProofUpdate) {
      await applyTaskProofUpdate(user, existingTask, payload);
      handled = true;
    }

    if (workflowAction) {
      await applyWorkflowActionUpdate(user, taskForWorkflow, workflowAction, payload.remarks);
      handled = true;
    } else if (hasExecutionUpdate(payload)) {
      throw new AppError(400, "Invalid action for current task state");
    }
  } else {
    if (hasProofUpdate) {
      await applyTaskProofUpdate(user, existingTask, payload);
      handled = true;
    }

    const nextStatus = hasExecutionUpdate(payload)
      ? mapExecutionPayloadToStatus(taskForWorkflow, payload)
      : null;

    if (nextStatus) {
      await applyTaskStatusUpdate(user, taskForWorkflow, nextStatus);
      handled = true;
    } else if (hasExecutionUpdate(payload)) {
      throw new AppError(400, "Invalid action for current task state");
    }
  }

  if (hasDetailUpdate) {
    await applyTaskDetailUpdate(user, existingTask, payload);
    handled = true;
  }

  if (!handled) {
    throw new AppError(400, "Empty or unsupported task update payload");
  }

  const updatedTask = await findTaskById(Number(taskId));
  await refreshTaskPerformanceAnalytics(updatedTask);
  return updatedTask;
}



async function transitionTaskForUser(user, taskId, nextStageId) {
  const normalizedTaskId = Number(taskId);

  if (Number.isNaN(normalizedTaskId)) {
    throw new AppError(400, "Invalid task ID");
  }

  const task = await findTaskById(normalizedTaskId);

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  if (task.status === TASK_STATUSES.CANCELLED) {
    throw new AppError(409, "Cancelled tasks cannot be transitioned");
  }

  if (!nextStageId || !String(nextStageId).trim()) {
    throw new AppError(400, "next_stage_id is required");
  }

  if (!task.workflow_id || !task.current_stage_id) {
    throw new AppError(400, "Task is not linked to a workflow");
  }

  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to update this task");
  }

  const workflow = await getWorkflow(task.workflow_id);

  if (!workflow) {
    throw new AppError(400, "Workflow not found or inactive");
  }

  if (!canVerifyTask(user, task)) {
    throw new AppError(403, "You do not have permission to transition this task");
  }

  const allowedNextStage = await getAdjacentWorkflowStage(task.workflow_id, task.current_stage_id, "next");
  const requestedStageId = String(nextStageId).trim();

  if (!allowedNextStage || allowedNextStage.id !== requestedStageId) {
    throw new AppError(400, "Invalid workflow transition");
  }

  const nextStage = allowedNextStage || await getStageById(requestedStageId);

  if (!nextStage) {
    throw new AppError(404, "Next stage not found");
  }

  const transitionTime = new Date();
  const nextStatus = nextStage.is_final ? TASK_STATUSES.CLOSED : TASK_STATUSES.ASSIGNED;

  if (nextStatus === TASK_STATUSES.CLOSED && isProofRequired(task) && !taskHasProof(task)) {
    throw new AppError(400, "Proof is required before completing the task");
  }
  const nextApprovalStage = nextStage.is_final ? "closed" : "execution";
  const shouldStartClock = nextStage.is_final;
  const startedAt = shouldStartClock && !task.started_at ? transitionTime : task.started_at;
  const completedAt = nextStatus === TASK_STATUSES.CLOSED ? transitionTime : task.completed_at;
  const closedAt = nextStatus === TASK_STATUSES.CLOSED ? transitionTime : null;
  const nextVerificationStatus = nextStatus === TASK_STATUSES.CLOSED
    ? VERIFICATION_STATUSES.APPROVED
    : VERIFICATION_STATUSES.PENDING;
  const actualMinutes = nextStage.is_final
    ? calculateActualMinutes({ ...task, started_at: startedAt, completed_at: completedAt }, completedAt)
    : task.actual_minutes || 0;

  await updateTaskStatus(task.id, {
    status: nextStatus,
    started_at: startedAt,
    completed_at: completedAt,
    verification_status: nextVerificationStatus,
    actual_minutes: actualMinutes,
    approval_stage: nextApprovalStage,
    closed_at: closedAt,
    current_stage_id: nextStage.id,
    lifecycle_status: nextStage.is_final ? "completed" : TASK_STATUSES.ASSIGNED,
    approved_at: nextStage.is_final ? transitionTime : null,
    approved_by: nextStage.is_final ? user.employee_id : null,
  });

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType: "workflow_transitioned",
    metadata: {
      workflow_id: task.workflow_id,
      from_stage_id: task.current_stage_id,
      to_stage_id: nextStage.id,
    },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_workflow_transitioned",
    targetType: "task",
    targetId: task.id,
    metadata: {
      workflow_id: task.workflow_id,
      from_stage_id: task.current_stage_id,
      to_stage_id: nextStage.id,
    },
  });

  const transitionedTask = await findTaskById(task.id);
  await refreshTaskPerformanceAnalytics(transitionedTask);
  return transitionedTask;
}

async function listTaskActivityForUser(user, taskId) {
  const task = await findTaskById(Number(taskId));

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to view this task");
  }

  return listTaskActivity(task.id);
}

async function cancelTaskForUser(user, taskId, reason) {
  const normalizedTaskId = Number(taskId);

  if (Number.isNaN(normalizedTaskId)) {
    throw new AppError(400, "Invalid task ID");
  }

  const task = await findTaskById(normalizedTaskId);

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to cancel this task");
  }

  if (task.status === TASK_STATUSES.CLOSED) {
    throw new AppError(409, "Closed tasks cannot be cancelled");
  }

  const cancelledTaskId = await cancelTask(task.id, {
    cancelledBy: user.employee_id,
    reason: typeof reason === "string" ? reason.trim() || null : null,
  });

  if (!cancelledTaskId) {
    throw new AppError(409, "Task is already cancelled");
  }

  if (task.fixture_id && task.department_id) {
    await releaseFixtureStageAssignment(task.fixture_id, task.department_id);
  }

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_cancelled",
    targetType: "task",
    targetId: task.id,
    metadata: {
      reason: typeof reason === "string" ? reason.trim() || null : null,
      previous_status: task.status,
      previous_stage_id: task.current_stage_id,
    },
  });

  const cancelledTask = await findTaskById(task.id);
  await refreshTaskPerformanceAnalytics(cancelledTask || task);
  return cancelledTask;
}

async function applyTaskStatusUpdate(user, task, nextStatus) {
  if (!isTaskAssignee(user, task)) {
    throw new AppError(403, "Only the assignee can update task status");
  }

  ensureTaskTransitionAllowed(task.status, nextStatus);

  if (nextStatus === TASK_STATUSES.IN_PROGRESS) {
    await ensureDependenciesClosed(task);
  }

  if ((nextStatus === TASK_STATUSES.UNDER_REVIEW || nextStatus === TASK_STATUSES.CLOSED) && isProofRequired(task) && !taskHasProof(task)) {
    throw new AppError(400, "Proof is required before completing the task");
  }

  const startedAt = nextStatus === TASK_STATUSES.IN_PROGRESS && !task.started_at ? new Date() : task.started_at;
  const completionEventTime = nextStatus === TASK_STATUSES.UNDER_REVIEW || nextStatus === TASK_STATUSES.CLOSED
    ? new Date()
    : task.completed_at;
  const actualMinutes = completionEventTime && startedAt
    ? Math.max(1, Math.round((new Date(completionEventTime).getTime() - new Date(startedAt).getTime()) / 60000))
    : task.actual_minutes || 0;
  const verificationStatus = nextStatus === TASK_STATUSES.UNDER_REVIEW
    ? VERIFICATION_STATUSES.PENDING
    : nextStatus === TASK_STATUSES.CLOSED
      ? VERIFICATION_STATUSES.APPROVED
      : task.verification_status;
  const approvalStage = nextStatus === TASK_STATUSES.UNDER_REVIEW
    ? "manager"
    : nextStatus === TASK_STATUSES.CLOSED
      ? "closed"
      : "execution";

  await updateTaskStatus(task.id, {
    status: nextStatus,
    started_at: startedAt,
    completed_at: completionEventTime,
    verification_status: verificationStatus,
    actual_minutes: actualMinutes,
    approval_stage: approvalStage,
    closed_at: nextStatus === TASK_STATUSES.CLOSED ? completionEventTime : task.closed_at || null,
    submitted_at: nextStatus === TASK_STATUSES.UNDER_REVIEW || nextStatus === TASK_STATUSES.CLOSED ? completionEventTime : task.submitted_at,
    approved_at: nextStatus === TASK_STATUSES.CLOSED ? completionEventTime : task.approved_at,
    approved_by: nextStatus === TASK_STATUSES.CLOSED ? user.employee_id : task.approved_by,
  });

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType: "status_changed",
    metadata: { from: task.status, to: nextStatus },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_status_updated",
    targetType: "task",
    targetId: task.id,
    metadata: {
      from: task.status,
      to: nextStatus,
    },
  });

  if (nextStatus === TASK_STATUSES.UNDER_REVIEW) {
    await notifyDepartment(task.department_id, "Task ready for review", task.title, "approval", {
      targetType: "task",
      targetId: task.id,
    });
  }
}

async function applyTaskVerificationUpdate(user, task, verificationStatus, remarks) {
  if (!canVerifyTask(user, task)) {
    throw new AppError(403, "You do not have permission to verify this task");
  }

  if (task.assigned_to === user.employee_id) {
    throw new AppError(403, "You cannot approve your own task");
  }

  if (task.status !== TASK_STATUSES.UNDER_REVIEW) {
    throw new AppError(400, "Only tasks under review can be reviewed");
  }

  if (verificationStatus === VERIFICATION_STATUSES.REJECTED && !String(remarks || "").trim()) {
    throw new AppError(400, "Remarks are required when rejecting a task");
  }

  const next = getVerificationOutcome(user, task, verificationStatus);
  const closedAt = next.status === TASK_STATUSES.CLOSED ? new Date() : null;
  const completionMetrics = next.status === TASK_STATUSES.CLOSED
    ? await buildTaskCompletionMetrics(task, closedAt)
    : {};

  ensureTaskTransitionAllowed(task.status, next.status, { allowSameStatus: true });

  await updateTaskVerification(task.id, {
    verification_status: next.verificationStatus,
    remarks: remarks || null,
    verified_at: closedAt,
    status: next.status,
    approval_stage: next.approvalStage,
    closed_at: closedAt,
    actual_minutes: completionMetrics.actual_minutes,
    kpi_target: completionMetrics.kpi_target,
    kpi_status: completionMetrics.kpi_status,
    approved_at: next.status === TASK_STATUSES.CLOSED ? closedAt : null,
    approved_by: next.status === TASK_STATUSES.CLOSED ? user.employee_id : null,
    submitted_at: task.submitted_at || task.completed_at || closedAt || new Date(),
    rejection_count_increment: next.status === TASK_STATUSES.REWORK ? 1 : 0,
  });

  // ── WORKFLOW ADVANCEMENT ──────────────────────────────────────────────────────
  // Only triggers when the task is fully approved (CLOSED) and linked to a fixture.
  // advanceWorkflowAfterTaskApproval is the SINGLE source of truth for progression.
  // It resolves the fixture_id from composite identity if task.fixture_id is absent.
  if (next.status === TASK_STATUSES.CLOSED) {
    try {
      console.log("[task-approval] Triggering workflow advancement", {
        task_id: task.id,
        fixture_id: task.fixture_id,
        project_id: task.project_id,
        scope_id: task.scope_id,
        fixture_no: task.fixture_no,
        department_id: task.department_id,
      });

      await advanceWorkflowAfterTaskApproval({
        project_id: task.project_id,
        scope_id: task.scope_id,
        fixture_no: task.fixture_no,
        department_id: task.department_id,
        fixture_id: task.fixture_id,
      });

      console.log("[task-approval] Workflow advancement completed", {
        task_id: task.id,
      });
    } catch (err) {
      // Task is already closed/approved — log but don't surface to caller
      console.error("[task-approval] Failed to advance workflow", {
        task_id: task.id,
        fixture_id: task.fixture_id,
        error: err.message,
      });
    }
  }

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType: next.activityType,
    notes: remarks || null,
    metadata: { verification_status: next.verificationStatus },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: next.activityType,
    targetType: "task",
    targetId: task.id,
    metadata: {
      verification_status: verificationStatus,
      remarks: remarks || null,
    },
  });

  await notifyTaskAssignees(
    task,
    next.status === TASK_STATUSES.CLOSED ? "Task approved" : next.status === TASK_STATUSES.REWORK ? "Task returned for rework" : "Task moved to quality review",
    remarks || task.title,
    next.status === TASK_STATUSES.REWORK ? "warning" : "approval",
  );
}

function getVerificationOutcome(user, task, requestedStatus) {
  if (requestedStatus === VERIFICATION_STATUSES.REJECTED) {
    return {
      status: TASK_STATUSES.REWORK,
      verificationStatus: VERIFICATION_STATUSES.REJECTED,
      approvalStage: "rework",
      activityType: "task_rejected",
    };
  }

  if (
    task.requires_quality_approval &&
    task.approval_stage !== "quality"
  ) {
    return {
      status: TASK_STATUSES.UNDER_REVIEW,
      verificationStatus: VERIFICATION_STATUSES.QUALITY_PENDING,
      approvalStage: "quality",
      activityType: "task_manager_approved",
    };
  }

  return {
    status: TASK_STATUSES.CLOSED,
    verificationStatus: VERIFICATION_STATUSES.APPROVED,
    approvalStage: "closed",
    activityType: task.approval_stage === "quality" ? "task_quality_approved" : "task_approved",
  };
}

async function buildTaskCompletionMetrics(task, closedAt) {
  const actualMinutes = calculateActualMinutes(task, closedAt);
  return {
    actual_minutes: actualMinutes,
    kpi_target: null,
    kpi_status: null,
  };
}

function calculateActualMinutes(task, closedAt) {
  if (!task.started_at) {
    return task.actual_minutes || 0;
  }

  const endTime = task.completed_at || closedAt;

  if (!endTime) {
    return task.actual_minutes || 0;
  }

  return Math.max(1, Math.round((new Date(endTime).getTime() - new Date(task.started_at).getTime()) / 60000));
}

async function ensureDependenciesClosed(task) {
  const dependencyIds = task.dependency_ids || [];

  if (dependencyIds.length === 0) {
    return;
  }

  const dependencies = await Promise.all(dependencyIds.map((dependencyId) => findTaskById(Number(dependencyId))));
  const openDependency = dependencies.find((dependency) => dependency && dependency.status !== TASK_STATUSES.CLOSED);

  if (openDependency) {
    throw new AppError(400, `Dependency task ${openDependency.id} must be closed first`);
  }
}

async function applyTaskProofUpdate(user, task, payload) {
  ensureTaskProofUpdateAllowed(user, task);

  const proofPayload = {};
  const nextProofUrls = getTaskProofUrls(task);

  if (Object.prototype.hasOwnProperty.call(payload, "proof_url")) {
    const normalizedProofUrl = typeof payload.proof_url === "string" ? payload.proof_url.trim() : "";

    if (normalizedProofUrl) {
      proofPayload.proof_url = normalizedProofUrl;
      nextProofUrls.push(normalizedProofUrl);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "proof_type")) {
    proofPayload.proof_type = payload.proof_type || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "proof_name")) {
    proofPayload.proof_name = payload.proof_name || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "proof_mime")) {
    proofPayload.proof_mime = payload.proof_mime || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "proof_size")) {
    proofPayload.proof_size = payload.proof_size || null;
  }

  if (Object.keys(proofPayload).length === 0) {
    return;
  }

  await updateTaskProof(task.id, proofPayload);

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType: "proof_updated",
    metadata: {
      proof_url: nextProofUrls,
      proof_type: proofPayload.proof_type ?? task.proof_type ?? null,
    },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_proof_updated",
    targetType: "task",
    targetId: task.id,
    metadata: {
      proof_url: nextProofUrls,
      proof_type: proofPayload.proof_type ?? task.proof_type ?? null,
    },
  });
}

async function applyTaskDetailUpdate(user, task, payload) {
  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to edit this task");
  }

  const normalizedPayload = { ...payload };
  const hasReassignment = hasOwn(payload, "assigned_to") || hasOwn(payload, "assignee_ids");
  const hasDepartmentUpdate = hasOwn(payload, "department_id");

  if (hasOwn(payload, "title") && task.task_type !== TASK_TYPES.CUSTOM) {
    throw new AppError(400, "Workflow task titles are controlled by the workflow template");
  }

  if (hasOwn(payload, "title")) {
    const normalizedTitle = String(payload.title || "").trim();

    if (!normalizedTitle) {
      throw new AppError(400, "title cannot be empty");
    }

    normalizedPayload.title = normalizedTitle;
  }

  if (hasDepartmentUpdate && task.task_type !== TASK_TYPES.CUSTOM) {
    throw new AppError(400, "Department workflow tasks cannot be moved between departments");
  }

  if (hasOwn(payload, "tags")) {
    normalizedPayload.tags = normalizeTags(payload.tags);
  }

  if (hasDepartmentUpdate) {
    const normalizedDepartmentId = String(payload.department_id || "").trim();

    if (!normalizedDepartmentId) {
      normalizedPayload.department_id = null;
    } else {
      const departments = await listDepartments();
      const departmentExists = departments.some((department) => department.id === normalizedDepartmentId);

      if (!departmentExists) {
        throw new AppError(400, "Selected department does not exist");
      }

      normalizedPayload.department_id = normalizedDepartmentId;
    }
  }

  if (hasReassignment) {
    const requestedAssigneeIds = [...new Set([
      ...(Array.isArray(payload.assignee_ids) ? payload.assignee_ids : []),
      payload.assigned_to,
    ].filter(Boolean))];

    if (requestedAssigneeIds.length === 0) {
      throw new AppError(400, "assigned_to or assignee_ids is required for reassignment");
    }

    const assignees = await Promise.all(requestedAssigneeIds.map((employeeId) => findUserByEmployeeId(employeeId)));

    if (assignees.some((assignee) => !assignee)) {
      throw new AppError(400, "Assigned user not found");
    }

    if (assignees.some((assignee) => !canAssignTo(user, assignee))) {
      throw new AppError(403, "Cannot assign to this user");
    }

    if (task.task_type === TASK_TYPES.DEPARTMENT_WORKFLOW) {
      if (assignees.some((assignee) => assignee.department_id !== task.department_id)) {
        throw new AppError(400, "Department workflow tasks can only be reassigned within the task department");
      }

      if (task.workflow_template_id) {
        const template = await findWorkflowTemplateById(task.workflow_template_id);

        if (!template || template.is_active === false) {
          throw new AppError(409, "Workflow template is no longer active");
        }

        if (
          Array.isArray(template.eligible_role_ids)
          && template.eligible_role_ids.length > 0
          && assignees.some((assignee) => !template.eligible_role_ids.includes(assignee.role_id))
        ) {
          throw new AppError(400, "Selected assignee is not eligible for this workflow template");
        }
      }
    }

    normalizedPayload.assignee_ids = requestedAssigneeIds;
    normalizedPayload.assigned_to = assignees[0].employee_id;
    normalizedPayload.assigned_user_id = assignees[0].employee_id;
  }

  if (payload.deadline || payload.priority) {
    if (task.status === TASK_STATUSES.CLOSED) {
      normalizedPayload.next_escalation_at = null;
      normalizedPayload.last_escalated_at = task.last_escalated_at;
    } else {
      const escalationSchedule = await getEscalationSchedule({
        departmentId: task.department_id,
        priority: payload.priority || task.priority,
        deadline: payload.deadline || task.deadline,
      });

      normalizedPayload.next_escalation_at = escalationSchedule.nextEscalationAt;
      normalizedPayload.last_escalated_at = null;
    }

    normalizedPayload.has_next_escalation_at = true;
    normalizedPayload.has_last_escalated_at = true;
  }

  await updateTaskDetails(task.id, normalizedPayload);

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType: "task_updated",
    metadata: normalizedPayload,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_updated",
    targetType: "task",
    targetId: task.id,
    metadata: normalizedPayload,
  });

  if (hasReassignment) {
    const refreshedTask = await findTaskById(task.id);
    await notifyTaskAssignees(refreshedTask, "Task reassigned", refreshedTask.internal_identifier || refreshedTask.title, "task");
  }
}

module.exports = instrumentModuleExports("service.taskService", {
  cancelTaskForUser,
  createTaskForUser,
  ensureTaskProofUpdateAllowed,
  getAssignableUsersForTaskContext,
  listAssignmentReferenceDataForUser,
  listTaskActivityForUser,
  listTasksForUser,
  listVerificationTasksForUser,
  listWorkflowTemplatesForUser,
  resolveDepartmentAssignmentContextForUser,
  resolveWorkflowForDepartment,
  transitionTaskForUser,
  updateTaskForUser,
});
