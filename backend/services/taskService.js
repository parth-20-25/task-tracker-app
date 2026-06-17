const {
  TASK_SOURCES,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TASK_TYPES,
  PERMISSIONS,
  PROJECT_STATUSES,
  VERIFICATION_STATUSES,
} = require("../config/constants");
const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");
const { getAdjacentWorkflowStage, getWorkflow, getStageById } = require("./workflowService");
const {
  releaseFixtureStageAssignment,
  advanceWorkflowAfterTaskApproval,
  submitFixtureStageForVerification,
  WORKFLOW_STATUSES,
} = require("./fixtureWorkflowService");
const { AppError } = require("../lib/AppError");
const { isDesignDepartment } = require("../lib/designDepartment");
const { normalizeDesignStageName } = require("../lib/designWorkflowStages");
const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../lib/workflowStageVersioning");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  addTaskLog,
  appendTaskActivity,
  cancelTask,
  findTaskById,
  insertTask,
  listTaskActivity,
  listActiveProjectTasksByAccess,
  listVerificationTasksByAccess,
  updateTaskAssignmentForTransfer,
  updateTaskCompletionPercent,
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
const { countProjectsByDepartment, getProjectStatusById } = require("../repositories/designProjectCatalogRepository");
const {
  getLatestStageAttempt,
  getProgressForFixture,
  rejectStageAttempt,
  startStageAttempt,
  updateLatestStageAttemptAssignment,
  updateProgressRow,
} = require("../repositories/fixtureWorkflowRepository");
const {
  insertStageContribution,
  listStageContributions,
  supersedeContribution,
} = require("../repositories/designStageContributionRepository");
const {
  findWorkflowTemplateById,
  listWorkflowTemplates,
} = require("../repositories/workflowTemplatesRepository");
const {
  canAccessTask,
  canAccessUser,
  canAssignTo,
  canVerifyTask,
  getRoleLevel,
  getTaskAccess,
  hasPermission,
  isAdmin,
  isOperationalControllerRole,
  isProjectAuthorityRole,
  isSupervisor,
  isTaskAssignee,
} = require("./accessControlService");
const { getEscalationSchedule } = require("./escalationService");
const { refreshPerformanceAnalyticsForDepartment } = require("./performanceAnalyticsService");
const { ensureDepartmentWorkflow } = require("./workflowRecoveryService");
const {
  canCancelOperationalTask,
  shouldAutoStartTask,
  shouldSubmitForVerification,
} = require("./taskStateRules");
const {
  DESIGN_2D_SUBDIVISION_NAME,
  is2DLeaderUser,
  isProjectAssignedTo2DLeader,
  listAssigned2DLeaderTeamEmployeeIds,
  projectHasActive2DRouting,
} = require("../repositories/projectSubdivisionRoutingRepository");

async function listTasksForUser(user) {
  return listActiveProjectTasksByAccess(getTaskAccess(user));
}

async function listVerificationTasksForUser(user) {
  return listVerificationTasksByAccess(getTaskAccess(user), user.employee_id, pool, {
    excludeCurrentUser: !hasPermission(user, PERMISSIONS.SELF_APPROVE),
  });
}

async function getTaskForUser(user, taskId) {
  const normalizedTaskId = Number(taskId);

  if (!Number.isInteger(normalizedTaskId)) {
    throw new AppError(400, "Invalid task id");
  }

  const task = await findTaskById(normalizedTaskId);

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to view this task");
  }

  return task;
}

