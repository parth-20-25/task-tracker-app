const crypto = require("crypto");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { PERMISSIONS } = require("../config/constants");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  claimLoginSummarySession,
  claimPendingOutbox,
  continueCurrentTaskForUser,
  countDeliveredOverdueReminders,
  createDesktopNotification,
  enqueueOutboxEvent,
  findDeviceByDeviceId,
  getCurrentTaskForUser,
  getDailyReminderTimes,
  getNotificationById,
  getProjectReleasedNotificationContext,
  listActiveTaskIdsForUser,
  listDesktopReminderCandidates,
  listDueCurrentTaskChecks,
  listPendingNotificationsForDevice,
  listUsersNeedingCurrentTaskSelection,
  listUsersWithPermission,
  markDeliveryAcknowledged,
  markDeliveryActioned,
  markDeliveryDisplayed,
  markDeliveryReceived,
  markDeliverySent,
  markDeliverySnoozed,
  markOutboxFailed,
  markOutboxProcessed,
  notifyDesktopNotification,
  registerDesktopDevice,
  revokeDevice,
  selectCurrentTaskForUser,
  touchDeviceConnected,
} = require("../repositories/desktopNotificationRepository");
const { findTaskById } = require("../repositories/tasksRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const { canAccessTask } = require("./accessControlService");
const { loginUser } = require("./authService");

const EVENT_TYPES = {
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_UPDATE_REQUIRED: "TASK_UPDATE_REQUIRED",
  TASK_DUE_TODAY: "TASK_DUE_TODAY",
  TASK_OVERDUE: "TASK_OVERDUE",
  TASK_OVERDUE_EXECUTIVE_ESCALATION: "TASK_OVERDUE_EXECUTIVE_ESCALATION",
  PROJECT_RELEASED: "PROJECT_RELEASED",
  ACTIVE_TASK_REMINDER: "ACTIVE_TASK_REMINDER",
  CURRENT_TASK_SELECTION: "CURRENT_TASK_SELECTION",
  TASK_PROGRESS_UPDATE: "TASK_PROGRESS_UPDATE",
};

const INDIA_TIME_ZONE = "Asia/Kolkata";
const SCHEDULE_MATCH_WINDOW_MINUTES = 5;

const ACTIVE_TASK_REMINDER_STATUSES = new Set(["created", "pending", "assigned", "in_progress", "on_hold", "under_review", "rework", "update_required"]);
const TERMINAL_TASK_STATUSES = new Set(["closed", "completed", "approved", "rejected", "cancelled"]);
const REGISTRATION_WINDOW_MS = 15 * 60 * 1000;
const MAX_REGISTRATION_ATTEMPTS = 5;
const registrationAttempts = new Map();

function generateDeviceToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashDeviceToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function safeTokenEqual(storedHash, token) {
  const actual = Buffer.from(String(storedHash || ""), "hex");
  const expected = Buffer.from(hashDeviceToken(token), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeDeviceId(deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new AppError(400, "Invalid deviceId");
  }
  return normalized.toLowerCase();
}

function assertRegistrationRateLimit(employeeId, ipAddress = "unknown") {
  const key = `${employeeId}:${ipAddress}`;
  const now = Date.now();
  const attempts = (registrationAttempts.get(key) || []).filter((value) => now - value < REGISTRATION_WINDOW_MS);
  if (attempts.length >= MAX_REGISTRATION_ATTEMPTS) {
    throw new AppError(429, "Too many registration attempts");
  }
  attempts.push(now);
  registrationAttempts.set(key, attempts);
}

function validateDeepLinkPath(deepLink) {
  const value = String(deepLink || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

function normalizeTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value || "").trim();
}

function formatDueDate(task) {
  const value = task?.due_date || task?.deadline;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function taskAssignedToEmployee(task, employeeId) {
  const assignees = Array.isArray(task?.assignee_ids) ? task.assignee_ids : [];
  return String(task?.assigned_user_id || task?.assigned_to || "").trim() === employeeId
    || String(task?.assigned_to || "").trim() === employeeId
    || assignees.map((value) => String(value).trim()).includes(employeeId);
}

function isDesktopActiveTaskForUser(task, employeeId) {
  const status = String(task?.status || "").trim().toLowerCase();
  const lifecycleStatus = String(task?.lifecycle_status || "").trim().toLowerCase();
  const verificationStatus = String(task?.verification_status || "pending").trim().toLowerCase();
  return taskAssignedToEmployee(task, employeeId)
    && ACTIVE_TASK_REMINDER_STATUSES.has(status)
    && !TERMINAL_TASK_STATUSES.has(status)
    && !["completed", "cancelled"].includes(lifecycleStatus)
    && verificationStatus !== "approved"
    && !task?.approved_at;
}

function listDesktopActiveTasksForUser(user, tasks) {
  const employeeId = String(user?.employee_id || "").trim();
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => isDesktopActiveTaskForUser(task, employeeId))
    .sort((left, right) => new Date(left.due_date || left.deadline || "9999-12-31").getTime() - new Date(right.due_date || right.deadline || "9999-12-31").getTime());
}

function isOverdueTask(task, now = new Date()) {
  const due = task?.due_date || task?.deadline;
  if (!due) return false;
  const dueDate = new Date(due);
  return !Number.isNaN(dueDate.getTime()) && dueDate < now;
}

function isUpdateRequiredTask(task) {
  const status = String(task?.status || "").trim().toLowerCase();
  const verificationStatus = String(task?.verification_status || "").trim().toLowerCase();
  return status === "rework" || status === "update_required" || verificationStatus === "rejected";
}

function taskDisplayName(task) {
  return task?.completion_task_display_name
    || task?.additional_task_kind
    || task?.workflow_stage
    || task?.title
    || `Task #${task?.id}`;
}

function taskStageType(task) {
  return task?.additional_task_kind || task?.workflow_stage || task?.stage || task?.task_type || null;
}

function taskStateVersion(task) {
  const value = task?.updated_at || task?.created_at || task?.assigned_at;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : `task-${task?.id}`;
}

function buildTaskOption(task) {
  return {
    taskId: String(task.id),
    taskName: taskDisplayName(task),
    projectNumber: task.project_no || task.project_name || null,
    fixtureNumber: task.fixture_no || null,
    label: [task.project_no || task.project_name, task.fixture_no, taskDisplayName(task)].filter(Boolean).join(" • "),
  };
}

function summarizeTask(task) {
  return buildTaskOption(task).label;
}

function buildActiveTaskReminderNotification(user, tasks, { now = new Date() } = {}) {
  const activeTasks = listDesktopActiveTasksForUser(user, tasks);
  if (activeTasks.length === 0) return null;

  const overdueCount = activeTasks.filter((task) => isOverdueTask(task, now)).length;
  const updateRequiredCount = activeTasks.filter(isUpdateRequiredTask).length;
  const deepLink = activeTasks.length === 1 ? `/tasks/${activeTasks[0].id}` : "/tasks?status=active";
  if (!validateDeepLinkPath(deepLink)) throw new AppError(500, "Generated active task reminder deep link is invalid");

  return {
    id: now.getTime(),
    eventType: EVENT_TYPES.ACTIVE_TASK_REMINDER,
    entityType: "local",
    entityId: "active-tasks",
    title: `You have ${activeTasks.length} active ${activeTasks.length === 1 ? "task" : "tasks"}`,
    body: "Open My Tasks for details.",
    deepLink,
    priority: overdueCount || updateRequiredCount ? "high" : "normal",
    createdAt: now.toISOString(),
    taskCount: activeTasks.length,
    taskItems: activeTasks.slice(0, 3).map(summarizeTask),
    statusMessage: overdueCount
      ? `${overdueCount} overdue ${overdueCount === 1 ? "task" : "tasks"} need action.`
      : updateRequiredCount
        ? `${updateRequiredCount} update-required ${updateRequiredCount === 1 ? "task" : "tasks"} need action.`
        : "Review My Tasks for details.",
    availableActions: [activeTasks.length === 1 ? "OPEN_TASK" : "OPEN_TASKS"],
  };
}

function buildCurrentTaskSelectionNotification(user, tasks, { now = new Date(), reason = "Choose the task you are working on now." } = {}) {
  const activeTasks = listDesktopActiveTasksForUser(user, tasks).filter((task) => String(task.status || "").toLowerCase() !== "under_review");
  if (activeTasks.length < 2) return null;
  return {
    id: now.getTime() + 1,
    eventType: EVENT_TYPES.CURRENT_TASK_SELECTION,
    entityType: "local",
    entityId: "current-task-selection",
    title: "Which task are you working on now?",
    body: reason,
    deepLink: "/tasks?status=active",
    priority: "high",
    createdAt: now.toISOString(),
    taskCount: activeTasks.length,
    taskItems: activeTasks.slice(0, 3).map(summarizeTask),
    taskOptions: activeTasks.slice(0, 3).map(buildTaskOption),
    statusMessage: reason,
    availableActions: ["OPEN_TASKS"],
  };
}

function buildActiveTaskSyncPayload(user, device, tasks, options = {}) {
  const activeTasks = listDesktopActiveTasksForUser(user, tasks);
  const currentTask = options.currentTask && isDesktopActiveTaskForUser(options.currentTask, String(user.employee_id))
    ? options.currentTask
    : null;
  const includeReminder = options.includeReminder !== false;
  return {
    employeeId: String(user.employee_id),
    backendUserId: String(user.id || user.employee_id),
    deviceId: String(device.device_id),
    deviceRegistered: true,
    activeTaskCount: activeTasks.length,
    currentWorkingTask: currentTask ? buildTaskOption(currentTask) : null,
    tasks: activeTasks,
    notification: includeReminder ? buildActiveTaskReminderNotification(user, activeTasks, options) : null,
    selectionNotification: includeReminder && !currentTask && activeTasks.length > 1
      ? buildCurrentTaskSelectionNotification(user, activeTasks, options)
      : null,
  };
}

function buildTaskAssignedOutboxEvent(task, actorUserId) {
  const taskId = Number(task?.id);
  const assigneeId = String(task?.assigned_user_id || task?.assigned_to || "").trim();
  if (!Number.isInteger(taskId) || !assigneeId) {
    throw new AppError(400, "Task assignment notification requires a task and assignee");
  }
  return {
    eventType: EVENT_TYPES.TASK_ASSIGNED,
    entityType: "task",
    entityId: String(taskId),
    actorUserId: actorUserId || null,
    payload: { task_id: taskId },
    dedupeKey: `task-assigned:${taskId}:${assigneeId}`,
  };
}

async function enqueueTaskAssignedOutbox(task, actorUserId, client = pool) {
  return enqueueOutboxEvent(buildTaskAssignedOutboxEvent(task, actorUserId), client);
}

function buildTaskUpdateRequiredOutboxEvent(task, actorUserId, reason) {
  const taskId = Number(task?.id);
  const assigneeId = String(task?.assigned_user_id || task?.assigned_to || "").trim();
  if (!Number.isInteger(taskId) || !assigneeId) throw new AppError(400, "Update-required notification needs a task and assignee");
  const cycle = Number(task?.rejection_count || 0) + 1;
  return {
    eventType: EVENT_TYPES.TASK_UPDATE_REQUIRED,
    entityType: "task",
    entityId: String(taskId),
    actorUserId: actorUserId || null,
    payload: { task_id: taskId, reason: String(reason || "").trim(), cycle },
    dedupeKey: `task-update-required:${taskId}:${assigneeId}:${cycle}`,
  };
}

async function enqueueTaskUpdateRequiredOutbox(task, actorUserId, reason, client = pool) {
  return enqueueOutboxEvent(buildTaskUpdateRequiredOutboxEvent(task, actorUserId, reason), client);
}

function buildProjectReleasedOutboxEvent({ projectId, actorUserId, releasedAt }) {
  const normalizedProjectId = String(projectId || "").trim();
  const releaseVersion = normalizeTimestamp(releasedAt);
  if (!normalizedProjectId || !releaseVersion) {
    throw new AppError(400, "Project release notification requires a project and release timestamp");
  }
  return {
    eventType: EVENT_TYPES.PROJECT_RELEASED,
    entityType: "project",
    entityId: normalizedProjectId,
    actorUserId: actorUserId || null,
    payload: { project_id: normalizedProjectId, released_at: releaseVersion },
    dedupeKey: `project-released:${normalizedProjectId}:${releaseVersion}`,
  };
}

async function enqueueProjectReleasedOutbox(input, client = pool) {
  return enqueueOutboxEvent(buildProjectReleasedOutboxEvent(input), client);
}
function taskNotificationPayload(task, extra = {}) {
  return {
    taskName: taskDisplayName(task),
    projectNumber: task.project_no || task.project_name || null,
    fixtureNumber: task.fixture_no || null,
    stageType: taskStageType(task),
    dueDate: normalizeTimestamp(task.due_date || task.deadline) || null,
    priority: task.priority || "normal",
    ...extra,
  };
}

function buildTaskAssignedNotification(task, dedupeKey) {
  const dueDate = formatDueDate(task);
  const deepLink = `/tasks/${task.id}`;
  if (!validateDeepLinkPath(deepLink)) throw new AppError(500, "Generated notification deep link is invalid");
  return {
    userId: String(task.assigned_user_id || task.assigned_to).trim(),
    backendUserId: task.backend_user_id || null,
    eventType: EVENT_TYPES.TASK_ASSIGNED,
    entityType: "task",
    entityId: String(task.id),
    title: "Task assigned",
    body: [taskDisplayName(task), task.project_no || task.project_name, task.fixture_no, dueDate ? `Due ${dueDate}` : null].filter(Boolean).join(" • "),
    deepLink,
    priority: task.priority || "normal",
    expiresAt: null,
    dedupeKey,
    payload: taskNotificationPayload(task, { availableActions: ["OPEN_TASK", "START_TASK"] }),
  };
}

function buildTaskUpdateRequiredNotification(task, outboxRow) {
  const deepLink = `/tasks/${task.id}`;
  const reason = String(outboxRow.payload_json?.reason || task.remarks || "Review the requested correction.").trim();
  return {
    userId: String(task.assigned_user_id || task.assigned_to).trim(),
    backendUserId: task.backend_user_id || null,
    eventType: EVENT_TYPES.TASK_UPDATE_REQUIRED,
    entityType: "task",
    entityId: String(task.id),
    title: "Update required",
    body: reason,
    deepLink,
    priority: "high",
    expiresAt: null,
    dedupeKey: outboxRow.dedupe_key,
    payload: taskNotificationPayload(task, {
      rejectionReason: reason,
      statusMessage: reason,
      availableActions: ["OPEN_TASK", "START_CORRECTION"],
    }),
  };
}

function overdueDuration(task, now = new Date()) {
  const due = new Date(task.due_date || task.deadline);
  const minutes = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 60000));
  if (minutes < 24 * 60) return `${Math.max(1, Math.floor(minutes / 60))} hours overdue`;
  const days = Math.floor(minutes / (24 * 60));
  return `${days} ${days === 1 ? "day" : "days"} overdue`;
}

