const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  acknowledgeNotification,
  listCurrentUserOverdueAlerts,
  listTeamOverdueAlerts,
} = require("../services/overdueNotificationService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/notifications/overdue/me",
  asyncHandler(async (req, res) => {
    const alerts = await listCurrentUserOverdueAlerts(req.user);
    return sendSuccess(res, alerts);
  }),
);

router.get(
  "/notifications/overdue/team",
  asyncHandler(async (req, res) => {
    const alerts = await listTeamOverdueAlerts(req.user);
    return sendSuccess(res, alerts);
  }),
);

router.post(
  "/notifications/:id/acknowledge",
  asyncHandler(async (req, res) => {
    const notification = await acknowledgeNotification(req.user, req.params.id);
    return sendSuccess(res, notification);
  }),
);

module.exports = {
  notificationRoutes: router,
};