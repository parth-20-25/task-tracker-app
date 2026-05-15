const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { AppError } = require("../lib/AppError");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { PERMISSIONS } = require("../config/constants");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
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
} = require("../services/fixtureWorkflowService");

const router = express.Router();

router.use(authenticate);

async function ensureVisibleFixtureForWorkflow(user, fixtureId, departmentId) {
  const fixture = await findFixtureByIdForUser(fixtureId, user, departmentId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/by-department
// Returns the active workflow stages for the current user's department.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/workflows/by-department",
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/validate-assignment
// Returns whether a fixture is assignable and why not if blocked.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/workflows/validate-assignment",
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
  authorize(PERMISSIONS.CREATE_TASK),
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
  authorize(PERMISSIONS.CREATE_TASK),
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
  authorize(PERMISSIONS.REOPEN_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

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
  "/workflows/manual-stage",
  authorize(PERMISSIONS.MANIPULATE_FIXTURE_STAGE),
  asyncHandler(async (req, res) => {
    const departmentId = resolveAccessibleDepartmentId(
      req.user,
      req.body?.department_id,
      "A department is required",
    );

    const fixtureId = String(req.body?.fixture_id || "").trim();
    if (!fixtureId) throw new AppError(400, "fixture_id is required");

    await ensureVisibleFixtureForWorkflow(req.user, fixtureId, departmentId);
    const result = await manipulateFixtureStage({
      actor: req.user,
      fixtureId,
      departmentId,
      targetStageName: req.body?.target_stage_name,
      targetStageOrder: req.body?.target_stage_order,
      targetStatus: req.body?.target_status,
      revisionReason: req.body?.revision_reason,
      remarks: req.body?.remarks,
    });
    return sendSuccess(res, result, 200);
  }),
);

module.exports = {
  workflowRoutes: router,
};
