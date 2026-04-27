const express = require("express");
const { asyncHandler } = require("../../lib/asyncHandler");
const { sendSuccess } = require("../../lib/response");
const { authenticate } = require("../../middleware/authenticate");
const { buildPredictiveInsights } = require("../../services/predictiveAnalyticsService");

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/analytics/predictive-insights
 *
 * Returns predictive analytics for active (in-progress) fixtures:
 *  - predicted completion time
 *  - delay risk score (0–1) with classification (LOW/MEDIUM/HIGH)
 *  - rework probability (0–1)
 *  - risk reasons
 *  - model metadata and accuracy tracking
 *
 * All predictions are derived from the unified analytics dataset with
 * zero hardcoded values. Cross-references signals from all 6 analytics
 * modules: Rework Intelligence, Deadline Reliability, Stage Efficiency,
 * Designer Performance, Workflow Health, and the Analytics Overview.
 *
 * Query params:
 *   scopeId   – filter to a single scope
 *   projectId – filter to a project (all scopes)
 */
router.get(
  "/predictive-insights",
  asyncHandler(async (req, res) => {
    const { scopeId, projectId, departmentId } = req.query;
    const filters = { scopeId, projectId, departmentId: departmentId || req.user.department_id };
    const data = await buildPredictiveInsights(filters, req.user);
    return sendSuccess(res, data);
  })
);

module.exports = router;
