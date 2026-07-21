const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const {
  authenticateDesktopDevice,
  createTestNotificationForDevice,
  registerDeviceFromCredentials,
  revokeAuthenticatedDevice,
} = require("../services/desktopNotificationService");
const {
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

router.post(
  "/desktop-notifications/tasks/:taskId/start",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const result = await startTaskFromDesktopNotification(req.desktopDevice, req.params.taskId);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/desktop-notifications/tasks/:taskId/start-correction",
  authenticateDesktopDeviceRequest,
  asyncHandler(async (req, res) => {
    const result = await startCorrectionFromDesktopNotification(req.desktopDevice, req.params.taskId);
    return sendSuccess(res, result);
  }),
);

module.exports = {
  desktopNotificationRoutes: router,
  authenticateDesktopDeviceRequest,
};
