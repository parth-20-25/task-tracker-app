const { AppError } = require("../lib/AppError");
const { PERMISSIONS } = require("../config/constants");
const {
  hasPermission,
  isOperationalControllerRole,
  isProjectAuthorityRole,
  isSupervisor,
} = require("./accessControlService");
const notificationRepository = require("../repositories/taskNotificationRepository");

const NOTIFICATION_TYPES = {
  USER_OVERDUE_TASK: "OVERDUE_TASK",
  TEAM_OVERDUE_TASK: "TEAM_OVERDUE_TASK",
};

const TERMINAL_TASK_STATUSES = new Set(["closed", "completed", "approved", "released", "cancelled"]);
const TERMINAL_PROJECT_STATUSES = new Set(["completed", "released", "cancelled"]);
const TERMINAL_LIFECYCLE_STATUSES = new Set(["completed", "cancelled"]);
const PENDING_APPROVAL_STATUSES = new Set(["pending", "manager_approved", "quality_pending"]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function getTaskDeadline(task) {
  const value = task?.deadline || null;
  if (!value) {
    return null;
  }

  const deadline = value instanceof Date ? value : new Date(value);
  return Number.isFinite(deadline.getTime()) ? deadline : null;
}

function normalizeEmployeeId(value) {
  return String(value || "").trim().toLowerCase();
}

function getTaskAssigneeIds(task) {
  return [
    task?.assigned_user_id,
    task?.assigned_to,
    task?.assignee?.employee_id,
    ...(Array.isArray(task?.assignee_ids) ? task.assignee_ids : []),
  ].filter(Boolean);
}

function taskHasAssignee(task) {
  return getTaskAssigneeIds(task).length > 0;
}

function isTaskAssignedToUser(task, user) {
  const employeeId = normalizeEmployeeId(user?.employee_id);
  if (!employeeId) {
    return false;
  }

  return getTaskAssigneeIds(task).some((assigneeId) => normalizeEmployeeId(assigneeId) === employeeId);
}

function isSubmittedBeforeDeadlineAwaitingApproval(task, deadline) {
  if (normalizeStatus(task?.status) !== "under_review") {
    return false;
  }

  if (!PENDING_APPROVAL_STATUSES.has(normalizeStatus(task?.verification_status || "pending"))) {
    return false;
  }

  if (!task?.submitted_at) {
    return false;
  }

  const submittedAt = new Date(task.submitted_at);
  if (!Number.isFinite(submittedAt.getTime())) {
    return false;
  }

  return submittedAt.getTime() <= deadline.getTime();
}

function isTaskOverdue(task, now = new Date()) {
  const deadline = getTaskDeadline(task);
  if (!deadline || now.getTime() <= deadline.getTime()) {
    return false;
  }

  if (!taskHasAssignee(task)) {
    return false;
  }

  if (TERMINAL_TASK_STATUSES.has(normalizeStatus(task?.status))) {
    return false;
  }

  if (TERMINAL_LIFECYCLE_STATUSES.has(normalizeStatus(task?.lifecycle_status))) {
    return false;
  }

  if (normalizeStatus(task?.verification_status) === "approved" || task?.approved_at) {
    return false;
  }

  if (TERMINAL_PROJECT_STATUSES.has(normalizeStatus(task?.project_status || "active"))) {
    return false;
  }

  if (isSubmittedBeforeDeadlineAwaitingApproval(task, deadline)) {
    return false;
  }

  return true;
}

function calculateOverdueMinutes(task, now = new Date()) {
  const deadline = getTaskDeadline(task);
  if (!deadline) {
    return 0;
  }

  return Math.max(0, Math.floor((now.getTime() - deadline.getTime()) / 60000));
}

function formatOverdueDelay(totalMinutes) {
  const minutes = Math.max(0, Math.floor(Number(totalMinutes) || 0));

  if (minutes < 60) {
    return `${minutes}m overdue`;
  }

  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m overdue` : `${hours}h overdue`;
  }

  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return hours > 0 ? `${days}d ${hours}h overdue` : `${days}d overdue`;
}

function filterCurrentUserOverdueTasks(tasks, user, now = new Date()) {
  return tasks.filter((task) => isTaskAssignedToUser(task, user) && isTaskOverdue(task, now));
}

function filterTeamOverdueTasks(tasks, user, now = new Date(), visibleUserIds = null) {
  const currentUserId = normalizeEmployeeId(user?.employee_id);
  const visibleSet = Array.isArray(visibleUserIds)
    ? new Set(visibleUserIds.map(normalizeEmployeeId).filter(Boolean))
    : null;

  return tasks.filter((task) => {
    if (!isTaskOverdue(task, now)) {
      return false;
    }

    const assigneeIds = getTaskAssigneeIds(task).map(normalizeEmployeeId).filter(Boolean);
    if (assigneeIds.includes(currentUserId)) {
      return false;
    }

    return !visibleSet || assigneeIds.some((assigneeId) => visibleSet.has(assigneeId));
  });
}

function canViewTeamOverdueAlerts(user) {
  return Boolean(
    user?.employee_id
    && (
      isProjectAuthorityRole(user)
      || isOperationalControllerRole(user)
      || isSupervisor(user)
      || hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS)
      || hasPermission(user, PERMISSIONS.APPROVE_COMPLETED_TASK)
      || hasPermission(user, PERMISSIONS.APPROVE_QUALITY)
    ),
  );
}

function getProjectNumber(task) {
  return task.project_no || task.project_code || "";
}

function getStageTaskName(task) {
  return task.workflow_stage || task.stage || task.title || task.internal_identifier || `Task #${task.id}`;
}

function mapOverdueAlert(task, notification, now = new Date()) {
  const overdueMinutes = calculateOverdueMinutes(task, now);

  return {
    notification_id: notification.id,
    notification_type: notification.notification_type,
    notification_status: notification.status,
    notification_title: notification.title,
    notification_message: notification.message,
    severity: notification.severity,
    triggered_at: notification.triggered_at,
    task_id: task.id,
    project_id: task.project_id || null,
    project_number: getProjectNumber(task),
    project_name: task.project_name || "",
    stage_task_name: getStageTaskName(task),
    deadline: task.deadline,
    overdue_minutes: overdueMinutes,
    time_overdue: formatOverdueDelay(overdueMinutes),
    current_status: task.status,
    employee_name: task.assignee?.name || task.assignee_names || null,
    employee_id: task.assignee?.employee_id || task.assigned_user_id || task.assigned_to || null,
  };
}

function buildAlertRows(tasks, notificationsByTask, now = new Date()) {
  return tasks
    .map((task) => {
      const notification = notificationsByTask.get(Number(task.id));
      return notification ? mapOverdueAlert(task, notification, now) : null;
    })
    .filter(Boolean)
    .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime());
}