function buildScheduledTaskNotification(task, eventType, outboxRow) {
  const dueDate = formatDueDate(task);
  const overdue = eventType === EVENT_TYPES.TASK_OVERDUE;
  return {
    userId: String(task.assigned_user_id || task.assigned_to).trim(),
    backendUserId: task.backend_user_id || null,
    eventType,
    entityType: "task",
    entityId: String(task.id),
    title: overdue ? "Task overdue" : "Task due today",
    body: overdue ? overdueDuration(task) : "Due today at end of shift",
    deepLink: `/tasks/${task.id}`,
    priority: overdue ? "urgent" : "high",
    expiresAt: null,
    dedupeKey: outboxRow.dedupe_key,
    payload: taskNotificationPayload(task, {
      stateVersion: outboxRow.payload_json?.state_version,
      scheduledLocalDate: outboxRow.payload_json?.local_date,
      scheduleSlot: outboxRow.payload_json?.slot,
      statusMessage: overdue ? `${overdueDuration(task)} • Original due ${dueDate}` : "Due today at end of shift",
      overdueDuration: overdue ? overdueDuration(task) : null,
      availableActions: overdue ? ["OPEN_TASK", "START_TASK"] : ["OPEN_TASK", "REMIND_ME"],
    }),
  };
}

function buildProgressUpdateNotification(task, outboxRow, taskOptions = []) {
  return {
    userId: String(task.user_id || task.assigned_user_id || task.assigned_to).trim(),
    backendUserId: task.backend_user_id || null,
    eventType: EVENT_TYPES.TASK_PROGRESS_UPDATE,
    entityType: "task",
    entityId: String(task.id || task.task_id),
    title: "Task progress update",
    body: "Are you still working on this task?",
    deepLink: `/tasks/${task.id || task.task_id}`,
    priority: "high",
    expiresAt: null,
    dedupeKey: outboxRow.dedupe_key,
    payload: taskNotificationPayload(task, {
      statusMessage: "Are you still working on this task?",
      taskOptions: taskOptions.slice(0, 4),
      availableActions: ["COMPLETE_TASK", "CONTINUE", "SWITCH_TASK"],
    }),
  };
}

