const express = require("express");
const { asyncHandler } = require("../../lib/asyncHandler");
const { sendSuccess } = require("../../lib/response");
const { authenticate } = require("../../middleware/authenticate");
const { getUserPerformance } = require("../../services/analyticsCoreService");

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/analytics/user-performance
 * Returns user performance across 4 dimensions: Throughput, Efficiency, Quality, Reliability.
 */
router.get("/user-performance", asyncHandler(async (req, res) => {
  const { scopeId, projectId, departmentId } = req.query;
  const filters = { scopeId, projectId, departmentId: departmentId || req.user.department_id };
  const data = await getUserPerformance(filters, req.user);
  return sendSuccess(res, data);
}));

module.exports = router;
