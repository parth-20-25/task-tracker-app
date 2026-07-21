const crypto = require("crypto");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { PERMISSIONS } = require("../config/constants");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  claimPendingOutbox,
  createDesktopNotification,
  enqueueOutboxEvent,
  findDeviceByDeviceId,
  getProjectReleasedNotificationContext,
  listPendingNotificationsForDevice,
  listUsersWithPermission,
  markDeliveryAcknowledged,
  markDeliveryDisplayed,
  markDeliverySent,
  markOutboxFailed,
  markOutboxProcessed,
  notifyDesktopNotification,
  registerDesktopDevice,
  revokeDevice,
  touchDeviceConnected,
} = require("../repositories/desktopNotificationRepository");
const { findTaskById } = require("../repositories/tasksRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const { canAccessTask } = require("./accessControlService");
const { loginUser } = require("./authService");

const EVENT_TYPES = {
  TASK_ASSIGNED: "TASK_ASSIGNED",
  PROJECT_RELEASED: "PROJECT_RELEASED",
};

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
function buildTaskAssignedNotification(task, dedupeKey) {
  const dueDate = formatDueDate(task);
  const title = `${task.title || task.workflow_stage || `Task #${task.id}`} assigned`;
  const bodyParts = [task.project_no || task.project_name, task.fixture_no, dueDate ? `Due ${dueDate}` : null]
    .filter(Boolean);
  const deepLink = `/tasks/${task.id}`;
  if (!validateDeepLinkPath(deepLink)) {
    throw new AppError(500, "Generated notification deep link is invalid");
  }
  return {
    userId: String(task.assigned_user_id || task.assigned_to).trim(),
    eventType: EVENT_TYPES.TASK_ASSIGNED,
    entityType: "task",
    entityId: String(task.id),
    title,
    body: bodyParts.join(" - ") || "A task was assigned to you.",
    deepLink,
    priority: "normal",
    expiresAt: null,
    dedupeKey,
  };
}

function buildProjectReleasedNotification(project, userId, outboxRow) {
  const releasedAt = normalizeTimestamp(outboxRow.payload_json?.released_at || project.released_at);
  const deepLink = `/?project_id=${encodeURIComponent(project.project_id)}`;
  const auditDeepLink = `/admin/audit?entity=project&id=${encodeURIComponent(project.project_id)}`;
  if (!validateDeepLinkPath(deepLink) || !validateDeepLinkPath(auditDeepLink)) {
    throw new AppError(500, "Generated project release notification deep link is invalid");
  }
  return {
    userId,
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

  const notification = await createDesktopNotification(buildTaskAssignedNotification(task, outboxRow.dedupe_key), client);
  await notifyDesktopNotification({ ...notification, userId: recipientUserId }, client);
  return notification;
}

async function processProjectReleasedOutbox(outboxRow, client) {
  const project = await getProjectReleasedNotificationContext(outboxRow.entity_id, outboxRow.actor_user_id, client);
  if (!project) return [];

  const recipients = await listUsersWithPermission(PERMISSIONS.RECEIVE_EXECUTIVE_DESKTOP_NOTIFICATIONS, client);
  const notifications = [];
  for (const recipient of recipients) {
    const userId = String(recipient.employee_id || "").trim();
    if (!userId) continue;
    const notification = await createDesktopNotification(buildProjectReleasedNotification(project, userId, outboxRow), client);
    await notifyDesktopNotification({ ...notification, userId }, client);
    notifications.push(notification);
  }
  return notifications;
}
async function processOutboxRow(outboxRow, client) {
  if (outboxRow.event_type === EVENT_TYPES.TASK_ASSIGNED && outboxRow.entity_type === "task") {
    return processTaskAssignedOutbox(outboxRow, client);
  }
  if (outboxRow.event_type === EVENT_TYPES.PROJECT_RELEASED && outboxRow.entity_type === "project") {
    return processProjectReleasedOutbox(outboxRow, client);
  }
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

async function recordDisplayed(device, notificationId, displayedAt) {
  return markDeliveryDisplayed(notificationId, device.device_id, displayedAt || new Date());
}

async function recordClicked(device, notificationId, clickedAt) {
  return markDeliveryAcknowledged(notificationId, device.device_id, clickedAt || new Date());
}

async function markSentToDevice(device, notificationId) {
  return markDeliverySent(notificationId, device.device_id);
}

async function listPendingForDevice(device, limit = 100) {
  return listPendingNotificationsForDevice({ userId: device.user_id, deviceId: device.device_id, limit });
}

module.exports = {
  authenticateDesktopDevice,
  buildTaskAssignedOutboxEvent,
  buildProjectReleasedNotification,
  buildProjectReleasedOutboxEvent,
  createTestNotificationForDevice,
  enqueueTaskAssignedOutbox,
  enqueueProjectReleasedOutbox,
  generateDeviceToken,
  hashDeviceToken,
  listPendingForDevice,
  markSentToDevice,
  processDesktopNotificationOutboxBatch,
  processProjectReleasedOutbox,
  recordClicked,
  recordDisplayed,
  registerDeviceFromCredentials,
  revokeAuthenticatedDevice,
  safeTokenEqual,
  startDesktopNotificationWorker,
  validateDeepLinkPath,
};