function buildProjectReleasedNotification(project, userId, outboxRow, backendUserId = null) {
  const releasedAt = normalizeTimestamp(outboxRow.payload_json?.released_at || project.released_at);
  const deepLink = `/?project_id=${encodeURIComponent(project.project_id)}`;
  const auditDeepLink = `/admin/audit?entity=project&id=${encodeURIComponent(project.project_id)}`;
  if (!validateDeepLinkPath(deepLink) || !validateDeepLinkPath(auditDeepLink)) {
    throw new AppError(500, "Generated project release notification deep link is invalid");
  }
  return {
    userId,
    backendUserId,
    eventType: EVENT_TYPES.PROJECT_RELEASED,
    entityType: "project",
    entityId: String(project.project_id),
    title: "Project released",
    body: `Project: ${project.project_no || project.project_id}`,
    deepLink,
    priority: "high",
    expiresAt: null,
    dedupeKey: `${outboxRow.dedupe_key}:${userId}`,
    payload: {
      projectNumber: project.project_no || null,
      projectName: project.project_name || project.project_no || null,
      customerName: project.customer_name || null,
      releasedByName: project.released_by_name || null,
      releasedAt,
      deepLink,
      auditDeepLink,
      availableActions: ["OPEN_PROJECT", "VIEW_AUDIT"],
    },
  };
}
function indiaDateTimeParts(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function matchingReminderSlot(reminderTimes, now = new Date()) {
  const current = indiaDateTimeParts(now);
  const currentMinutes = current.hour * 60 + current.minute;
  const slot = reminderTimes.find((value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value));
    if (!match) return false;
    const scheduledMinutes = Number(match[1]) * 60 + Number(match[2]);
    return currentMinutes >= scheduledMinutes && currentMinutes < scheduledMinutes + SCHEDULE_MATCH_WINDOW_MINUTES;
  });
  return slot ? { slot: String(slot), localDate: current.date } : null;
}