async function refreshTaskPerformanceAnalytics(taskOrDepartmentId) {
  const departmentId = typeof taskOrDepartmentId === "string"
    ? taskOrDepartmentId
    : taskOrDepartmentId?.department_id || null;

  try {
    await refreshPerformanceAnalyticsForDepartment(departmentId);
  } catch (error) {
    console.warn("[task] performance analytics refresh skipped", {
      department_id: departmentId,
      error: error?.message || "Unknown performance analytics error",
      code: error?.code || error?.errorCode || null,
      constraint: error?.constraint || null,
    });
  }
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

  if (payload.workflow_template_id || payload.project_id || payload.fixture_id || payload.current_stage_id) {
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

function isDapWorkflowTask(task) {
  return normalizeDesignStageName(task?.workflow_stage || task?.stage || task?.current_stage_name) === "dap";
}

function isWorkProofRequiredForTask(task) {
  return !isDapWorkflowTask(task);
}

function assertWorkProofUploaded(task) {
  if (!isWorkProofRequiredForTask(task)) {
    return;
  }

  if (!taskHasProof(task)) {
    throw new AppError(400, "Work proof image required before verification submission");
  }
}

function ensureTaskProofUpdateAllowed(user, task) {
  assertTaskProjectIsActive(task);

  if (!isTaskAssignee(user, task)) {
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

function hasCompletionPercentUpdate(payload) {
  return hasOwn(payload, "completion_percent");
}

function normalizeCompletionPercent(value) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    throw new AppError(400, "completion_percent must be an integer between 0 and 100");
  }

  if (numericValue < 0) {
    throw new AppError(400, "completion_percent cannot be below 0");
  }

  if (numericValue > 100) {
    throw new AppError(400, "completion_percent cannot be above 100");
  }

  return numericValue;
}

function roundContributionPercent(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function is2DStageName(stageName) {
  return normalizeDesignStageName(stageName) === "2d_finish";
}

function assertMultiAssigneeAllowedForStage(assigneeIds, stageName) {
  if (assigneeIds.length > 1 && !is2DStageName(stageName)) {
    throw new AppError(400, "Multiple assignees are only supported for 2D task assignments");
  }
}

function is2DSubdivisionAssignee(assignee) {
  return String(assignee?.subdivision?.subdivision_name || "").trim().toLowerCase()
    === DESIGN_2D_SUBDIVISION_NAME.toLowerCase();
}

async function assert2DRoutingTaskAssignmentAllowed({ actor, assignees, projectId, stageName, client = pool }) {
  if (!projectId || !is2DStageName(stageName)) {
    return;
  }

  if (!(await projectHasActive2DRouting(projectId, client))) {
    return;
  }

  if (is2DLeaderUser(actor)) {
    const assignedToProject = await isProjectAssignedTo2DLeader(projectId, actor.employee_id, client);
    if (!assignedToProject) {
      throw new AppError(403, "Only assigned 2D routing leaders can assign routed 2D-stage fixtures");
    }
  } else if (!isAdmin(actor) && !isProjectAuthorityRole(actor)) {
    throw new AppError(403, "Only assigned 2D routing leaders can assign routed 2D-stage fixtures");
  }

  const invalidAssignee = assignees.find((assignee) => !is2DSubdivisionAssignee(assignee));

  if (invalidAssignee) {
    throw new AppError(400, "Routed 2D-stage fixtures can only be assigned to Design 2D subdivision users");
  }

  const routedTeamEmployeeIds = new Set(await listAssigned2DLeaderTeamEmployeeIds(projectId, client));
  const outsideAssignedLeaderTeam = assignees.find((assignee) => !routedTeamEmployeeIds.has(assignee.employee_id));
  if (outsideAssignedLeaderTeam) {
    throw new AppError(403, "Routed 2D-stage fixtures can only be assigned to the assigned 2D leader team");
  }
}

function sumContributionPercent(contributions) {
  return roundContributionPercent(
    contributions.reduce((sum, contribution) => sum + Number(contribution.contribution_percent || 0), 0),
  );
}

async function requireDesignTask(task) {
  const departments = await listDepartments();
  const department = departments.find((item) => item.id === task.department_id) || null;

  if (!isDesignDepartment({ id: task.department_id, name: department?.name })) {
    throw new AppError(403, "Transfer task is available only for Design Department workflow tasks");
  }
}

function canTransferDesignTask(actor, task) {
  if (!actor || !task) {
    return false;
  }

  if (!canAccessTask(actor, task)) {
    return false;
  }

  return hasPermission(actor, PERMISSIONS.TRANSFER_TASK)
    || isSupervisor(actor)
    || isProjectAuthorityRole(actor)
    || isAdmin(actor);
}

function canCancelTask(actor, task) {
  if (!actor || !task || !canAccessTask(actor, task)) {
    return false;
  }

  if (isAdmin(actor) || isProjectAuthorityRole(actor) || isOperationalControllerRole(actor)) {
    return true;
  }

  return Boolean(actor.employee_id && actor.employee_id === task.assigned_by);
}

function isTaskApprovedOrWorkflowComplete(task) {
  return task?.status === TASK_STATUSES.CLOSED
    || task?.verification_status === VERIFICATION_STATUSES.APPROVED
    || Boolean(task?.approved_at)
    || task?.operational_state === "WORKFLOW_COMPLETE";
}

function resolveProgressRowForTask(task, progressRows) {
  const taskStageKey = normalizeDesignStageName(task.workflow_stage || task.stage || task.current_stage_name);

  if (taskStageKey) {
    const matchingByStage = progressRows.find(
      (row) => normalizeDesignStageName(row.stage_name) === taskStageKey && row.status !== "APPROVED",
    );
    if (matchingByStage) {
      return matchingByStage;
    }
  }

  const matchingAssignee = progressRows.find(
    (row) => row.status === "IN_PROGRESS" && row.assigned_to === task.assigned_to,
  );
  if (matchingAssignee) {
    return matchingAssignee;
  }

  return progressRows.find((row) => row.status !== "APPROVED") || null;
}

function isCanonicalReviewTask(task) {
  return task?.status === TASK_STATUSES.UNDER_REVIEW
    && task?.verification_status === VERIFICATION_STATUSES.PENDING;
}

function normalizeTransferTarget(payload) {
  const transferTo = String(
    payload?.transfer_to
    || payload?.assigned_to
    || payload?.employee_id
    || "",
  ).trim();

  if (!transferTo) {
    throw new AppError(400, "transfer_to is required");
  }

  return transferTo;
}

function normalizeTransferReason(payload) {
  const transferReason = String(payload?.transfer_reason || payload?.reason || "").trim();

  if (!transferReason) {
    throw new AppError(400, "transfer_reason is required");
  }

  return transferReason;
}

function normalizeTransferCompletion(payload, task) {
  const completionCandidate = hasOwn(payload, "completion_percent")
    ? payload.completion_percent
    : task.completion_percent ?? 0;

  return normalizeCompletionPercent(completionCandidate);
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

  if (hasCompletionPercentUpdate(payload) && (hasExecutionUpdate(payload) || hasVerificationUpdate(payload))) {
    throw new AppError(400, "Completion percent updates must be sent separately");
  }

  if (hasCompletionPercentUpdate(payload)) {
    normalizeCompletionPercent(payload.completion_percent);
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
      assertWorkProofUploaded(task);
      await submitFixtureStageForVerification({ task, actor: user });
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

  if (isWorkflowManagedTask(task) && [TASK_STATUSES.ASSIGNED, TASK_STATUSES.REWORK].includes(task.status) && nextStatus === TASK_STATUSES.IN_PROGRESS) {
    const progressRows = await getProgressForFixture(task.fixture_id, task.department_id);
    const progressRow = resolveProgressRowForTask(task, progressRows);
    if (progressRow && [WORKFLOW_STATUSES.PENDING, WORKFLOW_STATUSES.REJECTED, WORKFLOW_STATUSES.IN_PROGRESS].includes(progressRow.status)) {
      await updateProgressRow(task.fixture_id, progressRow.stage_name, {
        status: WORKFLOW_STATUSES.IN_PROGRESS,
        assigned_to: task.assigned_to,
        assigned_at: progressRow.assigned_at || task.assigned_at || eventTime,
        started_at: progressRow.started_at || startedAt || eventTime,
        completed_at: null,
        duration_minutes: null,
      });
      await startStageAttempt(
        task.fixture_id,
        task.department_id,
        progressRow.stage_name,
        task.assigned_to,
        progressRow.started_at || startedAt || eventTime,
      );
    }
  }

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

}

async function resolveFixtureContextForTask({
  departmentId,
  projectId = null,
  fixtureId = null,
  fixtureNo = null,
  projectNo = null,
  quantityIndex = null,
  currentStageId,
}) {
  const normalizedProjectId = String(projectId || "").trim() || null;
  const normalizedFixtureId = String(fixtureId || "").trim() || null;
  const normalizedFixtureNo = String(fixtureNo || quantityIndex || "").trim() || null;
  const normalizedProjectNo = String(projectNo || "").trim() || null;

  if (normalizedFixtureId || (normalizedProjectId && normalizedFixtureNo)) {
    const canonicalFixtureContext = await pool.query(
      `
        SELECT
          f.id AS fixture_id,
          f.project_id,
          f.fixture_no,
          p.project_no,
          COALESCE(NULLIF(fwp.stage_name, ''), NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id) AS stage_base_name,
          COALESCE(fwp.stage_version, 0) AS stage_version
        FROM design.fixtures f
        JOIN design.projects p ON p.id = f.project_id
        LEFT JOIN workflow_stages ws ON ws.id = $4
        LEFT JOIN fixture_workflow_progress fwp
          ON fwp.fixture_id = f.id
         AND fwp.department_id = p.department_id
         AND LOWER(fwp.stage_name) = LOWER(COALESCE(NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id))
        WHERE p.department_id = $1
          AND ($2::uuid IS NULL OR p.id = $2::uuid)
          AND ($3::uuid IS NULL OR f.id = $3::uuid)
          AND ($5::text IS NULL OR f.fixture_no = $5)
        ORDER BY
          CASE WHEN $3::uuid IS NOT NULL AND f.id = $3::uuid THEN 0 ELSE 1 END,
          f.id ASC
        LIMIT 1
      `,
      [
        departmentId,
        normalizedProjectId,
        normalizedFixtureId,
        currentStageId,
        normalizedFixtureNo,
      ],
    );

    if (canonicalFixtureContext.rows[0]) {
      const row = canonicalFixtureContext.rows[0];
      return {
        ...row,
        stage_name: row.stage_base_name,
      };
    }
  }

  if (normalizedProjectNo && normalizedFixtureNo) {
    const legacyFixtureContext = await pool.query(
      `
        SELECT
          f.id AS fixture_id,
          f.project_id,
          f.fixture_no,
          p.project_no,
          COALESCE(NULLIF(fwp.stage_name, ''), NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id) AS stage_base_name,
          COALESCE(fwp.stage_version, 0) AS stage_version
        FROM design.fixtures f
        JOIN design.projects p ON p.id = f.project_id
        LEFT JOIN workflow_stages ws ON ws.id = $4
        LEFT JOIN fixture_workflow_progress fwp
          ON fwp.fixture_id = f.id
         AND fwp.department_id = p.department_id
         AND LOWER(fwp.stage_name) = LOWER(COALESCE(NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id))
        WHERE p.department_id = $1
          AND p.project_no = $2
          AND f.fixture_no = $3
        LIMIT 1
      `,
      [departmentId, normalizedProjectNo, normalizedFixtureNo, currentStageId],
    );

    if (legacyFixtureContext.rows[0]) {
      const row = legacyFixtureContext.rows[0];
      return {
        ...row,
        stage_name: row.stage_base_name,
      };
    }

    return null;
  }

  return null;
}

async function createTaskForUser(user, payload = {}, options = {}) {
  const db = options.client || pool;
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
    fixture_id: payloadFixtureId = null,
    fixture_no: payloadFixtureNo = null,
    project_no: projectNo = null,
    project_name: projectName = null,
    customer_name: customerName = null,
    project_description: projectDescription = null,
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
    taskType === TASK_TYPES.DEPARTMENT_WORKFLOW && (projectId || payloadFixtureId || currentStageId)
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
    && Boolean(projectId || payloadFixtureId || currentStageId || projectNo || quantityIndex);
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

    if (assignees.some((assignee) => assignee.department_id !== resolvedDepartmentId)) {
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
        && assignees.some((assignee) => !workflowTemplate.eligible_role_ids.includes(assignee.role_id))
      ) {
        throw new AppError(400, "Selected assignee is not eligible for this workflow template");
      }
    }

    if (legacyWorkflowManaged) {
      workflow = await resolveWorkflowForDepartment(resolvedDepartmentId);
      resolvedCurrentStageId = String(currentStageId || "").trim();

      if (!resolvedCurrentStageId && payloadFixtureId) {
        const fixtureProgressRows = await getProgressForFixture(payloadFixtureId, resolvedDepartmentId, db);
        const activeProgressRow = fixtureProgressRows.find((row) => row.status !== "APPROVED") || null;
        const configuredStage = workflow.stages.find(
          (stage) => String(stage.name || "").trim().toLowerCase() === String(activeProgressRow?.stage_name || "").trim().toLowerCase(),
        );
        resolvedCurrentStageId = configuredStage?.id || "";
      }

      if (!resolvedCurrentStageId) {
        resolvedCurrentStageId = String(workflow.first_stage_id || "").trim();
      }

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
      fixtureId: payloadFixtureId,
      fixtureNo: payloadFixtureNo,
      projectNo,
      quantityIndex,
      currentStageId: resolvedCurrentStageId,
    })
    : null;

  const fixtureId = fixtureContext?.fixture_id || null;
  const resolvedProjectId = fixtureContext?.project_id || (projectId ? String(projectId).trim() : null);
  const resolvedFixtureNo = fixtureContext?.fixture_no || payloadFixtureNo || quantityIndex || null;
  const resolvedProjectNo = fixtureContext?.project_no || projectNo;
  const stage = fixtureContext?.stage_name || null;

  if (taskType === TASK_TYPES.DEPARTMENT_WORKFLOW) {
    assertMultiAssigneeAllowedForStage(assigneeIds, stage);
  }
  await assertProjectIsActive(resolvedProjectId);
  await assert2DRoutingTaskAssignmentAllowed({
    actor: user,
    assignees,
    projectId: resolvedProjectId,
    stageName: stage,
    client: db,
  });

  if (fixtureId && stage) {
    const dupCheck = await db.query(`
      SELECT 1 FROM tasks
      WHERE fixture_id = $1
        AND LOWER(stage) = LOWER($2)
        AND status NOT IN ('closed','cancelled')
      LIMIT 1
    `, [fixtureId, stage]);
    if (dupCheck.rows.length > 0) {
      throw new AppError(409, "Stage already assigned");
    }
  }

  const internalIdentifier = generateInternalTaskIdentifier({
    departmentId: resolvedDepartmentId || user.department_id || taskType,
    projectNo: resolvedProjectNo || workflowTemplate?.template_name || String(title || "").trim() || taskType,
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

  let taskId;
  try {
    taskId = await insertTask({
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
      fixture_id: fixtureId,
      fixture_no: resolvedFixtureNo,
      project_no: resolvedProjectNo,
      project_name: projectName,
      customer_name: customerName,
      project_description: projectDescription,
      quantity_index: quantityIndex,
      instance_count: instanceCount,
      rework_date: reworkDate,
      stage: stage,
    }, db);
  } catch (error) {
    if (error?.code === "ACTIVE_TASK_STAGE_CONFLICT" || error?.constraint === "uniq_active_task_per_stage") {
      throw new AppError(409, "Stage already assigned");
    }
    throw error;
  }

  await appendTaskActivity(taskId, {
    userEmployeeId: user.employee_id,
    actionType: "task_created",
    metadata: { assignee_ids: assigneeIds, internal_identifier: internalIdentifier },
  }, db);

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
  }, db);

  const task = await findTaskById(taskId, db);
  if (!options.skipAnalyticsRefresh) {
    await refreshTaskPerformanceAnalytics(task);
  }
  return task;
}

function generateInternalTaskIdentifier({ departmentId, projectNo, instanceCount }) {
  const prefix = [departmentId, projectNo, instanceCount]
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
  projectId = null,
  stageName = null,
} = {}) {
  const allUsers = await listUsers();
  const canUseAssignmentRules = hasPermission(user, PERMISSIONS.ASSIGN_TASK);
  const canUseTransferRules = hasPermission(user, PERMISSIONS.TRANSFER_TASK);
  let candidates = allUsers.filter((candidate) => {
    if (canUseAssignmentRules && canAssignTo(user, candidate)) {
      return true;
    }

    return canUseTransferRules
      && candidate.is_active !== false
      && (isAdmin(user) || user.department_id === candidate.department_id)
      && canAccessUser(user, candidate);
  });

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

    if (projectId && is2DStageName(stageName) && await projectHasActive2DRouting(projectId)) {
      const routedTeamEmployeeIds = new Set(await listAssigned2DLeaderTeamEmployeeIds(projectId));
      candidates = candidates.filter((candidate) => (
        routedTeamEmployeeIds.has(candidate.employee_id)
        && is2DSubdivisionAssignee(candidate)
      ));
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

  const projectCount = await countProjectsByDepartment(normalizedDepartmentId, { activeOnly: true });
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
  const hasCompletionUpdate = hasCompletionPercentUpdate(payload);
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
      if (
        taskForWorkflow.completion_percent === 100
        && ![TASK_STATUSES.UNDER_REVIEW, TASK_STATUSES.CLOSED, TASK_STATUSES.CANCELLED].includes(taskForWorkflow.status)
      ) {
        await applyTaskCompletionPercentUpdate(user, taskForWorkflow, { completion_percent: 100 });
      }
      handled = true;
    }

    if (workflowAction) {
      assertTaskProjectIsActive(taskForWorkflow);
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
      assertTaskProjectIsActive(taskForWorkflow);
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

  if (hasCompletionUpdate) {
    await applyTaskCompletionPercentUpdate(user, existingTask, payload);
    handled = true;
  }

  if (!handled) {
    throw new AppError(400, "Empty or unsupported task update payload");
  }

  const updatedTask = await findTaskById(Number(taskId));
  await refreshTaskPerformanceAnalytics(updatedTask);
  return updatedTask;
}

async function transferTaskForUser(user, taskId, payload = {}) {
  const normalizedTaskId = Number(taskId);

  if (Number.isNaN(normalizedTaskId)) {
    throw new AppError(400, "Invalid task ID");
  }

  const task = await findTaskById(normalizedTaskId);

  if (!task) {
    throw new AppError(404, "Task not found");
  }

  if (task.task_type !== TASK_TYPES.DEPARTMENT_WORKFLOW || !task.fixture_id) {
    throw new AppError(400, "Transfer task is available only for fixture workflow tasks");
  }

  await requireDesignTask(task);
  assertTaskProjectIsActive(task);

  if ([TASK_STATUSES.CLOSED, TASK_STATUSES.CANCELLED, TASK_STATUSES.UNDER_REVIEW].includes(task.status)) {
    throw new AppError(409, "Task cannot be transferred in its current state");
  }

  if (!canTransferDesignTask(user, task)) {
    throw new AppError(403, "You do not have permission to transfer this Design task");
  }

  const transferTo = normalizeTransferTarget(payload);
  const transferReason = normalizeTransferReason(payload);
  const completionPercent = normalizeTransferCompletion(payload, task);
  const remainingPercent = roundContributionPercent(100 - completionPercent);

  if (remainingPercent <= 0) {
    throw new AppError(409, "No remaining contribution is available to transfer");
  }

  const transferAssignee = await findUserByEmployeeId(transferTo);
  if (!transferAssignee || transferAssignee.is_active === false) {
    throw new AppError(404, "Transfer target user not found or inactive");
  }

  if (transferAssignee.department_id !== task.department_id) {
    throw new AppError(400, "Design workflow tasks can only be transferred within the Design Department");
  }

  if (transferTo === task.assigned_to) {
    throw new AppError(400, "Task is already assigned to this employee");
  }

  if (
    !canAssignTo(user, transferAssignee)
    && !(hasPermission(user, PERMISSIONS.TRANSFER_TASK) && canAccessUser(user, transferAssignee))
  ) {
    throw new AppError(403, "Cannot transfer to this user");
  }

  const client = await pool.connect();
  let updatedTask = null;

  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tasks WHERE id = $1::int FOR UPDATE", [normalizedTaskId]);

    const lockedTask = await findTaskById(normalizedTaskId, client);
    if (!lockedTask) {
      throw new AppError(404, "Task not found");
    }

    if ([TASK_STATUSES.CLOSED, TASK_STATUSES.CANCELLED, TASK_STATUSES.UNDER_REVIEW].includes(lockedTask.status)) {
      throw new AppError(409, "Task cannot be transferred in its current state");
    }

    const progressRows = await getProgressForFixture(lockedTask.fixture_id, lockedTask.department_id, client);
    const progressRow = resolveProgressRowForTask(lockedTask, progressRows);

    if (!progressRow) {
      throw new AppError(409, "No active Design stage is available for transfer");
    }

    if (progressRow.status === "APPROVED") {
      throw new AppError(409, "Approved stages cannot be transferred");
    }

    const currentEmployeeId = progressRow.assigned_to || lockedTask.assigned_to;
    if (!currentEmployeeId) {
      throw new AppError(409, "Current stage has no assignee to transfer from");
    }

    const stageName = progressRow.stage_name;
    const stageRevisionNo = normalizeStageVersion(progressRow.stage_version);
    const revisionCode = formatStageRevisionCode(stageName, stageRevisionNo);
    const previousContributions = await listStageContributions(
      lockedTask.fixture_id,
      stageName,
      revisionCode,
      client,
    );
    const previousActualContributions = previousContributions.filter(
      (contribution) => contribution.contribution_kind === "ACTUAL",
    );
    const previousActualTotal = sumContributionPercent(previousActualContributions);
    const outgoingContribution = roundContributionPercent(completionPercent - previousActualTotal);

    if (outgoingContribution < 0) {
      throw new AppError(
        409,
        "Current completion percent is below already preserved contribution history",
      );
    }

    const latestAttempt = await getLatestStageAttempt(lockedTask.fixture_id, stageName, client);
    const transferTimestamp = new Date();
    let preservedContribution = null;

    if (outgoingContribution > 0) {
      preservedContribution = await insertStageContribution({
        fixture_id: lockedTask.fixture_id,
        department_id: lockedTask.department_id,
        stage_name: stageName,
        revision_code: revisionCode,
        stage_revision_no: stageRevisionNo,
        employee_id: currentEmployeeId,
        contribution_percent: outgoingContribution,
        contribution_kind: "ACTUAL",
        transfer_reason: transferReason,
        transferred_by: user.employee_id,
        transferred_at: transferTimestamp,
        changed_by: user.employee_id,
        changed_at: transferTimestamp,
        previous_stage: stageName,
        stage_instance_id: latestAttempt?.id || null,
        stage_attempt_no: latestAttempt?.attempt_no ?? null,
        metadata: {
          task_id: lockedTask.id,
          from_employee_id: currentEmployeeId,
          to_employee_id: transferTo,
          completion_percent: completionPercent,
          revision_code: revisionCode,
        },
      }, client);
    }

    const openRemainingContributions = previousContributions.filter(
      (contribution) => contribution.contribution_kind === "REMAINING",
    );
    for (const contribution of openRemainingContributions) {
      await supersedeContribution(contribution.id, preservedContribution?.id || null, client);
    }

    await insertStageContribution({
      fixture_id: lockedTask.fixture_id,
      department_id: lockedTask.department_id,
      stage_name: stageName,
      revision_code: revisionCode,
      stage_revision_no: stageRevisionNo,
      employee_id: transferTo,
      contribution_percent: remainingPercent,
      contribution_kind: "REMAINING",
      transfer_reason: transferReason,
      transferred_by: user.employee_id,
      transferred_at: transferTimestamp,
      changed_by: user.employee_id,
      changed_at: transferTimestamp,
      previous_stage: stageName,
      stage_instance_id: latestAttempt?.id || null,
      stage_attempt_no: latestAttempt?.attempt_no ?? null,
      metadata: {
        task_id: lockedTask.id,
        from_employee_id: currentEmployeeId,
        to_employee_id: transferTo,
        completion_percent: completionPercent,
        revision_code: revisionCode,
      },
    }, client);

    const nextContributions = await listStageContributions(
      lockedTask.fixture_id,
      stageName,
      revisionCode,
      client,
    );
    const nextTotal = sumContributionPercent(nextContributions);
    if (Math.abs(nextTotal - 100) > 0.01) {
      throw new AppError(409, "Stage contribution total must remain exactly 100%");
    }

    await updateTaskAssignmentForTransfer(lockedTask.id, {
      assignedTo: transferTo,
      completionPercent,
    }, client);
    await updateProgressRow(lockedTask.fixture_id, stageName, { assigned_to: transferTo }, client);
    await updateLatestStageAttemptAssignment(
      lockedTask.fixture_id,
      stageName,
      transferTo,
      transferTimestamp,
      client,
    );

    await appendTaskActivity(lockedTask.id, {
      userEmployeeId: user.employee_id,
      actionType: "task_transferred",
      notes: transferReason,
      metadata: {
        from_employee_id: currentEmployeeId,
        to_employee_id: transferTo,
        stage_name: stageName,
        revision_code: revisionCode,
        completion_percent: completionPercent,
        preserved_percent: outgoingContribution,
        remaining_percent: remainingPercent,
      },
    }, client);

    await addTaskLog(lockedTask.id, {
      updatedBy: user.employee_id,
      stepName: "task_transferred",
      status: "recorded",
      notes: transferReason,
    }, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "design_task_transferred",
      targetType: "task",
      targetId: lockedTask.id,
      metadata: {
        from_employee_id: currentEmployeeId,
        to_employee_id: transferTo,
        stage_name: stageName,
        revision_code: revisionCode,
        completion_percent: completionPercent,
        preserved_percent: outgoingContribution,
        remaining_percent: remainingPercent,
      },
    }, client);

    updatedTask = await findTaskById(lockedTask.id, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

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

  assertTaskProjectIsActive(task);

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
    throw new AppError(400, "Previous stage must be approved before changing workflow");
  }

  const nextStage = allowedNextStage || await getStageById(requestedStageId);

  if (!nextStage) {
    throw new AppError(404, "Next stage not found");
  }

  const transitionTime = new Date();
  const nextStatus = nextStage.is_final ? TASK_STATUSES.CLOSED : TASK_STATUSES.ASSIGNED;

  if (nextStatus === TASK_STATUSES.CLOSED && isProofRequired(task) && isWorkProofRequiredForTask(task) && !taskHasProof(task)) {
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

  if (!canCancelTask(user, task)) {
    throw new AppError(403, "You do not have permission to cancel this task");
  }

  const cancellationReason = typeof reason === "string" ? reason.trim() : "";
  if (!cancellationReason) {
    throw new AppError(400, "Cancellation reason is required");
  }

  if (isTaskApprovedOrWorkflowComplete(task)) {
    throw new AppError(409, "Approved or workflow-completed tasks cannot be cancelled");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tasks WHERE id = $1::int FOR UPDATE", [task.id]);
    const lockedTask = await findTaskById(task.id, client);

    if (!lockedTask) {
      throw new AppError(404, "Task not found");
    }

    if (isTaskApprovedOrWorkflowComplete(lockedTask)) {
      throw new AppError(409, "Approved or workflow-completed tasks cannot be cancelled");
    }

    if (lockedTask.workflow_status === WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION || lockedTask.operational_state === "VERIFICATION") {
      throw new AppError(409, "Tasks in verification cannot be cancelled");
    }

    if (!canCancelOperationalTask(lockedTask)) {
      throw new AppError(409, "Task cannot be cancelled in its current operational state");
    }

    const cancelledTaskId = await cancelTask(lockedTask.id, {
      cancelledBy: user.employee_id,
      reason: cancellationReason,
    }, client);

    if (!cancelledTaskId) {
      throw new AppError(409, "Task is already cancelled or no longer cancellable");
    }

    if (lockedTask.fixture_id && lockedTask.department_id) {
      await releaseFixtureStageAssignment(lockedTask.fixture_id, lockedTask.department_id, client);
    }

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "task_cancelled",
      targetType: "task",
      targetId: lockedTask.id,
      metadata: {
        reason: cancellationReason,
        cancelled_by: user.employee_id,
        cancelled_at: new Date().toISOString(),
        previous_status: lockedTask.status,
        previous_verification_status: lockedTask.verification_status,
        previous_stage_id: lockedTask.current_stage_id,
        previous_workflow_status: lockedTask.workflow_status,
      },
    }, client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

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

  if (nextStatus === TASK_STATUSES.UNDER_REVIEW || nextStatus === TASK_STATUSES.CLOSED) {
    assertWorkProofUploaded(task);
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
    metadata: {
      from: task.status,
      to: nextStatus,
      workflow_id: task.workflow_id || null,
      current_stage_id: task.current_stage_id || null,
      current_stage_name: task.workflow_stage || null,
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
    },
  });

}

async function applyTaskVerificationUpdate(user, task, verificationStatus, remarks) {
  assertTaskPendingVerificationReview(user, task);
  await resolveWorkflowReviewProgressRow(task, verificationStatus);

  if (verificationStatus === VERIFICATION_STATUSES.REJECTED && !String(remarks || "").trim()) {
    throw new AppError(400, "Remarks are required when rejecting a task");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tasks WHERE id = $1::int FOR UPDATE", [task.id]);

    const lockedTask = await findTaskById(task.id, client);
    if (!lockedTask) {
      throw new AppError(404, "Task not found");
    }

    assertTaskPendingVerificationReview(user, lockedTask);
    let workflowProgressRow = await resolveWorkflowReviewProgressRow(lockedTask, verificationStatus, client);
    const next = getVerificationOutcome(user, lockedTask, verificationStatus);
    const closedAt = next.status === TASK_STATUSES.CLOSED ? new Date() : null;
    const completionMetrics = next.status === TASK_STATUSES.CLOSED
      ? await buildTaskCompletionMetrics(lockedTask, closedAt)
      : {};

    ensureTaskTransitionAllowed(lockedTask.status, next.status, { allowSameStatus: true });

    if (
      workflowProgressRow
      && workflowProgressRow.status === WORKFLOW_STATUSES.IN_PROGRESS
      && isCanonicalReviewTask(lockedTask)
    ) {
      await updateProgressRow(lockedTask.fixture_id, workflowProgressRow.stage_name, {
        status: WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION,
        completed_at: lockedTask.completed_at || lockedTask.submitted_at || new Date(),
      }, client);
      workflowProgressRow = {
        ...workflowProgressRow,
        status: WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION,
      };
    }

    await updateTaskVerification(lockedTask.id, {
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
      submitted_at: lockedTask.submitted_at || lockedTask.completed_at || closedAt || new Date(),
      rejection_count_increment: next.status === TASK_STATUSES.REWORK ? 1 : 0,
    }, client);

    if (next.status === TASK_STATUSES.CLOSED) {
      await advanceWorkflowAfterTaskApproval({
        project_id: lockedTask.project_id,
        fixture_no: lockedTask.fixture_no,
        department_id: lockedTask.department_id,
        fixture_id: lockedTask.fixture_id,
        task_id: lockedTask.id,
        client,
      });
    } else if (workflowProgressRow && next.verificationStatus === VERIFICATION_STATUSES.REJECTED) {
      await updateProgressRow(lockedTask.fixture_id, workflowProgressRow.stage_name, {
        status: WORKFLOW_STATUSES.REJECTED,
        completed_at: null,
      }, client);
      await rejectStageAttempt(lockedTask.fixture_id, workflowProgressRow.stage_name, new Date(), client);
    }

    await appendTaskActivity(lockedTask.id, {
      userEmployeeId: user.employee_id,
      actionType: next.activityType,
      notes: remarks || null,
      metadata: {
        verification_status: next.verificationStatus,
        workflow_status: next.status === TASK_STATUSES.CLOSED
          ? WORKFLOW_STATUSES.APPROVED
          : next.verificationStatus === VERIFICATION_STATUSES.REJECTED
            ? WORKFLOW_STATUSES.REJECTED
            : WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION,
        workflow_id: lockedTask.workflow_id || null,
        current_stage_id: lockedTask.current_stage_id || null,
        current_stage_name: lockedTask.workflow_stage || null,
      },
    }, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: next.activityType,
      targetType: "task",
      targetId: lockedTask.id,
      metadata: {
        verification_status: verificationStatus,
        remarks: remarks || null,
      },
    }, client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

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

function assertTaskPendingVerificationReview(user, task) {
  assertTaskProjectIsActive(task);

  if (!canVerifyTask(user, task)) {
    throw new AppError(403, "You do not have permission to verify this task");
  }

  if (isTaskAssignee(user, task) && !hasPermission(user, PERMISSIONS.SELF_APPROVE)) {
    throw new AppError(403, "You cannot approve your own task");
  }

  if (task.status !== TASK_STATUSES.UNDER_REVIEW) {
    throw new AppError(400, "Task is not in verification state");
  }

  if (task.verification_status !== VERIFICATION_STATUSES.PENDING) {
    throw new AppError(400, "Task is not pending verification");
  }
}

async function resolveWorkflowReviewProgressRow(task, verificationStatus, client = pool) {
  if (!isWorkflowManagedTask(task)) {
    return null;
  }

  const progressRows = await getProgressForFixture(task.fixture_id, task.department_id, client);
  const workflowProgressRow = resolveProgressRowForTask(task, progressRows);

  if (!workflowProgressRow) {
    throw new AppError(409, "Workflow stage is not ready for verification");
  }

  if (
    workflowProgressRow.status !== WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION
    && !(isCanonicalReviewTask(task) && workflowProgressRow.status === WORKFLOW_STATUSES.IN_PROGRESS)
  ) {
    throw new AppError(409, "Task is not in verification state");
  }

  if (verificationStatus === VERIFICATION_STATUSES.APPROVED) {
    assertWorkProofUploaded(task);
  }

  return workflowProgressRow;
}

function assertTaskProjectIsActive(task) {
  if (!task?.project_id) {
    return;
  }

  const projectStatus = task.project_status || PROJECT_STATUSES.ACTIVE;
  if (projectStatus === PROJECT_STATUSES.ACTIVE) {
    return;
  }

  throw new AppError(
    409,
    projectStatus === PROJECT_STATUSES.ON_HOLD
      ? "Project is on hold and cannot continue active task workflow"
      : "Project is released or completed and cannot continue active task workflow",
  );
}

async function assertProjectIsActive(projectId) {
  if (!projectId) {
    return;
  }

  const projectStatus = await getProjectStatusById(projectId);
  if (!projectStatus) {
    return;
  }

  if (projectStatus !== PROJECT_STATUSES.ACTIVE) {
    throw new AppError(
      409,
      projectStatus === PROJECT_STATUSES.ON_HOLD
        ? "Project is on hold and cannot be assigned"
        : "Project is released or completed and cannot be assigned",
    );
  }
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
  assertTaskProjectIsActive(task);
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

function canUpdateTaskCompletionPercent(user, task) {
  if (isTaskAssignee(user, task)) {
    return true;
  }

  if (!hasPermission(user, PERMISSIONS.EDIT_TASK) || !canAccessTask(user, task)) {
    return false;
  }

  if (isAdmin(user) || isProjectAuthorityRole(user)) {
    return true;
  }

  const actorLevel = Number(getRoleLevel(user));
  const assigneeLevel = Number(task?.assignee?.role?.hierarchy_level ?? NaN);

  return Number.isFinite(actorLevel) && Number.isFinite(assigneeLevel) && actorLevel < assigneeLevel;
}

async function applyTaskCompletionPercentUpdate(user, task, payload) {
  assertTaskProjectIsActive(task);

  if (!canUpdateTaskCompletionPercent(user, task)) {
    throw new AppError(403, "Only the assignee or an authorized higher role can update completion percent");
  }

  if (task.status === TASK_STATUSES.CLOSED) {
    throw new AppError(409, "Completion percent cannot be changed after task completion");
  }

  const completionPercent = normalizeCompletionPercent(payload.completion_percent);
  const client = await pool.connect();
  let submittedForVerification = false;
  let autoStarted = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tasks WHERE id = $1::int FOR UPDATE", [task.id]);
    const lockedTask = await findTaskById(task.id, client);
    if (!lockedTask) {
      throw new AppError(404, "Task not found");
    }

    if (shouldAutoStartTask(lockedTask, completionPercent)) {
      const startedAt = lockedTask.started_at || new Date();
      let currentWorkflowStage = null;

      if (isWorkflowManagedTask(lockedTask)) {
        const progressRows = await getProgressForFixture(lockedTask.fixture_id, lockedTask.department_id, client);
        currentWorkflowStage = resolveProgressRowForTask(lockedTask, progressRows);
        if (currentWorkflowStage) {
          await updateProgressRow(lockedTask.fixture_id, currentWorkflowStage.stage_name, {
            status: WORKFLOW_STATUSES.IN_PROGRESS,
            assigned_to: lockedTask.assigned_to,
            assigned_at: currentWorkflowStage.assigned_at || lockedTask.assigned_at || startedAt,
            started_at: currentWorkflowStage.started_at || startedAt,
            completed_at: null,
            duration_minutes: null,
          }, client);
          await startStageAttempt(
            lockedTask.fixture_id,
            lockedTask.department_id,
            currentWorkflowStage.stage_name,
            lockedTask.assigned_to,
            startedAt,
            client,
          );
        }
      }

      await updateTaskStatus(lockedTask.id, {
        status: TASK_STATUSES.IN_PROGRESS,
        started_at: startedAt,
        completed_at: null,
        verification_status: VERIFICATION_STATUSES.PENDING,
        actual_minutes: lockedTask.actual_minutes || 0,
        approval_stage: "execution",
        closed_at: null,
        current_stage_id: lockedTask.current_stage_id,
        lifecycle_status: TASK_STATUSES.IN_PROGRESS,
      }, client);
      lockedTask.status = TASK_STATUSES.IN_PROGRESS;
      lockedTask.started_at = startedAt;
      autoStarted = true;
    }

    if (isWorkflowManagedTask(lockedTask) && shouldSubmitForVerification(lockedTask, completionPercent)) {
      await submitFixtureStageForVerification({ task: lockedTask, actor: user, client });
      await updateTaskCompletionPercent(lockedTask.id, completionPercent, client);
      await updateTaskStatus(lockedTask.id, {
        status: TASK_STATUSES.UNDER_REVIEW,
        started_at: lockedTask.started_at || new Date(),
        completed_at: new Date(),
        verification_status: VERIFICATION_STATUSES.PENDING,
        actual_minutes: lockedTask.actual_minutes || 0,
        approval_stage: "manager",
        closed_at: null,
        current_stage_id: lockedTask.current_stage_id,
        lifecycle_status: TASK_STATUSES.IN_PROGRESS,
        submitted_at: new Date(),
      }, client);
      submittedForVerification = true;
    } else {
      await updateTaskCompletionPercent(lockedTask.id, completionPercent, client);
    }

    await appendTaskActivity(lockedTask.id, {
      userEmployeeId: user.employee_id,
      actionType: submittedForVerification
        ? "task_submitted_for_verification"
        : autoStarted
          ? "task_auto_started"
          : "task_completion_percent_updated",
      metadata: {
        from: lockedTask.completion_percent ?? 0,
        to: completionPercent,
        workflow_status: submittedForVerification
          ? WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION
          : autoStarted
            ? WORKFLOW_STATUSES.IN_PROGRESS
            : null,
      },
    }, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: submittedForVerification
        ? "task_submitted_for_verification"
        : autoStarted
          ? "task_auto_started"
          : "task_completion_percent_updated",
      targetType: "task",
      targetId: lockedTask.id,
      metadata: {
        from: lockedTask.completion_percent ?? 0,
        to: completionPercent,
      },
    }, client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

}

async function applyTaskDetailUpdate(user, task, payload) {
  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to edit this task");
  }

  const normalizedPayload = { ...payload };
  const hasReassignment = hasOwn(payload, "assigned_to") || hasOwn(payload, "assignee_ids");
  const hasDepartmentUpdate = hasOwn(payload, "department_id");
  let reassignmentContributionMetadata = null;

  if (hasReassignment) {
    assertTaskProjectIsActive(task);
  }

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
      const stageName = task.workflow_stage || task.stage || null;
      assertMultiAssigneeAllowedForStage(requestedAssigneeIds, stageName);

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

      await assert2DRoutingTaskAssignmentAllowed({
        actor: user,
        assignees,
        projectId: task.project_id,
        stageName,
      });
    }

    normalizedPayload.assignee_ids = requestedAssigneeIds;
    normalizedPayload.assigned_to = assignees[0].employee_id;
    normalizedPayload.assigned_user_id = assignees[0].employee_id;

    if (
      task.task_type === TASK_TYPES.DEPARTMENT_WORKFLOW
      && task.fixture_id
      && task.assigned_to
      && assignees[0].employee_id !== task.assigned_to
    ) {
      const completionPercent = Number(task.completion_percent);
      const hasRecordedCompletionPercent = Number.isFinite(completionPercent);
      const stageName = task.workflow_stage || task.stage || null;
      const stageRevisionNo = normalizeStageVersion(task.workflow_stage_version);
      reassignmentContributionMetadata = {
        source: "task_reassignment",
        fixture_id: task.fixture_id,
        task_id: task.id,
        stage_name: stageName,
        stage_revision_no: stageRevisionNo,
        revision_code: stageName ? formatStageRevisionCode(stageName, stageRevisionNo) : null,
        previous_assigned_to: task.assigned_to,
        previous_assigned_to_name: task.assignee?.name || null,
        next_assigned_to: assignees[0].employee_id,
        next_assigned_to_name: assignees[0].name || null,
        contribution_percent_recorded: hasRecordedCompletionPercent,
        previous_contribution_percent: hasRecordedCompletionPercent ? completionPercent : null,
        remaining_contribution_percent: hasRecordedCompletionPercent
          ? Math.max(0, Math.min(100, 100 - completionPercent))
          : null,
      };
    }
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
    metadata: reassignmentContributionMetadata
      ? { ...normalizedPayload, reassignment_contribution: reassignmentContributionMetadata }
      : normalizedPayload,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "task_updated",
    targetType: "task",
    targetId: task.id,
    metadata: reassignmentContributionMetadata
      ? { ...normalizedPayload, reassignment_contribution: reassignmentContributionMetadata }
      : normalizedPayload,
  });

  if (hasReassignment) {
    const refreshedTask = await findTaskById(task.id);
    await refreshTaskPerformanceAnalytics(refreshedTask);
  }
}

module.exports = instrumentModuleExports("service.taskService", {
  cancelTaskForUser,
  createTaskForUser,
  ensureTaskProofUpdateAllowed,
  getTaskForUser,
  getAssignableUsersForTaskContext,
  listAssignmentReferenceDataForUser,
  listTaskActivityForUser,
  listTasksForUser,
  listVerificationTasksForUser,
  listWorkflowTemplatesForUser,
  resolveDepartmentAssignmentContextForUser,
  resolveWorkflowForDepartment,
  transferTaskForUser,
  transitionTaskForUser,
  updateTaskForUser,
});
