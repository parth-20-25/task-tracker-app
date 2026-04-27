const { AppError } = require("../lib/AppError");
const { pool } = require("../db");
const {
  getDesignStageDisplayName,
  normalizeDesignStageName,
} = require("../lib/designWorkflowStages");
const { instrumentModuleExports } = require("../lib/observability");
const {
  approveStageAttempt,
  getActiveWorkflowForDepartment,
  getConfiguredWorkflowForDepartment,
  getProgressForFixture,
  initProgressForFixture,
  updateProgressRow,
  rejectStageAttempt,
  markFixtureComplete,
  startStageAttempt,
  getFixtureWithDepartment,
  getFixtureWorkflowContext,
  resolveFixtureByCanonicalIdentity,
  listAssignableFixtures,
} = require("../repositories/fixtureWorkflowRepository");
const { getDepartmentWorkflowStagesResponse } = require("./workflowRecoveryService");

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that the fixture belongs to the given department.
 * Throws 403 on cross-department access, 404 if fixture not found.
 */
async function assertFixtureBelongsToDepartment(fixtureId, departmentId) {
  const row = await getFixtureWithDepartment(fixtureId, departmentId);
  if (!row) {
    throw new AppError(404, "Fixture not found");
  }
  if (row.department_id !== departmentId) {
    throw new AppError(403, "Cross-department access is not allowed");
  }
}

/**
 * Returns the active workflow for a department or throws a user-facing error.
 */
async function requireWorkflow(departmentId) {
  const workflow = await getActiveWorkflowForDepartment(departmentId);
  if (!workflow || !workflow.stages || workflow.stages.length === 0) {
    throw new AppError(409, "No workflow configured for this department");
  }
  return workflow;
}

/**
 * Ensures progress rows exist for the fixture, initialising them if needed.
 * Returns the progress rows ordered by stage_order.
 */
async function ensureProgressInitialized(fixtureId, departmentId, workflow) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await initProgressForFixture(fixtureId, departmentId, workflow.stages, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getProgressForFixture(fixtureId, departmentId);
}

/**
 * Returns the stage row that is still awaiting review/action.
 * currentStage = first progress row whose status is not APPROVED.
 */
function deriveCurrentStageByStatus(progressRows) {
  return progressRows.find((r) => r.status !== "APPROVED") || null;
}

function buildCurrentStageResponse(progressRows, workflow) {
  const current = deriveCurrentStageByStatus(progressRows);

  if (!current) {
    return { stage: null, status: "APPROVED", stage_order: null, is_complete: true };
  }

  const normalizedStageKey = normalizeDesignStageName(current.stage_name);

  return {
    stage: getDesignStageDisplayName(normalizedStageKey, current.stage_name || null),
    status: current.status || "PENDING",
    stage_order: current.stage_order ?? null,
    is_complete: false,
  };
}

function calculateStageDurationMinutes(startValue, endValue) {
  if (!startValue || !endValue) {
    return null;
  }

  const start = startValue instanceof Date ? startValue : new Date(startValue);
  const end = endValue instanceof Date ? endValue : new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return diffMinutes > 0 ? diffMinutes : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public service functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/workflows/by-department
 * Returns the active workflow definition for the user's department.
 */
async function getWorkflowForDepartment(departmentId) {
  return getDepartmentWorkflowStagesResponse(departmentId);
}

/**
 * GET /api/workflows/current-stage?fixture_id=
 * Resolves fixture -> project -> configured department workflow safely.
 * Returns null when the department linkage or workflow configuration is missing.
 */
async function getCurrentStageForFixture(fixtureId) {
  if (!fixtureId) {
    throw new AppError(400, "fixture_id is required");
  }

  const fixture = await getFixtureWorkflowContext(fixtureId);

  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  const project = {
    id: fixture.project_id,
    project_no: fixture.project_no,
    project_name: fixture.project_name,
    department_id: fixture.department_id,
  };

  if (!project.department_id) {
    return null;
  }

  const workflow = await getConfiguredWorkflowForDepartment(project.department_id);

  if (!workflow || !workflow.department_id || workflow.department_id !== project.department_id) {
    return null;
  }

  const progress = await getProgressForFixture(fixtureId, project.department_id);

  // find first stage NOT approved
  const current = progress.find(s => s.status !== "APPROVED");

  if (!current) {
    return {
      stage: null,
      status: "APPROVED",
      stage_order: null,
      is_complete: true,
    };
  }

  return {
    stage: current.stage_name,
    status: current.status,
    stage_order: current.stage_order,
    is_complete: false,
  };
}

/**
 * Returns { stage, status, stage_order } for the fixture's current active stage
 * within the caller's department workflow.
 */
async function getCurrentStage(fixtureId, departmentId) {
  if (!fixtureId) throw new AppError(400, "fixture_id is required");
  if (!departmentId) throw new AppError(400, "department_id is required");

  await assertFixtureBelongsToDepartment(fixtureId, departmentId);

  const workflow = await requireWorkflow(departmentId);

  let progress = await getProgressForFixture(fixtureId, departmentId);
  if (progress.length === 0) {
    progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);
  }

  return buildCurrentStageResponse(progress, workflow);
}