async function enqueueScheduledDesktopNotificationEvents({ now = new Date() } = {}) {
  const reminderTimes = await getDailyReminderTimes();
  const match = matchingReminderSlot(reminderTimes, now);
  let scheduled = 0;
  if (match) {
    const candidates = await listDesktopReminderCandidates();
    for (const task of candidates) {
      const dueValue = task.due_date || task.deadline;
      const dueDate = new Date(dueValue);
      if (Number.isNaN(dueDate.getTime())) continue;
      const dueLocalDate = indiaDateTimeParts(dueDate).date;
      if (dueLocalDate > match.localDate) continue;
      const eventType = dueLocalDate === match.localDate ? EVENT_TYPES.TASK_DUE_TODAY : EVENT_TYPES.TASK_OVERDUE;
      const stateVersion = taskStateVersion(task);
      const row = await enqueueOutboxEvent({
        eventType,
        entityType: "task",
        entityId: String(task.id),
        actorUserId: null,
        payload: { task_id: task.id, local_date: match.localDate, slot: match.slot, state_version: stateVersion },
        dedupeKey: `scheduled:${eventType}:${task.id}:${match.localDate}:${match.slot}:${stateVersion}`,
      });
      if (row) scheduled += 1;
    }
  }

  const progressChecks = await listDueCurrentTaskChecks(now);
  for (const task of progressChecks) {
    const dueVersion = normalizeTimestamp(task.progress_due_at);
    const row = await enqueueOutboxEvent({
      eventType: EVENT_TYPES.TASK_PROGRESS_UPDATE,
      entityType: "task",
      entityId: String(task.task_id || task.id),
      actorUserId: null,
      payload: { task_id: task.task_id || task.id, user_id: task.user_id, selected_at: normalizeTimestamp(task.selected_at), progress_due_at: dueVersion },
      dedupeKey: `task-progress:${task.task_id || task.id}:${dueVersion}`,
    });
    if (row) scheduled += 1;
  }

  const selectionRows = await listUsersNeedingCurrentTaskSelection();
  const selectionsByEmployee = new Map();
  for (const row of selectionRows) {
    const employeeId = String(row.employee_id);
    if (!selectionsByEmployee.has(employeeId)) selectionsByEmployee.set(employeeId, []);
    selectionsByEmployee.get(employeeId).push(row);
  }
  for (const [employeeId, rows] of selectionsByEmployee) {
    const signature = crypto.createHash("sha256").update(rows.map((row) => `${row.id}:${taskStateVersion(row)}`).join("|")).digest("hex").slice(0, 20);
    const row = await enqueueOutboxEvent({
      eventType: EVENT_TYPES.CURRENT_TASK_SELECTION,
      entityType: "user",
      entityId: employeeId,
      actorUserId: null,
      payload: { task_ids: rows.map((task) => task.id), state_signature: signature },
      dedupeKey: `current-task-selection:${employeeId}:${signature}`,
    });
    if (row) scheduled += 1;
  }

  return { scheduled, reminderSlot: match?.slot || null };
}

