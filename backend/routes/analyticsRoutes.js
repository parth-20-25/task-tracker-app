const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  getDepartmentPerformanceRankings,
  getPerformanceAnalyticsContext,
  getPerformanceOverview,
  getUserPerformanceDrilldown,
  getUserPerformanceRankings,
} = require("../services/performanceAnalyticsService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/analytics",
  asyncHandler(async (req, res) => sendSuccess(res, await getPerformanceAnalyticsContext(req.user))),
);

router.get(
  "/analytics/context",
  asyncHandler(async (req, res) => sendSuccess(res, await getPerformanceAnalyticsContext(req.user))),
);

// Replaced by new unified overview route

router.get(
  "/analytics/users",
  asyncHandler(async (req, res) => sendSuccess(res, await getUserPerformanceRankings(req.user, req.query))),
);

router.get(
  "/analytics/user/:id",
  asyncHandler(async (req, res) => sendSuccess(res, await getUserPerformanceDrilldown(req.user, req.params.id))),
);

router.get(
  "/analytics/departments",
  asyncHandler(async (req, res) => sendSuccess(res, await getDepartmentPerformanceRankings(req.user, req.query))),
);

module.exports = {
  analyticsRoutes: router,
};
