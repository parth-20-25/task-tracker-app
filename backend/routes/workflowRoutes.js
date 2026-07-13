const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { AppError } = require("../lib/AppError");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { PERMISSIONS } = require("../config/constants");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  authorize,
  requireOperationalController,
  requireProjectFixtureViewer,
} = require("../middleware/authorize");
const { HasPermission } = require("../services/accessControlService");
const { findFixtureByIdForUser } = require("../repositories/designProjectCatalogRepository");
const {
  getWorkflowForDepartment,
  getCurrentStageForFixture,
  validateAssignment,
  assignFixtureStage,
  completeFixtureStage,
  approveFixtureStage,
  rejectFixtureStage,
  getFullProgressForFixture,
  manipulateFixtureStage,
  reopenFixtureStage,
  releaseFixtureWorkflow,
} = require("../services/fixtureWorkflowService");
const {
  assignReleaseDeliverable,
  getFixtureReleasePackageResponse,
  resolveMimicApplicability,
  reviewReleaseDeliverable,
  startReleaseDeliverable,
  submitReleaseDeliverable,
} = require("../services/fixtureReleaseDeliverablesService");

const router = express.Router();

router.use(authenticate);

async function ensureVisibleFixtureForWorkflow(user, fixtureId, departmentId) {
  const fixture = await findFixtureByIdForUser(fixtureId, user, departmentId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }
}

async function resolveVisibleReleaseFixture(req) {
  const fixtureId = String(req.params.fixtureId || "").trim();
  if (!fixtureId) {
    throw new AppError(400, "fixtureId is required");
  }

  const departmentId = resolveAccessibleDepartmentId(
    req.user,
    req.body?.department_id || req.query.department_id,
    "A department is required to access fixture release deliverables",
  );
  await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
  return { fixtureId, departmentId };
}

function requireReleaseDeliverableId(req) {
  const deliverableId = String(req.params.deliverableId || "").trim();
  if (!deliverableId) {
    throw new AppError(400, "deliverableId is required");
  }
  return deliverableId;
}

async function logChangeFixtureStageTrace(req, context) {
  const role = typeof req.user?.role === "object" ? req.user.role : req.user?.role_details;
  const resolvedPermissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  const permissionResult = await HasPermission(req.user, PERMISSIONS.CHANGE_FIXTURE_STAGE);

  console.info("[workflow][change_fixture_stage]", {
    event: "fixture_stage_permission_trace",
    current_user_id: req.user?.id || null,
    current_employee_id: req.user?.employee_id || null,
    current_role: role?.id || req.user?.role_id || req.user?.role || null,
    current_role_name: role?.name || null,
    resolved_permissions: resolvedPermissions,
    permission_check_result: permissionResult,
    path: req.originalUrl || req.url,
    method: req.method,
    ...context,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/by-department
// Returns the active workflow stages for the current user's department.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/workflows/by-department",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.query.department_id,
      "A department is required",
    );
    const workflow = await getWorkflowForDepartment(departmentId);

    console.log("User Dept:", departmentId);
    console.log("Workflow Found:", workflow);

    return sendSuccess(res, { stages: workflow.stages });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/current-stage?fixture_id=
// Returns the current stage + status for a fixture.
// Resolves fixture -> project -> department workflow safely.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/workflows/current-stage",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const fixtureId = String(req.query.fixture_id || "").trim();
    if (!fixtureId) {
      throw new AppError(400, "fixture_id query parameter is required");
    }

    const departmentId = resolveAccessibleDepartmentId(req.user, req.query.department_id, "A department is required");

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await getCurrentStageForFixture(fixtureId, departmentId);
    return sendSuccess(res, result ?? null);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/progress?fixture_id=
// Returns the full multi-stage progress timeline for a fixture.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/workflows/progress",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.query.department_id,
      "A department is required to access workflow data",
    );

    const fixtureId = String(req.query.fixture_id || "").trim();
    if (!fixtureId) {
      throw new AppError(400, "fixture_id query parameter is required");
    }

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await getFullProgressForFixture(fixtureId, departmentId);
    return sendSuccess(res, result);
  }),
);

router.get(
  "/workflows/fixtures/:fixtureId/release-package",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const { fixtureId, departmentId } = await resolveVisibleReleaseFixture(req);
    const progress = await getFullProgressForFixture(fixtureId, departmentId);
    const response = await getFixtureReleasePackageResponse(
      req.user,
      fixtureId,
      progress.stages,
    );
    return sendSuccess(res, response);
  }),
);

router.post(
  "/workflows/fixtures/:fixtureId/release-deliverables/:deliverableId/assign",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const { fixtureId } = await resolveVisibleReleaseFixture(req);
    const deliverableId = requireReleaseDeliverableId(req);
    const releasePackage = await assignReleaseDeliverable(req.user, fixtureId, deliverableId, req.body);
    return sendSuccess(res, { release_package: releasePackage });
  }),
);

