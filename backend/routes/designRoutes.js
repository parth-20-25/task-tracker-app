const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { asyncHandler } = require("../lib/asyncHandler");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { handleDesignExcelUpload } = require("../lib/designExcelUpload");
const { handleReferenceImageUpload, buildFixtureReferenceImageFileUrl } = require("../lib/designFixtureReferenceImageUpload");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const { resolveWorkflowForDepartment } = require("../services/taskService");
const { getStageById } = require("../services/workflowService");
const {
  parseAndPreviewUpload,
  parseAndPreviewUploadedWorkbook,
  confirmUpload,
  uploadFixtureReferenceImage,
  validateRejectedUploadRow,
} = require("../services/designExcelService");
const {
  findProjectByIdForDepartment,
  listFixturesByUploadBatchForDepartment,
  updateFixtureReferenceImageForDepartment,
} = require("../repositories/designProjectCatalogRepository");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignFixturesForUser,
  listDesignProjectsForUser,
  listDesignScopesForUser,
  uploadDepartmentProjectsForUser,
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

router.post(
  "/department-projects",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const result = await uploadDepartmentProjectsForUser(req.user, req.body);
    return sendSuccess(res, result, 200);
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
  "/design/upload/rejected-row/validate",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const result = await validateRejectedUploadRow(req.user, req.body);
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

router.get(
  "/design/upload-batches/:batchId/fixtures",
  authorize(PERMISSIONS.UPLOAD_DATA),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.query.department_id,
      "Invalid department context",
    );

    const batchId = req.params.batchId;
    const fixtures = await listFixturesByUploadBatchForDepartment(batchId, departmentId);

    return sendSuccess(res, fixtures, 200);
  }),
);

router.post(
  "/design/fixtures/:fixtureId/reference-image",
  authorize(PERMISSIONS.UPLOAD_DATA),
  handleReferenceImageUpload,
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.query.department_id,
      "Invalid department context",
    );

    if (!req.file) {
      throw new AppError(400, "No image file uploaded");
    }

    const imageType = String(req.body?.image_type || req.query?.image_type || "").trim().toLowerCase();
    if (!imageType || !["part", "fixture"].includes(imageType)) {
      throw new AppError(400, "Invalid image_type. Expected 'part' or 'fixture'.");
    }

    const fixtureId = req.params.fixtureId;
    const fileName = req.file.filename;
    const imageUrl = buildFixtureReferenceImageFileUrl(fileName);

    console.info("[design-reference-image-upload]", {
      event: "reference_image_upload_start",
      fixture_id: fixtureId,
      department_id: departmentId,
      image_type: imageType,
      file_name: req.file.originalname,
      stored_file_name: fileName,
      file_size_bytes: req.file.size,
      mime_type: req.file.mimetype,
      user_id: req.user.id,
      employee_id: req.user.employee_id,
    });

    const result = await uploadFixtureReferenceImage(
      req.user,
      fixtureId,
      departmentId,
      imageType,
      imageUrl,
    );

    await createAuditLog({
      userEmployeeId: req.user.employee_id,
      actionType: "DESIGN_FIXTURE_REFERENCE_IMAGE_UPLOADED",
      targetType: "design_fixture",
      targetId: fixtureId,
      metadata: {
        image_type: imageType,
        image_url: imageUrl,
        previous_image_url: result.previous_image_url,
        fixture_no: result.fixture_no,
      },
    });

    return sendSuccess(res, result, 200);
  }),
);

module.exports = {
  designRoutes: router,
};
