const express = require("express");
const { asyncHandler } = require("../../lib/asyncHandler");
const { sendSuccess } = require("../../lib/response");
const { authenticate } = require("../../middleware/authenticate");
const { getWorkflowHealth } = require("../../services/analyticsCoreService");

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/analytics/workflow-health
 *
 * Returns the composite Workflow Health Score — a system integrity signal
 * derived from four behavioral pillars: Efficiency, Quality, Reliability,
 * and Stability. All computation is backend-only; no raw metrics are hidden.
 *
 * Query params:
 *   scopeId   – filter to a single scope
 *   projectId – filter to a project (all scopes)
 */
router.get("/workflow-health", asyncHandler(async (req, res) => {
  const { scopeId, projectId, departmentId, userId, startDate, endDate } = req.query;
  const filters = { scopeId, projectId, departmentId, userId, startDate, endDate };
  const data = await getWorkflowHealth(filters, req.user);
  return sendSuccess(res, data);
}));

module.exports = router;
