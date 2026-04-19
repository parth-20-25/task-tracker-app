const { TASK_STATUSES, TASK_TRANSITIONS, VERIFICATION_STATUSES } = require("../config/constants");
const { pool } = require("../db");
const { getAdjacentWorkflowStage, getWorkflow, getStageById } = require("./workflowService");
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
  updateTaskDetails,
  updateTaskProof,
  updateTaskStatus,
  updateTaskVerification,
} = require("../repositories/tasksRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const { canAccessTask, canAssignTo, canVerifyTask, getTaskAccess, isTaskAssignee } = require("./accessControlService");
const { getEscalationSchedule } = require("./escalationService");
const { notifyDepartment, notifyTaskAssignees } = require("./notificationService");

async function listTasksForUser(user) {
  return listTasksByAccess(getTaskAccess(user));
}

function isWorkflowManagedTask(task) {
  return Boolean(task?.workflow_id && task?.current_stage_id);
}

function getStageDisplayName(stage) {
  return stage?.stage_name || stage?.name || stage?.id || "workflow stage";
}

function mapLegacyPayloadToWorkflowAction(task, payload) {
  if (payload.action) {
    return payload.action;
  }

  if (payload.status) {
    if (payload.status === TASK_STATUSES.IN_PROGRESS && task.status === TASK_STATUSES.ASSIGNED) {
      return "start";
    }

    if (payload.status === TASK_STATUSES.IN_PROGRESS && task.status === TASK_STATUSES.ON_HOLD) {
      return "resume";
    }

    if (payload.status === TASK_STATUSES.IN_PROGRESS && task.status === TASK_STATUSES.REWORK) {
      return "resume_rework";
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

  return null;
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

  switch (action) {
    case "start":
    case "resume":
    case "resume_rework":
      await ensureDependenciesClosed(task);
      nextStatus = TASK_STATUSES.IN_PROGRESS;
      nextLifecycleStatus = TASK_STATUSES.IN_PROGRESS;
      nextVerificationStatus = VERIFICATION_STATUSES.PENDING;
      nextApprovalStage = "execution";
      break;
    case "hold":
      nextStatus = TASK_STATUSES.ON_HOLD;
      nextLifecycleStatus = TASK_STATUSES.IN_PROGRESS;
      nextApprovalStage = "execution";
      break;
    case "submit":
      nextStatus = TASK_STATUSES.UNDER_REVIEW;
      nextLifecycleStatus = TASK_STATUSES.IN_PROGRESS;
      nextVerificationStatus = VERIFICATION_STATUSES.PENDING;
      nextApprovalStage = "manager";
      completedAt = eventTime;
      break;
    default:
      throw new AppError(400, `Unsupported workflow action "${action}"`);
  }

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
    closed_at: null,
    current_stage_id: task.current_stage_id,
    lifecycle_status: nextLifecycleStatus,
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

async function createTaskForUser(user, payload) {
  const {
    description,
    assigned_to: assignedTo,
    assignee_ids: requestedAssigneeIds,
    priority,
    deadline,
    machine_id: machineId = null,
    machine_name: machineName = null,
    location_tag: locationTag = null,
    recurrence_rule: recurrenceRule = null,
    dependency_ids: dependencyIds = [],
    project_no: projectNo = null,
    project_name: projectName = null,
    customer_name: customerName = null,
    project_description: projectDescription = null,
    scope_name: scopeName = null,
    quantity_index: quantityIndex = null,
    instance_count: instanceCount = null,
    rework_date: reworkDate = null,
  } = payload;

  const assigneeIds = [...new Set([assignedTo, ...(requestedAssigneeIds || [])].filter(Boolean))];

  if (
    Object.prototype.hasOwnProperty.call(payload, "title")
  ) {
    throw new AppError(400, "Task title is generated automatically and cannot be provided");
  }

  if (assigneeIds.length === 0 || !priority || !deadline) {
    throw new AppError(400, "Assignee, priority, and deadline are required");
  }

  if (!user.department_id) {
    throw new AppError(403, "A department is required to create tasks");
  }

  const assignees = await Promise.all(assigneeIds.map((employeeId) => findUserByEmployeeId(employeeId)));

  if (assignees.some((assignee) => !assignee)) {
    throw new AppError(400, "Assigned user not found");
  }

  if (assignees.some((assignee) => !canAssignTo(user, assignee))) {
    throw new AppError(403, "Cannot assign to this user");
  }

  const primaryAssignee = assignees[0];
  const workflow = await resolveWorkflowForDepartment(user.department_id);
  const internalIdentifier = generateInternalTaskIdentifier({
    departmentId: user.department_id,
    projectNo,
    scopeName,
    instanceCount,
  });
  const escalationSchedule = await getEscalationSchedule({
    departmentId: user.department_id,
    priority,
    deadline,
  });

  const taskId = await insertTask({
    internal_identifier: internalIdentifier,
    description: description || "",
    assigned_to: primaryAssignee.employee_id,
    assignee_ids: assigneeIds,
    assigned_by: user.employee_id,
    department_id: user.department_id,
    status: TASK_STATUSES.ASSIGNED, // Keep for backward compatibility
    priority,
    deadline,
    verification_status: VERIFICATION_STATUSES.PENDING, // Keep for backward compatibility
    planned_minutes: Number(payload.planned_minutes) || 0,
    machine_id: machineId,
    machine_name: machineName,
    location_tag: locationTag,
    recurrence_rule: recurrenceRule,
    dependency_ids: dependencyIds,
    requires_quality_approval: false,
    next_escalation_at: escalationSchedule.nextEscalationAt,
    last_escalated_at: null,
    approval_stage: "execution", // Keep for backward compatibility
    workflow_id: workflow.id,
    current_stage_id: workflow.first_stage_id,
    lifecycle_status: TASK_STATUSES.ASSIGNED,
    project_no: projectNo,
    project_name: projectName,
    customer_name: customerName,
    project_description: projectDescription,
    scope_name: scopeName,
    quantity_index: quantityIndex,
    instance_count: instanceCount,
    rework_date: reworkDate,
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
      internal_identifier: internalIdentifier,
      assignee_ids: assigneeIds,
    },
  });

  const task = await findTaskById(taskId);
  await notifyTaskAssignees(task, "New task assigned", task.internal_identifier, "task");
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

  const workflowResult = await pool.query(
    `
      SELECT *
      FROM workflows
      WHERE department_id = $1
        AND is_active = TRUE
      LIMIT 1
    `,
    [departmentId],
  );

  const workflow = workflowResult.rows[0] || null;
  if (!workflow) {
    throw new AppError(409, "No active workflow is configured for this department");
  }

  const stageResult = await pool.query(
    `
      SELECT id
      FROM workflow_stages
      WHERE workflow_id = $1
        AND is_active = TRUE
      ORDER BY sequence_order ASC, created_at ASC
      LIMIT 1
    `,
    [workflow.id],
  );

  const firstStage = stageResult.rows[0] || null;
  if (!firstStage) {
    throw new AppError(409, "Department workflow has no stages configured");
  }

  return {
    ...workflow,
    first_stage_id: firstStage.id,
  };
}

async function updateTaskForUser(user, taskId, payload) {
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

  if (
    Object.prototype.hasOwnProperty.call(payload, "title")
  ) {
    throw new AppError(400, "Task title is generated automatically and cannot be provided");
  }

  if (payload.verification_status && isWorkflowManagedTask(existingTask)) {
    await applyWorkflowReviewDecision(user, existingTask, payload.verification_status, payload.remarks);
  }

  const workflowAction = isWorkflowManagedTask(existingTask)
    && !payload.verification_status
    ? mapLegacyPayloadToWorkflowAction(existingTask, payload)
    : null;

  if (workflowAction) {
    await applyWorkflowActionUpdate(user, existingTask, workflowAction, payload.remarks);
  } else {
    if (payload.status) {
      await applyTaskStatusUpdate(user, existingTask, payload.status);
    }
    if (payload.verification_status && !isWorkflowManagedTask(existingTask)) {
      await applyTaskVerificationUpdate(user, existingTask, payload.verification_status, payload.remarks);
    }
  }

  if (payload.proof_url || payload.proof_type) {
    await applyTaskProofUpdate(user, existingTask, payload);
  }

  if (
    payload.description ||
    payload.priority ||
    payload.deadline ||
    payload.planned_minutes !== undefined ||
    payload.machine_id ||
    payload.machine_name ||
    payload.location_tag ||
    payload.recurrence_rule ||
    payload.dependency_ids
  ) {
    await applyTaskDetailUpdate(user, existingTask, payload);
  }

  const updatedTask = await findTaskById(Number(taskId));
  return updatedTask;
}

async function applyWorkflowReviewDecision(user, task, verificationStatus, remarks) {
  if (!canVerifyTask(user, task)) {
    throw new AppError(403, "You do not have permission to verify this task");
  }

  if (![VERIFICATION_STATUSES.APPROVED, VERIFICATION_STATUSES.REJECTED].includes(verificationStatus)) {
    throw new AppError(400, "Only approve or reject decisions are supported");
  }

  if (verificationStatus === VERIFICATION_STATUSES.REJECTED && !String(remarks || "").trim()) {
    throw new AppError(400, "Remarks are required when rejecting a task");
  }

  if (task.status !== TASK_STATUSES.UNDER_REVIEW) {
    throw new AppError(409, "Only submitted tasks can be approved or rejected");
  }

  const isReject = verificationStatus === VERIFICATION_STATUSES.REJECTED;
  const eventTime = new Date();
  let nextStageId = task.current_stage_id;
  let nextStatus = TASK_STATUSES.REWORK;
  let nextLifecycleStatus = TASK_STATUSES.REWORK;
  let nextApprovalStage = "rework";
  let nextVerificationStatus = VERIFICATION_STATUSES.REJECTED;
  let closedAt = null;
  let verifiedAt = null;
  let actualMinutes = null;
  let kpiTarget = null;
  let kpiStatus = null;

  if (!isReject) {
    const nextStage = await getAdjacentWorkflowStage(task.workflow_id, task.current_stage_id, "next");

    if (nextStage) {
      nextStageId = nextStage.id;
      nextStatus = TASK_STATUSES.ASSIGNED;
      nextLifecycleStatus = TASK_STATUSES.ASSIGNED;
      nextApprovalStage = "execution";
      nextVerificationStatus = VERIFICATION_STATUSES.PENDING;
    } else {
      const completionMetrics = await buildTaskCompletionMetrics(task, eventTime);
      nextStatus = TASK_STATUSES.CLOSED;
      nextLifecycleStatus = "completed";
      nextApprovalStage = "closed";
      nextVerificationStatus = VERIFICATION_STATUSES.APPROVED;
      closedAt = eventTime;
      verifiedAt = eventTime;
      actualMinutes = completionMetrics.actual_minutes;
      kpiTarget = completionMetrics.kpi_target;
      kpiStatus = completionMetrics.kpi_status;
    }
  }

  await updateTaskVerification(task.id, {
    verification_status: nextVerificationStatus,
    remarks: remarks || null,
    verified_at: verifiedAt,
    status: nextStatus,
    approval_stage: nextApprovalStage,
    closed_at: closedAt,
    actual_minutes: actualMinutes,
    kpi_target: kpiTarget,
    kpi_status: kpiStatus,
    current_stage_id: nextStageId,
    lifecycle_status: nextLifecycleStatus,
  });

  if (isReject) {
    await addTaskLog(task.id, {
      updatedBy: user.employee_id,
      stepName: "rework_requested",
      status: TASK_STATUSES.REWORK,
      notes: remarks || null,
    });
  }

  const actionType = isReject ? "task_rework_requested" : "task_approved";

  await appendTaskActivity(task.id, {
    userEmployeeId: user.employee_id,
    actionType,
    notes: remarks || null,
    metadata: {
      workflow_id: task.workflow_id,
      from_stage_id: task.current_stage_id,
      to_stage_id: nextStageId,
      rework: isReject,
      lifecycle_status: nextLifecycleStatus,
    },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType,
    targetType: "task",
    targetId: task.id,
    metadata: {
      workflow_id: task.workflow_id,
      from_stage_id: task.current_stage_id,
      to_stage_id: nextStageId,
      remarks: remarks || null,
      rework: isReject,
      lifecycle_status: nextLifecycleStatus,
    },
  });

  await notifyTaskAssignees(
    task,
    isReject ? "Task returned for rework" : "Task approved",
    remarks || task.title,
    isReject ? "warning" : "approval",
  );
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

  return findTaskById(task.id);
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

  return findTaskById(task.id);
}

async function applyTaskStatusUpdate(user, task, nextStatus) {
  if (!isTaskAssignee(user, task)) {
    throw new AppError(403, "Only the assignee can update task status");
  }

  if (!TASK_TRANSITIONS[task.status]?.includes(nextStatus)) {
    throw new AppError(400, "Invalid status transition");
  }

  if (nextStatus === TASK_STATUSES.IN_PROGRESS) {
    await ensureDependenciesClosed(task);
  }

  const startedAt = nextStatus === TASK_STATUSES.IN_PROGRESS && !task.started_at ? new Date() : task.started_at;
  const completedAt = nextStatus === TASK_STATUSES.UNDER_REVIEW ? new Date() : task.completed_at;
  const actualMinutes = completedAt && startedAt
    ? Math.max(1, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000))
    : task.actual_minutes || 0;
  const verificationStatus = nextStatus === TASK_STATUSES.UNDER_REVIEW ? VERIFICATION_STATUSES.PENDING : task.verification_status;
  const approvalStage = nextStatus === TASK_STATUSES.UNDER_REVIEW ? "manager" : "execution";

  await updateTaskStatus(task.id, {
    status: nextStatus,
    started_at: startedAt,
    completed_at: completedAt,
    verification_status: verificationStatus,
    actual_minutes: actualMinutes,
    approval_stage: approvalStage,
    closed_at: task.closed_at || null,
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
  });

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
  if (!isTaskAssignee(user, task)) {
    throw new AppError(403, "Only the assignee can attach proof");
  }

  const proofPayload = {};

  if (Object.prototype.hasOwnProperty.call(payload, "proof_url")) {
    proofPayload.proof_url = payload.proof_url || null;
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
      proof_url: proofPayload.proof_url ?? task.proof_url ?? null,
      proof_type: proofPayload.proof_type ?? task.proof_type ?? null,
    },
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_proof_updated",
    targetType: "task",
    targetId: task.id,
    metadata: {
      proof_url: proofPayload.proof_url ?? task.proof_url ?? null,
      proof_type: proofPayload.proof_type ?? task.proof_type ?? null,
    },
  });
}

async function applyTaskDetailUpdate(user, task, payload) {
  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to edit this task");
  }

  const normalizedPayload = { ...payload };

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
}

module.exports = {
  cancelTaskForUser,
  createTaskForUser,
  listTaskActivityForUser,
  listTasksForUser,
  transitionTaskForUser,
  updateTaskForUser,
};