/**
 * Validates whether a fixture is assignable and returns the blocking reason if not.
 * Returns { canAssign: boolean, reason: string | null, currentStage: row | null }
 */
async function validateAssignment(fixtureId, departmentId) {
  if (!fixtureId || !departmentId) {
    return { canAssign: false, reason: "fixture_id and department_id are required", currentStage: null };
  }

  // Rule 1: no workflow
  const workflow = await getActiveWorkflowForDepartment(departmentId);
  if (!workflow || !workflow.stages || workflow.stages.length === 0) {
    return { canAssign: false, reason: "No workflow configured for this department", currentStage: null };
  }

  let progress = await getProgressForFixture(fixtureId, departmentId);
  if (progress.length === 0) {
    progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);
  }

  const current = deriveCurrentStageByStatus(progress);

  // All stages approved → fixture complete
  if (!current) {
    return { canAssign: false, reason: "Fixture is fully completed", currentStage: null };
  }

  // Guard against inconsistent progress data where a prior stage is still incomplete.
  if (current.stage_order > 1) {
    const previous = progress.find((r) => Number(r.stage_order) === Number(current.stage_order) - 1);
    if (previous && previous.status !== "APPROVED") {
      return { canAssign: false, reason: "Previous stage is not completed", currentStage: current };
    }
  }

  // If the current stage is already active in workflow progress, only a reassignment attempt should surface it.
  if (current.status === "IN_PROGRESS") {
    return { canAssign: false, reason: "Stage already assigned", currentStage: current };
  }

  if (!["PENDING", "REJECTED"].includes(current.status)) {
    return { canAssign: false, reason: `Stage is not assignable in status ${current.status}`, currentStage: current };
  }

  // PENDING or REJECTED with no active task for this stage → allowed
  return { canAssign: true, reason: null, currentStage: current };
}

/**
 * POST /api/workflows/assign
 * Sets the current stage to IN_PROGRESS.
 */
async function assignFixtureStage(fixtureId, departmentId, assignedTo) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);

  const { canAssign, reason, currentStage } = await validateAssignment(fixtureId, departmentId);
  if (!canAssign) {
    throw new AppError(reason === "Stage already assigned" ? 400 : 409, reason);
  }

  const timestamp = new Date();

  await updateProgressRow(fixtureId, currentStage.stage_name, {
    status: "IN_PROGRESS",
    assigned_to: assignedTo,
    assigned_at: timestamp,
    started_at: timestamp,
    completed_at: null,
    duration_minutes: null,
  });
  await startStageAttempt(fixtureId, departmentId, currentStage.stage_name, assignedTo, timestamp);
  return getCurrentStage(fixtureId, departmentId);
}

/**
 * POST /api/workflows/complete
 * Deprecated: task approval now advances workflow stages directly.
 */
async function completeFixtureStage(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);
  throw new AppError(409, "Workflow stages no longer use a COMPLETED progress state. Approve the task to advance the fixture.");
}

/**
 * POST /api/workflows/approve
 * Supervisor: approves the current IN_PROGRESS stage.
 * If it was the final stage, marks the fixture as fully complete.
 */
async function approveFixtureStage(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);

  const fixture = await getFixtureWorkflowContext(fixtureId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  const nextStage = await advanceFixtureWorkflowStage({
    project_id: fixture.project_id,
    scope_id: fixture.scope_id,
    fixture_no: fixture.fixture_no,
    department_id: departmentId,
  });

  if (!nextStage) {
    return { stage: null, status: "APPROVED", stage_order: null, is_complete: true };
  }

  return getCurrentStage(fixtureId, departmentId);
}

/**
 * POST /api/workflows/reject
 * Supervisor: rejects the current IN_PROGRESS stage.
 */
