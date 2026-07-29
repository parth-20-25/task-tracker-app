const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { requirePermission } = require("../middleware/requirePermission");
const { listTeamActivity } = require("../services/teamActivityService");

const router = express.Router();

router.get(
  "/team-activity",
  authenticate,
  requirePermission(PERMISSIONS.VIEW_TEAM_ACTIVITY),
  asyncHandler(async (req, res) => sendSuccess(res, await listTeamActivity(req.user))),
);

module.exports = {
  teamActivityRoutes: router,
};
