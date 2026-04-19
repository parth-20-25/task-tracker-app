const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { listNotifications, markRead } = require("../services/notificationService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/notifications",
  asyncHandler(async (req, res) => sendSuccess(res, await listNotifications(req.user))),
);

router.patch(
  "/notifications/:notificationId/read",
  asyncHandler(async (req, res) => sendSuccess(res, await markRead(req.user, req.params.notificationId))),
);

module.exports = {
  notificationRoutes: router,
};
