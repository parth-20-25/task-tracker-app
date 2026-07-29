const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  getProjectPlannedTimeForUser,
  listPendingProjectPlanningForUser,
  listProjectScopeForUser,
  saveProjectPlannedTimeForUser,
} = require("../services/projectScopeService");

const router = express.Router();
router.use(authenticate);

router.get("/project-scope", asyncHandler(async (req, res) => {
  sendSuccess(res, await listProjectScopeForUser(req.user));
}));

router.get("/project-planning/pending", asyncHandler(async (req, res) => {
  sendSuccess(res, await listPendingProjectPlanningForUser(req.user));
}));

router.get("/projects/:projectId/planned-time", asyncHandler(async (req, res) => {
  sendSuccess(res, await getProjectPlannedTimeForUser(req.user, req.params.projectId));
}));

router.patch("/projects/:projectId/planned-time", asyncHandler(async (req, res) => {
  sendSuccess(res, await saveProjectPlannedTimeForUser(req.user, req.params.projectId, req.body));
}));

module.exports = { projectScopeRoutes: router };