async function rejectFixtureStage(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);

  const progress = await getProgressForFixture(fixtureId, departmentId);
  const current = deriveCurrentStageByStatus(progress);

  if (!current) {
    throw new AppError(409, "Fixture is already fully completed");
  }

  if (current.status !== "IN_PROGRESS") {
    throw new AppError(409, `Stage must be IN_PROGRESS before it can be rejected. Current status: ${current.status}`);
  }

  const timestamp = new Date();

  await updateProgressRow(fixtureId, current.stage_name, {
    status: "REJECTED",
    assigned_to: null,
    assigned_at: null,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
  });
  await rejectStageAttempt(fixtureId, current.stage_name, timestamp);

  return getCurrentStage(fixtureId, departmentId);
}

async function resolveFixtureIdentityForAdvancement(identity, client = pool) {
  const departmentId = String(identity?.department_id || "").trim();
  const projectId = String(identity?.project_id || "").trim();
  const scopeId = String(identity?.scope_id || "").trim();
  const fixtureNo = String(identity?.fixture_no || "").trim();
  const fixtureId = String(identity?.fixture_id || "").trim();

  if (!departmentId) {
    throw new AppError(400, "department_id is required");
  }

  let fixture = null;

  if (projectId && scopeId && fixtureNo) {
    fixture = await resolveFixtureByCanonicalIdentity(
      {
        project_id: projectId,
        scope_id: scopeId,
        fixture_no: fixtureNo,
      },
      departmentId,
      client,
    );
  }

  if (!fixture && fixtureId) {
    fixture = await getFixtureWorkflowContext(fixtureId, client);
    if (fixture && fixture.department_id !== departmentId) {
      throw new AppError(403, "Cross-department access is not allowed");
    }
  }

  if (!fixture) {
    throw new AppError(404, "Fixture not found for the supplied canonical identity");
  }

  return {
    department_id: departmentId,
    fixture_id: fixture.fixture_id || fixtureId,
    project_id: fixture.project_id,
    scope_id: fixture.scope_id,
    fixture_no: fixture.fixture_no,
    project_no: fixture.project_no || null,
    scope_name: fixture.scope_name || null,
  };
}

/**
 * Advances a fixture workflow stage using the fixture_workflow_progress table
 * as the single source of truth.
 *
 * Rules (strict):
 *  1. Find the first non-APPROVED stage (= current).
 *  2. Validate that current.status === "IN_PROGRESS".
 *  3. Mark current stage APPROVED.
 *  4. Find the next stage by stage_order.
 *  5. Set next stage to PENDING (making it assignable).
 *  6. If no next stage exists → mark fixture complete.
 *
 * Called ONLY from taskService.applyWorkflowReviewDecision on approval.
 * ❌ NEVER update workflow stage directly in taskService.
 */
