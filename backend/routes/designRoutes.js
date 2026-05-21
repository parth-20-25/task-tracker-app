const express = require("express");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { asyncHandler } = require("../lib/asyncHandler");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { handleDesignExcelUpload } = require("../lib/designExcelUpload");
const { handleReferenceImageUpload } = require("../lib/designFixtureReferenceImageUpload");
const { uploadFixtureReferenceImageFile } = require("../lib/supabaseStorage");
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
  findFixtureByIdForUser,
  findProjectByIdForUser,
  listFixturesByUploadBatchForUser,
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
  listProjectDashboardForUser,
  uploadDepartmentProjectsForUser,
} = require("../services/projectCatalogService");

const router = express.Router();

router.use(authenticate);

async function handleListUploadBatchFixtures(req, res) {
  const requestedDepartmentId = String(req.query.department_id || "").trim();
  const departmentId = requestedDepartmentId
    ? resolveAccessibleDepartmentId(req.user, requestedDepartmentId, "Invalid department context")
    : null;

  const batchId = req.params.batchId;
  const fixtures = await listFixturesByUploadBatchForUser(batchId, req.user, departmentId);

  return sendSuccess(res, fixtures, 200);
}

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

function rejectRetiredNativePreviewFlow() {
  throw new AppError(
    410,
    "Native Fixture Upload now uses the native ingestion workspace API. Legacy preview/upload handlers are not available for native ingestion.",
    {
      replacement: "/api/design/native-ingestion/sessions",
    },
    "NATIVE_INGESTION_WORKSPACE_REQUIRED",
  );
}

router.get(
  "/department-projects",
  asyncHandler(async (req, res) => {
    const projects = await listDepartmentProjectsForUser(req.user);
    return sendSuccess(res, projects);
  }),
);

router.post(
  "/department-projects",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await uploadDepartmentProjectsForUser(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.get(
  "/design/projects",
  asyncHandler(async (req, res) => {
    const projects = await listDesignProjectsForUser(req.user, req.query.department_id, {
      activeOnly: req.query.active_only === "true",
    });
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/design/fixtures",
  asyncHandler(async (req, res) => {
    const fixtures = await listDesignFixturesForUser(req.user, req.query.project_id, req.query.department_id, {
      activeOnly: req.query.active_only === "true",
    });
    return sendSuccess(res, fixtures);
  }),
);

router.get(
  "/projects/summary",
  asyncHandler(async (req, res) => {
    const projects = await listProjectDashboardForUser(req.user, req.query.department_id);
    return sendSuccess(res, projects);
  }),
);

router.get(
  "/visibility/explain/:projectId",
  asyncHandler(async (req, res) => {
    const { explainProjectVisibility } = require("../services/visibilityResolutionService");
    const explanation = await explainProjectVisibility(req.user, req.params.projectId);
    return sendSuccess(res, explanation);
  }),
);

router.get(
  "/design/completion/projects/:projectId",
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
      throw new AppError(404, "Project completion truth unavailable");
    }

    return sendSuccess(res, truth);
  }),
);

router.get(
  "/design/completion/fixtures/:fixtureId",
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

router.post(
  "/upload/design-excel",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  handleDesignExcelUpload,
  asyncHandler(async (req, res) => {
    const result = await parseAndPreviewUploadedWorkbook(req.user, req.file, {
      catalogMembershipMode: req.body?.catalog_membership_mode,
    });
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/upload/design-native-excel",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
  }),
);

router.post(
  "/upload/design-excel/confirm",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await confirmUpload(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/upload/design-native-excel/confirm",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
  }),
);

router.post(
  "/design/upload",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await parseAndPreviewUpload(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-upload",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
  }),
);

router.post(
  "/design/upload/confirm",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await confirmUpload(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-upload/confirm",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
  }),
);

router.post(
  "/design/upload/rejected-row/validate",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await validateRejectedUploadRow(req.user, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-upload/rejected-row/validate",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
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
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  asyncHandler(handleListUploadBatchFixtures),
);

router.get(
  "/design/native-upload-batches/:batchId/fixtures",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
  }),
);

router.post(
  "/design/fixtures/:fixtureId/reference-image",
  authorize(PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA),
  handleReferenceImageUpload,
  asyncHandler(handleReferenceImageUploadRequest),
);

router.post(
  "/design/native/fixtures/:fixtureId/reference-image",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    rejectRetiredNativePreviewFlow();
  }),
);

module.exports = {
  designRoutes: router,
};
