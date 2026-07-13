const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { asyncHandler } = require("../lib/asyncHandler");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { handleReferenceImageUpload } = require("../lib/designFixtureReferenceImageUpload");
const { uploadFixtureReferenceImageFile } = require("../lib/supabaseStorage");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  authorize,
  requireExecutiveDashboardAccess,
  requireOperationalController,
  requireProjectFixtureViewer,
} = require("../middleware/authorize");
const { resolveWorkflowForDepartment } = require("../services/taskService");
const { getStageById } = require("../services/workflowService");
const {
  uploadFixtureReferenceImage,
} = require("../services/designExcelService");
const {
  findFixtureByIdForUser,
  findProjectByIdForUser,
} = require("../repositories/designProjectCatalogRepository");
const {
  getFixtureCompletionTruth,
  getProjectCompletionTruthById,
} = require("../services/designCompletion/designCompletionEngine");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignFixturesForUser,
  listDesignProjectsForUser,
  listOutsourcedFixturesForProjectForUser,
  listProjectDashboardForUser,
  listRecentOutsourceSuppliersForUser,
  updateProjectModificationForUser,
} = require("../services/projectCatalogService");
const { reactivateProjectForModificationById } = require("../services/batchService");
const { getExecutiveDashboardForUser } = require("../services/executiveDashboardService");
const {
  assignProject2DLeader,
  deleteProject2DAssignment,
  getProject2DRouting,
} = require("../services/projectSubdivisionRoutingService");
const {
  bulkOutsourceFixtureStagesForUser,
  cancelFixtureOutsourceAssignmentForUser,
  changeFixtureOutsourceStatusForUser,
  convertInternalAssignmentToOutsourceForUser,
  convertOutsourceToInternalForUser,
  createVendorForUser,
  listProjectOutsourceAssignmentsForUser,
  listVendorsForUser,
  previewFixtureOutsourceScopeForUser,
} = require("../services/fixtureOutsourceAssignmentService");

const router = express.Router();

router.use(authenticate);

async function handleReferenceImageUploadRequest(req, res) {
  const requestedDepartmentId = String(req.query.department_id || "").trim();
  const departmentId = requestedDepartmentId
    ? resolveAccessibleDepartmentId(req.user, requestedDepartmentId, "Invalid department context")
    : null;

  if (!req.file) {
    throw new AppError(400, "No image file uploaded");
  }

  const imageType = String(req.body?.image_type || req.query?.image_type || "").trim().toLowerCase();
  if (!imageType || !["part", "fixture"].includes(imageType)) {
    throw new AppError(400, "Invalid image_type. Expected 'part' or 'fixture'.");
  }

  const fixtureId = req.params.fixtureId;
  console.info("[design-reference-image-upload]", {
    event: "reference_image_upload_start",
    fixture_id: fixtureId,
    department_id: departmentId,
    image_type: imageType,
    file_name: req.file.originalname,
    file_size_bytes: req.file.size,
    mime_type: req.file.mimetype,
    user_id: req.user.id,
    employee_id: req.user.employee_id,
  });

  const uploadedImage = await uploadFixtureReferenceImageFile({
    fixtureId,
    imageType,
    file: req.file,
  });
  const imageUrl = uploadedImage.publicUrl;

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
      storage_bucket: uploadedImage.bucket,
      storage_path: uploadedImage.path,
      previous_image_url: result.previous_image_url,
      fixture_no: result.fixture_no,
    },
  });

  return sendSuccess(res, result, 200);
}


router.get(
  "/department-projects",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const projects = await listDepartmentProjectsForUser(req.user);
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/design/projects",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const projects = await listDesignProjectsForUser(req.user, req.query.department_id, {
      activeOnly: req.query.active_only === "true",
    });
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/design/fixtures",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const fixtures = await listDesignFixturesForUser(req.user, req.query.project_id, req.query.department_id, {
      activeOnly: req.query.active_only === "true",
    });
    return sendSuccess(res, fixtures);
  }),
);

router.get(
  "/design/outsourcing/suppliers",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const suppliers = await listRecentOutsourceSuppliersForUser(req.user, req.query.department_id);
    return sendSuccess(res, suppliers);
  }),
);

router.get(
  "/design/vendors",
  asyncHandler(async (req, res) => {
    const vendors = await listVendorsForUser(req.user, req.query);
    return sendSuccess(res, vendors);
  }),
);

router.post(
  "/design/vendors",
  authorize(PERMISSIONS.DESIGN_VENDOR_MANAGE),
  asyncHandler(async (req, res) => {
    const vendor = await createVendorForUser(req.user, req.body);
    return sendSuccess(res, vendor, 201);
  }),
);

router.post(
  "/design/fixtures/outsource-preview",
  authorize(PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE),
  asyncHandler(async (req, res) => {
    const preview = await previewFixtureOutsourceScopeForUser(req.user, req.body);
    return sendSuccess(res, preview);
  }),
);