router.post(
  "/workflows/fixtures/:fixtureId/release-deliverables/:deliverableId/start",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const { fixtureId } = await resolveVisibleReleaseFixture(req);
    const deliverableId = requireReleaseDeliverableId(req);
    const releasePackage = await startReleaseDeliverable(req.user, fixtureId, deliverableId);
    return sendSuccess(res, { release_package: releasePackage });
  }),
);

router.post(
  "/workflows/fixtures/:fixtureId/release-deliverables/:deliverableId/submit",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const { fixtureId } = await resolveVisibleReleaseFixture(req);
    const deliverableId = requireReleaseDeliverableId(req);
    const releasePackage = await submitReleaseDeliverable(req.user, fixtureId, deliverableId, req.body);
    return sendSuccess(res, { release_package: releasePackage });
  }),
);

router.post(
  "/workflows/fixtures/:fixtureId/release-deliverables/:deliverableId/review",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const { fixtureId } = await resolveVisibleReleaseFixture(req);
    const deliverableId = requireReleaseDeliverableId(req);
    const releasePackage = await reviewReleaseDeliverable(req.user, fixtureId, deliverableId, req.body);
    return sendSuccess(res, { release_package: releasePackage });
  }),
);

router.post(
  "/workflows/fixtures/:fixtureId/release-deliverables/:deliverableId/applicability",
  requireProjectFixtureViewer,
  asyncHandler(async (req, res) => {
    const { fixtureId } = await resolveVisibleReleaseFixture(req);
    const deliverableId = requireReleaseDeliverableId(req);
    const releasePackage = await resolveMimicApplicability(
      req.user,
      fixtureId,
      deliverableId,
      req.body,
    );
    return sendSuccess(res, { release_package: releasePackage });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/validate-assignment
// Returns whether a fixture is assignable and why not if blocked.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/workflows/validate-assignment",
  requireOperationalController,
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) {
      throw new AppError(400, "fixture_id is required");
    }

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await validateAssignment(fixtureId, departmentId);
    return sendSuccess(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/assign
// Sets the current stage to IN_PROGRESS for the fixture.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/workflows/assign",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    const assignedTo = String(req.body?.assigned_to || "").trim();

    if (!fixtureId) throw new AppError(400, "fixture_id is required");
    if (!assignedTo) throw new AppError(400, "assigned_to is required");

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await assignFixtureStage(fixtureId, departmentId, assignedTo, req.user);
    return sendSuccess(res, result, 200);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/complete
// Marks the current IN_PROGRESS stage as COMPLETED.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/workflows/complete",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await completeFixtureStage(fixtureId, departmentId);
    return sendSuccess(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/approve
// Supervisor: approves the COMPLETED stage.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/workflows/approve",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await approveFixtureStage(fixtureId, departmentId);
    return sendSuccess(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/reject
// Supervisor: rejects the COMPLETED stage — sets it back to REJECTED.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/workflows/reject",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await rejectFixtureStage(fixtureId, departmentId);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/workflows/reopen-stage",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await logChangeFixtureStageTrace(req, {
      operation: "reopen_fixture_stage",
      fixture_id: fixtureId,
      department_id: departmentId,
      target_stage_name: req.body?.target_stage_name || null,
      target_stage_order: req.body?.target_stage_order || null,
    });
    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await reopenFixtureStage({
      actor: req.user,
      fixtureId,
      departmentId,
      targetStageName: req.body?.target_stage_name,
      targetStageOrder: req.body?.target_stage_order,
      revisionType: req.body?.revision_type,
      revisionReason: req.body?.revision_reason,
      remarks: req.body?.remarks,
      requestedBy: req.body?.requested_by,
      approvedBy: req.body?.approved_by,
    });
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/workflows/release",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await logChangeFixtureStageTrace(req, {
      operation: "release_fixture_workflow",
      fixture_id: fixtureId,
      department_id: departmentId,
    });
    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await releaseFixtureWorkflow({
      actor: req.user,
      fixtureId,
      departmentId,
    });
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/workflows/manual-stage",
  requireOperationalController,
  authorize(PERMISSIONS.CHANGE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await logChangeFixtureStageTrace(req, {
      operation: "manual_fixture_stage",
      fixture_id: fixtureId,
      department_id: departmentId,
      target_stage_name: req.body?.target_stage_name || null,
      target_stage_order: req.body?.target_stage_order || null,
      target_status: req.body?.target_status || null,
    });
    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await manipulateFixtureStage({
      actor: req.user,
      fixtureId,
      departmentId,
      targetStageName: req.body?.target_stage_name,
      targetStageOrder: req.body?.target_stage_order,
      targetStatus: req.body?.target_status,
      reasonType: req.body?.reason_type || req.body?.revision_type,
      revisionReason: req.body?.revision_reason,
      remarks: req.body?.remarks,
    });
    return sendSuccess(res, result, 200);
  }),
);

module.exports = {
  workflowRoutes: router,
};
