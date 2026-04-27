const express = require("express");
const { asyncHandler } = require("../../lib/asyncHandler");
const { sendSuccess } = require("../../lib/response");
const { authenticate } = require("../../middleware/authenticate");
const { getAnalyticsOverview } = require("../../services/analyticsCoreService");

const router = express.Router();

router.use(authenticate);

router.get("/overview", asyncHandler(async (req, res) => {
  const { departmentId, userId, scopeId, projectId } = req.query;
  const filters = {
    departmentId: departmentId,
    userId: userId,
    scopeId,
    projectId
  };
  
  const analyticsData = await getAnalyticsOverview(filters, req.user);
  return sendSuccess(res, analyticsData);
}));

module.exports = router;