async function buildActiveTaskSyncForDevice(user, device, tasks, { loginSessionId, now = new Date() } = {}) {
  const includeReminder = await claimLoginSummarySession(device.device_id, loginSessionId);
  const currentTask = await getCurrentTaskForUser(device.user_id);
  return buildActiveTaskSyncPayload(user, device, tasks, { now, currentTask, includeReminder });
}

async function registerDeviceFromCredentials(payload, { ipAddress = "unknown" } = {}) {
  const employeeId = String(payload?.employeeId || payload?.employee_id || "").trim();
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!employeeId || !password) {
    throw new AppError(400, "Employee ID and password are required");
  }

  assertRegistrationRateLimit(employeeId, ipAddress);
  const { user } = await loginUser(employeeId, password);
  const deviceId = normalizeDeviceId(payload?.deviceId || payload?.device_id);
  const deviceToken = generateDeviceToken();
  const device = await registerDesktopDevice({
    deviceId,
    userId: user.employee_id,
    deviceName: String(payload?.deviceName || payload?.device_name || "PARC Notify").trim().slice(0, 120) || "PARC Notify",
    windowsUsername: String(payload?.windowsUsername || payload?.windows_username || "").trim().slice(0, 160) || null,
    tokenHash: hashDeviceToken(deviceToken),
    agentVersion: String(payload?.agentVersion || payload?.agent_version || "").trim().slice(0, 40) || null,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "desktop_notification_device_registered",
    targetType: "desktop_notification_device",
    targetId: device.device_id,
    metadata: {
      device_name: device.device_name,
      windows_username: device.windows_username,
      agent_version: device.agent_version,
    },
  });

  return {
    deviceId: device.device_id,
    deviceToken,
    user: {
      id: user.employee_id,
      employeeId: user.employee_id,
      backendUserId: user.id || user.employee_id,
      name: user.name,
    },
  };
}

async function authenticateDesktopDevice({ deviceId, token, agentVersion }) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    throw new AppError(401, "Device token is required");
  }

  const device = await findDeviceByDeviceId(normalizedDeviceId);
  if (!device || device.enabled === false || device.revoked_at) {
    throw new AppError(401, "Device is not registered");
  }
  if (!safeTokenEqual(device.token_hash, rawToken)) {
    throw new AppError(401, "Invalid device token");
  }

  return touchDeviceConnected(normalizedDeviceId, agentVersion || null);
}

