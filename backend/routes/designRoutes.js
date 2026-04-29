const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { asyncHandler } = require("../lib/asyncHandler");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { handleDesignExcelUpload } = require("../lib/designExcelUpload");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { resolveWorkflowForDepartment } = require("../services/taskService");
const { getStageById } = require("../services/workflowService");
const {
  parseAndPreviewUpload,
  parseAndPreviewUploadedWorkbook,
  confirmUpload,
} = require("../services/designExcelService");
const { findProjectByIdForDepartment } = require("../repositories/designProjectCatalogRepository");
const {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignFixturesForUser,
  listDesignProjectsForUser,
  listDesignScopesForUser,
} = require("../services/projectCatalogService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/department-projects",
  asyncHandler(async (req, res) => {
    const projects = await listDepartmentProjectsForUser(req.user);
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/design/projects",
  asyncHandler(async (req, res) => {
    const projects = await listDesignProjectsForUser(req.user, req.query.department_id);
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/design/scopes",
  asyncHandler(async (req, res) => {
    const scopes = await listDesignScopesForUser(req.user, req.query.project_id, req.query.department_id);
    return sendSuccess(res, scopes);
  }),
);

router.get(
  "/design/fixtures",
  asyncHandler(async (req, res) => {
    const fixtures = await listDesignFixturesForUser(req.user, req.query.scope_id, req.query.department_id);
    return sendSuccess(res, fixtures);
  }),
);

router.get(
  "/design/workflow-preview",
  asyncHandler(async (req, res) => {
    let departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.query.department_id,
      "Invalid department context",
    );

    if (req.query.project_id) {
      const project = await findProjectByIdForDepartment(req.query.project_id, departmentId);

      if (!project) {
        throw new AppError(404, "Project not found for the selected department");
      }

      departmentId = resolveAccessibleDepartmentId(req.user, project.department_id, "Invalid department context");
    }

    const workflow = await resolveWorkflowForDepartment(departmentId);
    const firstStage = await getStageById(workflow.first_stage_id);

    return sendSuccess(res, {
      id: workflow.id,
      name: workflow.name,
      first_stage_id: workflow.first_stage_id,
      first_stage_name: firstStage ? firstStage.name : "Initial Stage",
    });
  }),
);

router.post(
  "/upload/design-excel",
  authorize(PERMISSIONS.UPLOAD_DATA),
  handleDesignExcelUpload,
  asyncHandler(async (req, res) => {
    const result = await parseAndPreviewUploadedWorkbook(req.user, req.file);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/upload/design-excel/confirm",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const result = await confirmUpload(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/upload",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const result = await parseAndPreviewUpload(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/upload/confirm",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const result = await confirmUpload(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/tasks",
  authorize(PERMISSIONS.CREATE_TASK),
  asyncHandler(async (req, res) => {
    const task = await createDesignTaskFromProject(req.user, req.body);
    return sendSuccess(res, task, 201);
  }),
);

module.exports = {
  designRoutes: router,
};