async function listCurrentUserOverdueAlerts(user, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const repository = options.repository || notificationRepository;
  const tasks = filterCurrentUserOverdueTasks(
    await repository.listCurrentUserOverdueTasks(user, now),
    user,
    now,
  );
  const notificationsByTask = await repository.ensureOverdueNotificationsForTasks(tasks, {
    recipientUserId: user.employee_id,
    notificationType: NOTIFICATION_TYPES.USER_OVERDUE_TASK,
    now,
  });

  return buildAlertRows(tasks, notificationsByTask, now);
}

async function listTeamOverdueAlerts(user, options = {}) {
  if (!canViewTeamOverdueAlerts(user)) {
    throw new AppError(403, "Team overdue alerts are limited to leaders and supervisors");
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const repository = options.repository || notificationRepository;
  const tasks = filterTeamOverdueTasks(
    await repository.listTeamOverdueTasks(user, now),
    user,
    now,
  );
  const notificationsByTask = await repository.ensureOverdueNotificationsForTasks(tasks, {
    recipientUserId: user.employee_id,
    notificationType: NOTIFICATION_TYPES.TEAM_OVERDUE_TASK,
    now,
  });

  return buildAlertRows(tasks, notificationsByTask, now);
}

async function acknowledgeNotification(user, notificationId, options = {}) {
  const repository = options.repository || notificationRepository;
  const notification = await repository.acknowledgeNotificationForRecipient(notificationId, user.employee_id);

  if (!notification) {
    throw new AppError(404, "Notification not found");
  }

  return notification;
}

module.exports = {
  NOTIFICATION_TYPES,
  acknowledgeNotification,
  buildAlertRows,
  calculateOverdueMinutes,
  canViewTeamOverdueAlerts,
  filterCurrentUserOverdueTasks,
  filterTeamOverdueTasks,
  formatOverdueDelay,
  isSubmittedBeforeDeadlineAwaitingApproval,
  isTaskAssignedToUser,
  isTaskOverdue,
  listCurrentUserOverdueAlerts,
  listTeamOverdueAlerts,
  mapOverdueAlert,
};