async function advanceFixtureWorkflowStage(identity) {
  const departmentId = String(identity?.department_id || "").trim();
  if (!departmentId) return null;

  const client = await pool.connect();
  let fixtureId = String(identity?.fixture_id || "").trim() || null;

  try {
    await client.query("BEGIN");

    const resolvedIdentity = await resolveFixtureIdentityForAdvancement(identity, client);
    fixtureId = resolvedIdentity.fixture_id;
    const progress = await getProgressForFixture(fixtureId, departmentId, client);

    // STEP 1 — FIND CURRENT (FIRST NON-APPROVED)
    const current = progress.find(s => s.status !== "APPROVED");

    if (!current) {
      // All stages already approved → fixture is complete
      await markFixtureComplete(fixtureId, client);
      await client.query("COMMIT");
      console.log("[workflow] advanceFixtureWorkflowStage — fixture already complete", { fixture_id: fixtureId });
      return null;
    }

    // STEP 2 — VALIDATE STATE
    if (current.status !== "IN_PROGRESS") {
      throw new Error(
        `[workflow] Cannot advance stage "${current.stage_name}" — expected IN_PROGRESS, got ${current.status}`
      );
    }

    // STEP 3 — MARK CURRENT APPROVED
    await updateProgressRow(
      fixtureId,
      current.stage_name,
      { status: "APPROVED", updated_at: new Date() },
      client
    );
    await approveStageAttempt(fixtureId, current.stage_name, new Date(), client);

    // STEP 4 — FIND NEXT STAGE
    const next = progress.find(
      s => Number(s.stage_order) === Number(current.stage_order) + 1
    );

    if (!next) {
      // Final stage approved → mark fixture complete
      await markFixtureComplete(fixtureId, client);
      await client.query("COMMIT");
      console.log("[workflow] advanceFixtureWorkflowStage — all stages complete", {
        fixture_id: fixtureId,
        final_stage: current.stage_name,
      });
      return null;
    }

    // STEP 5 — SET NEXT STAGE TO PENDING
    await updateProgressRow(
      fixtureId,
      next.stage_name,
      {
        status: "PENDING",
        assigned_to: null,
        assigned_at: null,
        started_at: null,
        completed_at: null,
        duration_minutes: null,
        updated_at: new Date(),
      },
      client
    );

    await client.query("COMMIT");

    console.log("[workflow] advanceFixtureWorkflowStage — stage advanced", {
      fixture_id: fixtureId,
      from_stage: current.stage_name,
      to_stage: next.stage_name,
    });

    return next;

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[workflow] advanceFixtureWorkflowStage — error", {
      fixture_id: fixtureId,
      department_id: departmentId,
      error: err.message,
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolves the true fixture_id from the composite identity
 * (project_id, scope_id, fixture_no) and advances
 * the fixture_workflow_progress to the next stage.
 *
 * This is the SINGLE authoritative entry-point for workflow advancement
 * triggered by task approval.
 *
 * Flow:
 *  TASK APPROVED → advanceWorkflowAfterTaskApproval → advanceFixtureWorkflowStage → DB
 *
 * ❌ Never advance workflow from taskService directly.
 * ❌ Never use task.current_stage_id to drive workflow logic.
 */
async function advanceWorkflowAfterTaskApproval({ project_id, scope_id, fixture_no, department_id, fixture_id }) {
  if ((!project_id || !scope_id || !fixture_no) && !fixture_id) {
    console.warn("[WORKFLOW] advanceWorkflowAfterTaskApproval — canonical fixture identity missing, skipping", {
      project_id,
      scope_id,
      fixture_no,
      fixture_id,
      department_id,
    });
    return;
  }

  if (!department_id) {
    console.warn("[WORKFLOW] advanceWorkflowAfterTaskApproval — department_id missing, skipping", {
      project_id,
      scope_id,
      fixture_no,
      fixture_id,
    });
    return;
  }

  const resolvedIdentity = await resolveFixtureIdentityForAdvancement({
    project_id,
    scope_id,
    fixture_no,
    fixture_id,
    department_id,
  });

  const progress = await getProgressForFixture(resolvedIdentity.fixture_id, department_id);
  const current = progress.find((s) => s.status !== "APPROVED");

  console.log("[WORKFLOW] advanceWorkflowAfterTaskApproval — resolving advancement", {
    fixture: {
      project_id: resolvedIdentity.project_id,
      scope_id: resolvedIdentity.scope_id,
      fixture_no: resolvedIdentity.fixture_no,
    },
    fixtureId: resolvedIdentity.fixture_id,
    currentStage: current?.stage_name ?? "(all approved)",
    status: current?.status ?? "N/A",
  });

  await advanceFixtureWorkflowStage(resolvedIdentity);
}

async function releaseFixtureStageAssignment(fixtureId, departmentId) {
  if (!fixtureId || !departmentId) {
    return { released: false, currentStage: null };
  }

  const progress = await getProgressForFixture(fixtureId, departmentId);
  const current = deriveCurrentStageByStatus(progress);

  if (!current) {
    return { released: false, currentStage: null };
  }

  if (current.status !== "IN_PROGRESS") {
    return { released: false, currentStage: current };
  }

  await updateProgressRow(fixtureId, current.stage_name, {
    status: "PENDING",
    assigned_to: null,
    assigned_at: null,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
  });

  return { released: true, currentStage: current };
}

/**
 * Returns the full progress detail for a fixture (all stages with statuses).
 * Used for the workflow timeline display.
 */
async function getFullProgressForFixture(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);

  const workflow = await requireWorkflow(departmentId);

  let progress = await getProgressForFixture(fixtureId, departmentId);
  if (progress.length === 0) {
    progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);
  }

  return {
    workflow_name: workflow.name,
    stages: progress.map((row) => ({
      stage_name: row.stage_name,
      stage_order: row.stage_order,
      status: row.status,
      assigned_to: row.assigned_to,
      assigned_at: row.assigned_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_minutes: row.duration_minutes,
      updated_at: row.updated_at,
    })),
  };
}

/**
 * Returns assignable fixtures for a scope (excludes is_workflow_complete = true).
 */
async function listAssignableFixturesForScope(departmentId, scopeId) {
  return listAssignableFixtures(departmentId, scopeId);
}

module.exports = instrumentModuleExports("service.fixtureWorkflowService", {
  getWorkflowForDepartment,
  getCurrentStageForFixture,
  getCurrentStage,
  validateAssignment,
  assignFixtureStage,
  completeFixtureStage,
  approveFixtureStage,
  rejectFixtureStage,
  getFullProgressForFixture,
  listAssignableFixturesForScope,
  releaseFixtureStageAssignment,
  advanceFixtureWorkflowStage,
  advanceWorkflowAfterTaskApproval,
});
