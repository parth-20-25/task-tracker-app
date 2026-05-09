const express = require("express");
const { asyncHandler } = require("../../lib/asyncHandler");
const { sendSuccess } = require("../../lib/response");
const { authenticate } = require("../../middleware/authenticate");
const { getDeadlineHonesty } = require("../../services/analyticsCoreService");

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/analytics/deadline-honesty
 *
 * Returns planning accuracy metrics: error distribution, credibility score,
 * delay origin by stage, and per-designer planning behaviour.
 *
 * Query params:
 *   projectId – filter to a project
 */
router.get("/deadline-honesty", asyncHandler(async (req, res) => {
  const { projectId, departmentId, userId, startDate, endDate } = req.query;
  const filters = { projectId, departmentId, userId, startDate, endDate };
  const data = await getDeadlineHonesty(filters, req.user);
  return sendSuccess(res, data);
}));

module.exports = router;
