const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { resolveWorkflowForDepartment } = require("../services/taskService");
const { getStageById } = require("../services/workflowService");
const {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignInstancesForUser,
  listDesignProjectsForUser,
  listDesignScopesForUser,
  uploadProjectForUser,
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
    const projects = await listDesignProjectsForUser(req.user);
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/design/scopes",
  asyncHandler(async (req, res) => {
    const scopes = await listDesignScopesForUser(req.user, req.query.project_id);
    return sendSuccess(res, scopes);
  }),
);

router.get(
  "/design/instances",
  asyncHandler(async (req, res) => {
    const instances = await listDesignInstancesForUser(req.user, req.query.scope_id);
    return sendSuccess(res, instances);
  }),
);

router.get(
  "/design/workflow-preview",
  asyncHandler(async (req, res) => {
    const workflow = await resolveWorkflowForDepartment(req.user.department_id);
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
  "/department-projects",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const project = await uploadProjectForUser(req.user, req.body);
    return sendSuccess(res, project, 201);
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