async function revokeAuthenticatedDevice(device) {
  const revoked = await revokeDevice(device.device_id, device.user_id);
  if (revoked) {
    await createAuditLog({
      userEmployeeId: device.user_id,
      actionType: "desktop_notification_device_revoked",
      targetType: "desktop_notification_device",
      targetId: device.device_id,
      metadata: { source: "device" },
    });
  }
  return revoked;
}

async function createTestNotificationForDevice(device) {
  const notification = await createDesktopNotification({
    userId: device.user_id,
    eventType: "TEST_NOTIFICATION",
    entityType: "device",
    entityId: device.device_id,
    title: "PARC Notify test",
    body: "This computer can receive PARC Task Tracker notifications.",
    deepLink: "/tasks",
    priority: "normal",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    dedupeKey: `desktop-test:${device.device_id}:${Date.now()}`,
    deviceId: device.device_id,
  });
  await notifyDesktopNotification({ ...notification, userId: device.user_id });
  return notification;
}

async function processTaskAssignedOutbox(outboxRow, client) {
  const taskId = Number(outboxRow.entity_id);
  if (!Number.isInteger(taskId)) {
    throw new AppError(400, "Invalid task id in notification outbox");
  }

  const task = await findTaskById(taskId, client);
  if (!task || ["closed", "completed", "cancelled"].includes(String(task.status || "").toLowerCase())) {
    return null;
  }

  const recipientUserId = String(task.assigned_user_id || task.assigned_to || "").trim();
  if (!recipientUserId) return null;

  const recipient = await findUserByEmployeeId(recipientUserId, client);
  if (!recipient || recipient.is_active === false || !canAccessTask(recipient, task)) {
    throw new AppError(403, "Resolved notification recipient cannot access task");
  }

  const notification = await createDesktopNotification(buildTaskAssignedNotification({ ...task, backend_user_id: recipient.id }, outboxRow.dedupe_key), client);
  await notifyDesktopNotification({ ...notification, userId: recipientUserId }, client);
  return notification;
}

async function processTaskEventOutbox(outboxRow, client) {
  const taskId = Number(outboxRow.entity_id);
  const task = Number.isInteger(taskId) ? await findTaskById(taskId, client) : null;
  if (!task || ["closed", "completed", "cancelled"].includes(String(task.status || "").toLowerCase())) return null;
  if (outboxRow.payload_json?.state_version && taskStateVersion(task) !== outboxRow.payload_json.state_version) return null;

  const recipientUserId = String(task.assigned_user_id || task.assigned_to || "").trim();
  const recipient = recipientUserId ? await findUserByEmployeeId(recipientUserId, client) : null;
  if (!recipient || recipient.is_active === false || !canAccessTask(recipient, task)) return null;
  const enrichedTask = { ...task, backend_user_id: recipient.id };
  const notification = outboxRow.event_type === EVENT_TYPES.TASK_UPDATE_REQUIRED
    ? buildTaskUpdateRequiredNotification(enrichedTask, outboxRow)
    : buildScheduledTaskNotification(enrichedTask, outboxRow.event_type, outboxRow);
  const created = await createDesktopNotification(notification, client);
  await notifyDesktopNotification({ ...created, userId: recipientUserId }, client);
  return created;
}

async function processProgressUpdateOutbox(outboxRow, client) {
  const task = await getCurrentTaskForUser(String(outboxRow.payload_json?.user_id || ""), client)
    || await findTaskById(Number(outboxRow.entity_id), client);
  if (!task || Number(task.task_id || task.id) !== Number(outboxRow.entity_id)) return null;
  if (outboxRow.payload_json?.selected_at && normalizeTimestamp(task.selected_at) !== outboxRow.payload_json.selected_at) return null;
  const taskOptions = [];
  for (const taskId of await listActiveTaskIdsForUser(String(task.user_id || task.assigned_user_id || task.assigned_to), client)) {
    const candidate = await findTaskById(taskId, client);
    if (candidate && isDesktopActiveTaskForUser(candidate, String(task.user_id || task.assigned_user_id || task.assigned_to))) taskOptions.push(buildTaskOption(candidate));
    if (taskOptions.length >= 4) break;
  }
  const notification = await createDesktopNotification(buildProgressUpdateNotification(task, outboxRow, taskOptions), client);
  await notifyDesktopNotification({ ...notification, userId: task.user_id || task.assigned_user_id || task.assigned_to }, client);
  return notification;
}

