const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { getAnalyticsForUser } = require("../services/analyticsService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/analytics",
  authorize("can_view_all_tasks"),
  asyncHandler(async (req, res) => sendSuccess(res, await getAnalyticsForUser(req.user))),
);

module.exports = {
  analyticsRoutes: router,
};
