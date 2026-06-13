const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { asyncHandler } = require("../lib/asyncHandler");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { listDesignProjectsForUser } = require("../services/projectCatalogService");
const { exportDesignReport } = require("../services/designReportService");
const { buildReport, exportTaskReport, listTaskReportRows } = require("../services/reportService");

const router = express.Router();

router.use(authenticate);

function getRequestOrigin(req) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

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
  authorize(PERMISSIONS.EXPORT_REPORTS),
  asyncHandler(async (req, res) => {
    const report = await exportTaskReport(req.user, req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    return res.status(200).send(report.csv);
  }),
);

router.get(
  "/reports/design/projects",
  authorize(PERMISSIONS.EXPORT_REPORTS),
  asyncHandler(async (req, res) => {
    const projects = await listDesignProjectsForUser(req.user, req.query.department_id, {
      activeOnly: false,
    });
    return res.status(200).json(projects);
  }),
);

router.get(
  "/reports/design/export",
  authorize(PERMISSIONS.EXPORT_REPORTS),
  asyncHandler(async (req, res) => {
    const report = await exportDesignReport(req.user, req.query, {
      publicOrigin: getRequestOrigin(req),
    });
    res.setHeader("Content-Type", report.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    return res.status(200).send(report.buffer);
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