async function processCurrentTaskSelectionOutbox(outboxRow, client) {
  const employeeId = String(outboxRow.entity_id || "").trim();
  const user = await findUserByEmployeeId(employeeId, client);
  if (!user || user.is_active === false || await getCurrentTaskForUser(employeeId, client)) return null;
  const tasks = [];
  for (const taskId of outboxRow.payload_json?.task_ids || []) {
    const task = await findTaskById(Number(taskId), client);
    if (task && isDesktopActiveTaskForUser(task, employeeId)) tasks.push(task);
  }
  const local = buildCurrentTaskSelectionNotification(user, tasks, { reason: "Choose the task you are working on now." });
  if (!local) return null;
  const notification = await createDesktopNotification({
    ...local,
    userId: employeeId,
    backendUserId: user.id,
    entityType: "user",
    entityId: employeeId,
    dedupeKey: outboxRow.dedupe_key,
    payload: local,
  }, client);
  await notifyDesktopNotification({ ...notification, userId: employeeId }, client);
  return notification;
}

function buildOverdueEscalationNotification(task, employee, recipient, outboxRow) {
  const duration = overdueDuration(task);
  return {
    userId: String(recipient.employee_id),
    backendUserId: recipient.id,
    eventType: EVENT_TYPES.TASK_OVERDUE_EXECUTIVE_ESCALATION,
    entityType: "task",
    entityId: String(task.id),
    title: "Overdue escalation",
    body: `${employee.name} (${employee.employee_id}) • ${duration}`,
    deepLink: `/tasks/${task.id}`,
    priority: "urgent",
    expiresAt: null,
    dedupeKey: `${outboxRow.dedupe_key}:${recipient.employee_id}`,
    payload: taskNotificationPayload(task, {
      employeeName: employee.name,
      employeeNumber: employee.employee_id,
      overdueDuration: duration,
      statusMessage: "2 reminders delivered • Employee action pending",
      availableActions: ["OPEN_TASK", "VIEW_DETAILS"],
    }),
  };
}

async function processOverdueEscalationOutbox(outboxRow, client) {
  const task = await findTaskById(Number(outboxRow.entity_id), client);
  if (!task || taskStateVersion(task) !== outboxRow.payload_json?.state_version || !isOverdueTask(task)) return [];
  const employeeId = String(task.assigned_user_id || task.assigned_to || "").trim();
  const employee = await findUserByEmployeeId(employeeId, client);
  if (!employee) return [];
  const recipients = await listUsersWithPermission(PERMISSIONS.RECEIVE_EXECUTIVE_DESKTOP_NOTIFICATIONS, client);
  const notifications = [];
  for (const recipient of recipients) {
    if (!recipient.employee_id || String(recipient.employee_id) === employeeId) continue;
    const notification = await createDesktopNotification(buildOverdueEscalationNotification(task, employee, recipient, outboxRow), client);
    await notifyDesktopNotification({ ...notification, userId: recipient.employee_id }, client);
    notifications.push(notification);
  }
  return notifications;
}

async function processProjectReleasedOutbox(outboxRow, client) {
  const project = await getProjectReleasedNotificationContext(outboxRow.entity_id, outboxRow.actor_user_id, client);
  if (!project) return [];

  const recipients = await listUsersWithPermission(PERMISSIONS.RECEIVE_EXECUTIVE_DESKTOP_NOTIFICATIONS, client);
  const notifications = [];
  for (const recipient of recipients) {
    const userId = String(recipient.employee_id || "").trim();
    if (!userId) continue;
    const notification = await createDesktopNotification(buildProjectReleasedNotification(project, userId, outboxRow, recipient.id), client);
    await notifyDesktopNotification({ ...notification, userId }, client);
    notifications.push(notification);
  }
  return notifications;
}
async function processOutboxRow(outboxRow, client) {
  if (outboxRow.event_type === EVENT_TYPES.TASK_ASSIGNED && outboxRow.entity_type === "task") return processTaskAssignedOutbox(outboxRow, client);
  if ([EVENT_TYPES.TASK_UPDATE_REQUIRED, EVENT_TYPES.TASK_DUE_TODAY, EVENT_TYPES.TASK_OVERDUE].includes(outboxRow.event_type)) return processTaskEventOutbox(outboxRow, client);
  if (outboxRow.event_type === EVENT_TYPES.TASK_PROGRESS_UPDATE) return processProgressUpdateOutbox(outboxRow, client);
  if (outboxRow.event_type === EVENT_TYPES.CURRENT_TASK_SELECTION) return processCurrentTaskSelectionOutbox(outboxRow, client);
  if (outboxRow.event_type === EVENT_TYPES.TASK_OVERDUE_EXECUTIVE_ESCALATION) return processOverdueEscalationOutbox(outboxRow, client);
  if (outboxRow.event_type === EVENT_TYPES.PROJECT_RELEASED && outboxRow.entity_type === "project") return processProjectReleasedOutbox(outboxRow, client);
  return null;
}

