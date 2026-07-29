const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const {
  authenticateDesktopDevice,
  buildActiveTaskSyncPayload,
  continueCurrentTask,
  createTestNotificationForDevice,
  registerDeviceFromCredentials,
  revokeAuthenticatedDevice,
  snoozeNotification,
} = require("../services/desktopNotificationService");
const { getAuthenticatedUser } = require("../services/authService");
const { listTasksForUser } = require("../services/taskService");
const {
  selectCurrentTaskFromDesktopNotification,
  startCorrectionFromDesktopNotification,
  startTaskFromDesktopNotification,
} = require("../services/desktopNotificationActionService");

const router = express.Router();

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = String(header).split(" ");
  return scheme === "Bearer" ? token : "";
}

async function authenticateDesktopDeviceRequest(req, _res, next) {
  try {
    req.desktopDevice = await authenticateDesktopDevice({
      deviceId: req.headers["x-parc-device-id"],
      token: getBearerToken(req),
      agentVersion: req.headers["x-parc-agent-version"],
    });
    return next();
  } catch (error) {
    return next(error);
  }
}

router.post(
  "/desktop-notification-devices/register",
  asyncHandler(async (req, res) => {
    const result = await registerDeviceFromCredentials(req.body || {}, { ipAddress: req.ip || "unknown" });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/desktop-notification-devices/revoke-current",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const device = await revokeAuthenticatedDevice(req.desktopDevice);
    return sendSuccess(res, { revoked: Boolean(device), deviceId: req.desktopDevice.device_id });
  }),
);

router.post(
  "/desktop-notification-devices/test",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const notification = await createTestNotificationForDevice(req.desktopDevice);
    return sendSuccess(res, { notification });
  }),
);

router.get(
  "/desktop-notification-devices/active-tasks",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const user = await getAuthenticatedUser(req.desktopDevice.user_id);
    const data = buildActiveTaskSyncPayload(user, req.desktopDevice, await listTasksForUser(user));
    return sendSuccess(res, data);
  }),
);

router.post(
  "/desktop-notifications/tasks/:taskId/start",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const result = await startTaskFromDesktopNotification(req.desktopDevice, req.params.taskId, req.body?.notificationId);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/desktop-notifications/tasks/:taskId/start-correction",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const result = await startCorrectionFromDesktopNotification(req.desktopDevice, req.params.taskId, req.body?.notificationId);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/desktop-notifications/tasks/:taskId/select-current",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const result = await selectCurrentTaskFromDesktopNotification(req.desktopDevice, req.params.taskId, req.body?.notificationId);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/desktop-notifications/tasks/:taskId/continue",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const result = await continueCurrentTask(req.desktopDevice, req.params.taskId, req.body?.notificationId);
    return sendSuccess(res, { taskId: Number(req.params.taskId), nextCheckAt: result.progress_due_at });
  }),
);

router.post(
  "/desktop-notifications/:notificationId/snooze",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => sendSuccess(res, await snoozeNotification(req.desktopDevice, req.params.notificationId))),
);

module.exports = {
  desktopNotificationRoutes: router,
  authenticateDesktopDeviceRequest,
};
