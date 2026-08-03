const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { asyncHandler } = require("../lib/asyncHandler");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { listDesignProjectsForUser } = require("../services/projectCatalogService");
const { getDesignReportData } = require("../services/designReportService");
const { buildReport, exportTaskReport, listTaskReportRows } = require("../services/reportService");

const router = express.Router();
router.use(authenticate);

function getRequestOrigin(req) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

router.get("/reports/tasks", authorize(PERMISSIONS.VIEW_REPORTS), asyncHandler(async (req, res) => res.status(200).json(await listTaskReportRows(req.user, req.query))));
router.get("/reports/tasks/export", authorize(PERMISSIONS.EXPORT_REPORTS), asyncHandler(async (req, res) => {
  const report = await exportTaskReport(req.user, req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
  return res.status(200).send(report.csv);
}));
router.get("/reports/design/projects", authorize(PERMISSIONS.EXPORT_REPORTS), asyncHandler(async (req, res) => res.status(200).json(await listDesignProjectsForUser(req.user, req.query.department_id, { activeOnly: false }))));
router.get("/reports/design/data", authorize(PERMISSIONS.EXPORT_REPORTS), asyncHandler(async (req, res) => res.status(200).json(await getDesignReportData(req.user, req.query, { publicOrigin: getRequestOrigin(req) }))));
router.get("/reports/:reportType.csv", authorize(PERMISSIONS.VIEW_REPORTS), asyncHandler(async (req, res) => {
  const report = await buildReport(req.user, req.params.reportType);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
  return res.status(200).send(report.csv);
}));

module.exports = { reportRoutes: router };