async function processDesktopNotificationOutboxBatch({ limit = 25 } = {}) {
  let processed = 0;
  let failed = 0;

  while (processed + failed < limit) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await claimPendingOutbox(1, client);
      if (rows.length === 0) {
        await client.query("COMMIT");
        break;
      }

      try {
        await processOutboxRow(rows[0], client);
        await markOutboxProcessed(rows[0].id, client);
        processed += 1;
      } catch (error) {
        await markOutboxFailed(rows[0].id, error, client);
        failed += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return { processed, failed };
}

function startDesktopNotificationWorker({ intervalMs = 2000 } = {}) {
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      await enqueueScheduledDesktopNotificationEvents();
      await processDesktopNotificationOutboxBatch();
    } catch (error) {
      console.error("[desktop-notifications] worker tick failed", error?.message || error);
    } finally {
      running = false;
    }
  }

  const interval = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

async function recordDelivered(device, notificationId, deliveredAt) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const delivery = await markDeliveryReceived(notificationId, device.device_id, deliveredAt || new Date(), client);
    const notification = delivery ? await getNotificationById(notificationId, client) : null;
    if (notification?.eventType === EVENT_TYPES.TASK_OVERDUE && notification.stateVersion) {
      const task = await findTaskById(Number(notification.entityId), client);
      if (task && taskStateVersion(task) === notification.stateVersion) {
        const deliveredCount = await countDeliveredOverdueReminders(task.id, notification.stateVersion, client);
        if (deliveredCount >= 2) {
          await enqueueOutboxEvent({
            eventType: EVENT_TYPES.TASK_OVERDUE_EXECUTIVE_ESCALATION,
            entityType: "task",
            entityId: String(task.id),
            actorUserId: null,
            payload: { task_id: task.id, state_version: notification.stateVersion, delivered_count: deliveredCount },
            dedupeKey: `overdue-escalation:${task.id}:${notification.stateVersion}`,
          }, client);
        }
      }
    }
    await client.query("COMMIT");
    return delivery;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordDisplayed(device, notificationId, displayedAt) {
  return markDeliveryDisplayed(notificationId, device.device_id, displayedAt || new Date());
}

async function recordClicked(device, notificationId, clickedAt) {
  return markDeliveryAcknowledged(notificationId, device.device_id, clickedAt || new Date());
}

async function recordActioned(device, notificationId, actionType, actionedAt) {
  return markDeliveryActioned(notificationId, device.device_id, actionType, actionedAt || new Date());
}

async function snoozeNotification(device, notificationId) {
  const snoozedUntil = new Date(Date.now() + 30 * 60 * 1000);
  const delivery = await markDeliverySnoozed(notificationId, device.device_id, snoozedUntil);
  if (!delivery) throw new AppError(404, "Notification delivery not found");
  return { notificationId: Number(notificationId), snoozedUntil };
}

async function continueCurrentTask(device, taskId, notificationId = null) {
  const current = await continueCurrentTaskForUser(device.user_id, Number(taskId));
  if (!current) throw new AppError(409, "This task is not the current working task");
  if (Number.isInteger(Number(notificationId)) && Number(notificationId) > 0) {
    await recordActioned(device, Number(notificationId), "continue");
  }
  return current;
}

async function markTaskAsCurrent(device, taskId) {
  const selected = await selectCurrentTaskForUser(device.user_id, Number(taskId));
  if (!selected) throw new AppError(409, "Start the assigned task before selecting it as current");
  return getCurrentTaskForUser(device.user_id);
}

async function markSentToDevice(device, notificationId) {
  return markDeliverySent(notificationId, device.device_id);
}

async function listPendingForDevice(device, limit = 100) {
  return listPendingNotificationsForDevice({ userId: device.user_id, deviceId: device.device_id, limit });
}

module.exports = {
  EVENT_TYPES,
  authenticateDesktopDevice,
  buildActiveTaskReminderNotification,
  buildActiveTaskSyncForDevice,
  buildActiveTaskSyncPayload,
  buildCurrentTaskSelectionNotification,
  buildProjectReleasedNotification,
  buildProjectReleasedOutboxEvent,
  buildScheduledTaskNotification,
  buildTaskAssignedOutboxEvent,
  buildTaskUpdateRequiredOutboxEvent,
  continueCurrentTask,
  createTestNotificationForDevice,
  enqueueProjectReleasedOutbox,
  enqueueScheduledDesktopNotificationEvents,
  enqueueTaskAssignedOutbox,
  enqueueTaskUpdateRequiredOutbox,
  generateDeviceToken,
  hashDeviceToken,
  indiaDateTimeParts,
  isDesktopActiveTaskForUser,
  listDesktopActiveTasksForUser,
  listPendingForDevice,
  markSentToDevice,
  markTaskAsCurrent,
  matchingReminderSlot,
  processDesktopNotificationOutboxBatch,
  processProjectReleasedOutbox,
  recordActioned,
  recordClicked,
  recordDelivered,
  recordDisplayed,
  registerDeviceFromCredentials,
  revokeAuthenticatedDevice,
  safeTokenEqual,
  snoozeNotification,
  startDesktopNotificationWorker,
  validateDeepLinkPath,
};
