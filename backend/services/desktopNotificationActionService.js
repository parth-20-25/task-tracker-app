const { AppError } = require("../lib/AppError");
const { PERMISSIONS, TASK_STATUSES, VERIFICATION_STATUSES } = require("../config/constants");
const { findTaskById } = require("../repositories/tasksRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const { canAccessTask, hasPermission, isTaskAssignee } = require("./accessControlService");
const { updateTaskForUser } = require("./taskService");

const ACTION_SOURCE = "desktop_notification_agent";

function normalizeTaskId(taskId) {
  const normalized = Number(taskId);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new AppError(400, "Invalid task id");
  }
  return normalized;
}

async function resolveDeviceUser(device) {
  const userId = String(device?.user_id || "").trim();
  if (!userId) {
    throw new AppError(401, "Device is not registered");
  }

  const user = await findUserByEmployeeId(userId);
  if (!user || user.is_active === false) {
    throw new AppError(401, "Device user is not active");
  }

  return user;
}

function assertDesktopActionAllowed(user, task, actionLabel) {
  if (!isTaskAssignee(user, task)) {
    throw new AppError(403, "This task is no longer assigned to you.");
  }

  if (!canAccessTask(user, task)) {
    throw new AppError(403, "You do not have permission to access this task.");
  }

  if (!hasPermission(user, PERMISSIONS.EDIT_TASK)) {
    throw new AppError(403, `You do not have permission to ${actionLabel}.`);
  }

  if (task.status === TASK_STATUSES.CLOSED || task.status === TASK_STATUSES.CANCELLED || task.approved_at) {
    throw new AppError(409, "This task cannot be started from its current status.");
  }
}

function success(task, message) {
  return {
    success: true,
    taskId: Number(task.id),
    status: task.status,
    message,
  };
}

function auditMetadata(device) {
  return {
    source: ACTION_SOURCE,
    device_id: device.device_id,
    timestamp: new Date().toISOString(),
  };
}

async function applyDesktopTaskAction({ device, taskId, action, allowedStatus, idempotent, actionLabel, successMessage, invalidMessage }) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const user = await resolveDeviceUser(device);
  const task = await findTaskById(normalizedTaskId);

  if (!task) {
    throw new AppError(404, "Task not found.");
  }

  assertDesktopActionAllowed(user, task, actionLabel);

  if (idempotent(task)) {
    return success(task, successMessage);
  }

  if (task.status !== allowedStatus) {
    throw new AppError(409, invalidMessage);
  }

  try {
    const updatedTask = await updateTaskForUser(user, normalizedTaskId, { action }, { auditMetadata: auditMetadata(device) });
    return success(updatedTask, successMessage);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 400) {
      throw new AppError(409, error.message);
    }
    throw error;
  }
}

async function startTaskFromDesktopNotification(device, taskId) {
  return applyDesktopTaskAction({
    device,
    taskId,
    action: "start",
    allowedStatus: TASK_STATUSES.ASSIGNED,
    idempotent: (task) => task.status === TASK_STATUSES.IN_PROGRESS,
    actionLabel: "start this task",
    successMessage: "Task started successfully.",
    invalidMessage: "This task cannot be started from its current status.",
  });
}

async function startCorrectionFromDesktopNotification(device, taskId) {
  return applyDesktopTaskAction({
    device,
    taskId,
    action: "resume",
    allowedStatus: TASK_STATUSES.REWORK,
    idempotent: (task) => task.status === TASK_STATUSES.IN_PROGRESS
      && task.verification_status === VERIFICATION_STATUSES.PENDING
      && Number(task.rejection_count || 0) > 0,
    actionLabel: "start correction for this task",
    successMessage: "Task correction started successfully.",
    invalidMessage: "This task is not waiting for correction.",
  });
}

module.exports = {
  ACTION_SOURCE,
  startCorrectionFromDesktopNotification,
  startTaskFromDesktopNotification,
};