router.post(
  "/design/fixtures/outsource-bulk",
  authorize(PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_BULK),
  asyncHandler(async (req, res) => {
    const result = await bulkOutsourceFixtureStagesForUser(req.user, req.body);
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/design/projects/:projectId/outsource-assignments",
  asyncHandler(async (req, res) => {
    const assignments = await listProjectOutsourceAssignmentsForUser(req.user, req.params.projectId);
    return sendSuccess(res, assignments);
  }),
);

router.patch(
  "/design/fixtures/outsource-assignments/:assignmentId/status",
  asyncHandler(async (req, res) => {
    const assignment = await changeFixtureOutsourceStatusForUser(
      req.user,
      req.params.assignmentId,
      req.body,
    );
    return sendSuccess(res, assignment);
  }),
);

router.post(
  "/design/fixtures/outsource-assignments/:assignmentId/cancel",
  authorize(PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_CANCEL),
  asyncHandler(async (req, res) => {
    const assignment = await cancelFixtureOutsourceAssignmentForUser(
      req.user,
      req.params.assignmentId,
      req.body,
    );
    return sendSuccess(res, assignment);
  }),
);

router.post(
  "/design/fixtures/outsource-assignments/convert-internal",
  authorize(PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE),
  asyncHandler(async (req, res) => {
    const assignment = await convertInternalAssignmentToOutsourceForUser(req.user, req.body);
    return sendSuccess(res, assignment, 201);
  }),
);

router.post(
  "/design/fixtures/outsource-assignments/:assignmentId/convert-to-internal",
  authorize(PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE),
  asyncHandler(async (req, res) => {
    const assignment = await convertOutsourceToInternalForUser(
      req.user,
      req.params.assignmentId,
      req.body,
    );
    return sendSuccess(res, assignment);
  }),
);

router.get(
  "/design/projects/:projectId/outsourced-fixtures",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const fixtures = await listOutsourcedFixturesForProjectForUser(
      req.user,
      req.params.projectId,
      req.query.department_id,
      { activeOnly: req.query.active_only === "true" },
    );
    return sendSuccess(res, fixtures);
  }),
);

router.get(
  "/projects/summary",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const projects = await listProjectDashboardForUser(req.user, req.query.department_id);
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/dashboard/executive",
  requireExecutiveDashboardAccess,
  asyncHandler(async (req, res) => {
    const dashboard = await getExecutiveDashboardForUser(req.user, req.query);
    return sendSuccess(res, dashboard);
  }),
);

router.get(
  "/visibility/explain/:projectId",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const { explainProjectVisibility } = require("../services/visibilityResolutionService");
    const explanation = await explainProjectVisibility(req.user, req.params.projectId);
    return sendSuccess(res, explanation);
  }),
);

router.get(
  "/design/completion/projects/:projectId",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const requestedDepartmentId = String(req.query.department_id || "").trim();
    const departmentId = requestedDepartmentId
      ? resolveAccessibleDepartmentId(req.user, requestedDepartmentId, "A department is required for completion truth")
      : null;
    const project = await findProjectByIdForUser(req.params.projectId, req.user, departmentId);

    if (!project) {
      throw new AppError(404, "Project not found for the selected department");
    }

    const truth = await getProjectCompletionTruthById(project.project_id, project.department_id);
    if (!truth) {
      throw new AppError(404, `missing_project_completion_truth:${project.project_id}`);
    }

    return sendSuccess(res, truth);
  }),
);

router.get(
  "/design/completion/fixtures/:fixtureId",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const requestedDepartmentId = String(req.query.department_id || "").trim();
    const departmentId = requestedDepartmentId
      ? resolveAccessibleDepartmentId(req.user, requestedDepartmentId, "A department is required for completion truth")
      : null;
    const fixture = await findFixtureByIdForUser(req.params.fixtureId, req.user, departmentId);

    if (!fixture) {
      throw new AppError(404, "Fixture not found for the selected department");
    }

    const truth = await getFixtureCompletionTruth(req.params.fixtureId, fixture.department_id);

    if (!truth) {
      throw new AppError(404, "Fixture not found for the selected department");
    }

    return sendSuccess(res, truth);
  }),
);

router.get(
  "/design/workflow-preview",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const requestedDepartmentId = String(req.query.department_id || "").trim();
    let departmentId = requestedDepartmentId
      ? resolveAccessibleDepartmentId(req.user, requestedDepartmentId, "Invalid department context")
      : null;

    if (req.query.project_id) {
      const project = await findProjectByIdForUser(req.query.project_id, req.user, departmentId, { activeOnly: true });

      if (!project) {
        throw new AppError(409, "Project is not active for assignment");
      }

      departmentId = project.department_id;
    }

    if (!departmentId) {
      departmentId = resolveAccessibleDepartmentId(req.user, req.query.department_id, "Invalid department context");
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

router.get(
  "/design/projects/:projectId/2d-routing",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const routing = await getProject2DRouting(req.user, req.params.projectId);
    return sendSuccess(res, routing);
  }),
);

router.patch(
  "/design/projects/:projectId/modification",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const project = await updateProjectModificationForUser(req.user, req.params.projectId, req.body);
    return sendSuccess(res, project);
  }),
);

router.post(
  "/design/projects/:projectId/reactivate",
  asyncHandler(async (req, res) => {
    const result = await reactivateProjectForModificationById(req.user, req.params.projectId, req.body);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/design/projects/:projectId/2d-routing",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const assignedLeaderId = String(req.body?.assigned_leader_id || "").trim();
    if (!assignedLeaderId) {
      throw new AppError(400, "assigned_leader_id is required");
    }

    const assignment = await assignProject2DLeader(req.user, req.params.projectId, assignedLeaderId);
    return sendSuccess(res, assignment, 201);
  }),
);

router.delete(
  "/design/projects/:projectId/2d-routing/:assignmentId",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const routing = await deleteProject2DAssignment(
      req.user,
      req.params.projectId,
      req.params.assignmentId,
    );
    return sendSuccess(res, routing);
  }),
);

router.post(
  "/design/tasks",
  requireOperationalController,
  authorize(PERMISSIONS.CREATE_TASK),
  asyncHandler(async (req, res) => {
    const task = await createDesignTaskFromProject(req.user, req.body);
    return sendSuccess(res, task, 201);
  }),
);

router.post(
  "/design/native/fixtures/:fixtureId/reference-image",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  handleReferenceImageUpload,
  asyncHandler(handleReferenceImageUploadRequest),
);

module.exports = {
  designRoutes: router,
};

