const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { asyncHandler } = require("../lib/asyncHandler");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { buildReport, exportTaskReport, listTaskReportRows, listWorkflowCompletionSummary } = require("../services/reportService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/reports/tasks",
  authorize(PERMISSIONS.VIEW_REPORTS),
  asyncHandler(async (req, res) => {
    const reportRows = await listTaskReportRows(req.user, req.query);
    return res.status(200).json(reportRows);
  }),
);

router.get(
  "/reports/tasks/export",
  authorize(PERMISSIONS.VIEW_REPORTS),
  asyncHandler(async (req, res) => {
    const report = await exportTaskReport(req.user, req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    return res.status(200).send(report.csv);
  }),
);

router.get(
  "/reports/workflow-summary",
  authorize(PERMISSIONS.VIEW_REPORTS),
  asyncHandler(async (req, res) => {
    const summary = await listWorkflowCompletionSummary(req.user);
    return res.status(200).json(summary);
  }),
);

router.get(
  "/reports/:reportType.csv",
  authorize(PERMISSIONS.VIEW_REPORTS),
  asyncHandler(async (req, res) => {
    const report = await buildReport(req.user, req.params.reportType);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    return res.status(200).send(report.csv);
  }),
);

module.exports = {
  reportRoutes: router,
};
