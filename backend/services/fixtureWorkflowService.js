const { AppError } = require("../lib/AppError");
const { PROJECT_STATUSES } = require("../config/constants");
const { pool } = require("../db");
const {
  getDesignStageDisplayName,
  normalizeDesignStageName,
} = require("../lib/designWorkflowStages");
const {
  formatStageVersionLabel,
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../lib/workflowStageVersioning");
const { instrumentModuleExports } = require("../lib/observability");
const {
  approveStageAttempt,
  getActiveWorkflowForDepartment,
  getProgressForFixture,
  getLatestStageAttempt,
  getNextStageReentryVersion,
  initProgressForFixture,
  incrementFixtureRevision,
  listFixtureRevisions,
  updateProgressRow,
  rejectStageAttempt,
  markFixtureComplete,
  markFixtureIncomplete,
  recordFixtureRevision,
  startStageAttempt,
  getFixtureWithDepartment,
  getFixtureWorkflowContext,
  resolveFixtureByCanonicalIdentity,
  listAssignableFixtures,
} = require("../repositories/fixtureWorkflowRepository");
const {
  insertStageContribution,
  listContributionsForFixtures,
  listStageContributions,
  markRemainingContributionActual,
  supersedeContribution,
} = require("../repositories/designStageContributionRepository");
const { insertCompletionSnapshot } = require("../repositories/designCompletionRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const { canAssignTo } = require("./accessControlService");
const { getDepartmentWorkflowStagesResponse } = require("./workflowRecoveryService");
const {
  assertDesignDepartmentForRevision,
  buildRevisionTimelineEntry,
  executeDesignStageRework,
} = require("./designRevisionService");

const FIXTURE_REVISION_TYPES = new Set([
  "CUSTOMER_CHANGE",
  "CUSTOMER_TRIAL_CHANGE",
  "CUSTOMER_REVISION",
  "INTERNAL_DESIGN_CHANGE",
  "MANUFACTURING_ISSUE",
  "QUALITY_CORRECTION",
  "COST_OPTIMIZATION",
  "APPROVAL_REJECTION",
  "PROCUREMENT_CONSTRAINT",
  "MANUAL_OVERRIDE",
  "OTHER",
]);

const WORKFLOW_STATUSES = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED_FOR_VERIFICATION: "SUBMITTED_FOR_VERIFICATION",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

const OPERATIONAL_STATES = {
  UNASSIGNED: "UNASSIGNED",
  ASSIGNED_NOT_STARTED: "ASSIGNED_NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED_FOR_VERIFICATION: "SUBMITTED_FOR_VERIFICATION",
  REJECTED: "REJECTED",
  APPROVED: "APPROVED",
};

const MANUAL_STAGE_STATUSES = new Set([
  WORKFLOW_STATUSES.PENDING,
  WORKFLOW_STATUSES.IN_PROGRESS,
  WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION,
  WORKFLOW_STATUSES.APPROVED,
  WORKFLOW_STATUSES.REJECTED,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that the fixture belongs to the given department.
 * Throws 403 on cross-department access, 404 if fixture not found.
 */
async function assertFixtureBelongsToDepartment(fixtureId, departmentId, client = pool) {
  const row = await getFixtureWithDepartment(fixtureId, departmentId, client);
  if (!row) {
    throw new AppError(404, "Fixture not found");
  }
  if (row.department_id !== departmentId) {
    throw new AppError(403, "Cross-department access is not allowed");
  }
}

function buildInactiveProjectReason(projectStatus) {
  return projectStatus === PROJECT_STATUSES.ON_HOLD
    ? "Project is on hold and cannot continue active fixture workflow"
    : "Project is completed and cannot continue active fixture workflow";
}

async function assertFixtureProjectIsActive(fixtureId, departmentId, client = pool) {
  const fixture = await getFixtureWorkflowContext(fixtureId, client);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  if (departmentId && fixture.department_id !== departmentId) {
    throw new AppError(404, "Fixture not found for the selected department");
  }

  const projectStatus = fixture.project_status || PROJECT_STATUSES.ACTIVE;
  if (projectStatus !== PROJECT_STATUSES.ACTIVE) {
    throw new AppError(409, buildInactiveProjectReason(projectStatus));
  }

  return fixture;
}

/**
 * Returns the active workflow for a department or throws a user-facing error.
 */
async function requireWorkflow(departmentId, client = pool) {
  const workflow = await getActiveWorkflowForDepartment(departmentId, client);
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
    await client.query(
      `
        UPDATE fixture_workflow_progress fwp
        SET status = $3,
            completed_at = COALESCE(fwp.completed_at, NOW()),
            assigned_to = NULL,
            assigned_at = NULL,
            started_at = NULL,
            duration_minutes = NULL,
            updated_at = NOW()
        FROM design.fixtures f
        WHERE f.id = $1
          AND fwp.fixture_id = f.id
          AND fwp.department_id = $2
          AND f.is_workflow_complete IS TRUE
          AND fwp.status <> $3
      `,
      [fixtureId, departmentId, WORKFLOW_STATUSES.APPROVED],
    );
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

function getLastStage(progressRows) {
  return [...progressRows].sort((a, b) => Number(b.stage_order) - Number(a.stage_order))[0] || null;
}

function normalizeStageLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveStageFromProgress(progressRows, { targetStageName = null, targetStageOrder = null } = {}) {
  const normalizedStageName = normalizeStageLookupValue(targetStageName);
  const normalizedStageOrder = Number(targetStageOrder);

  return progressRows.find((stage) => {
    if (Number.isFinite(normalizedStageOrder) && Number(stage.stage_order) === normalizedStageOrder) {
      return true;
    }

    if (!normalizedStageName) {
      return false;
    }

    return normalizeStageLookupValue(stage.stage_name) === normalizedStageName;
  }) || null;
}

function getBaseStageDisplayName(stageName) {
  const normalizedStageKey = normalizeDesignStageName(stageName);
  return getDesignStageDisplayName(normalizedStageKey, stageName || null) || stageName || null;
}

function getProgressStageLabel(stage) {
  if (!stage) {
    return null;
  }

  return formatStageVersionLabel(getBaseStageDisplayName(stage.stage_name), stage.stage_version);
}

function getProgressRevisionCode(stage) {
  if (!stage) {
    return null;
  }

  return formatStageRevisionCode(stage.stage_name, stage.stage_version);
}

function isReleaseStageName(stageName) {
  return normalizeDesignStageName(stageName) === "release";
}

function getReleaseStage(progressRows = []) {
  return progressRows.find((stage) => isReleaseStageName(stage.stage_name)) || null;
}

function getLatestDesignStageBeforeRelease(progressRows = []) {
  return [...progressRows]
    .filter((stage) => !isReleaseStageName(stage.stage_name))
    .sort((left, right) => Number(right.stage_order || 0) - Number(left.stage_order || 0))[0] || null;
}

function normalizeRevisionType(value, fallback = "OTHER") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!FIXTURE_REVISION_TYPES.has(normalized)) {
    throw new AppError(400, `Unsupported revision_type "${value}"`);
  }

  return normalized;
}

function normalizeOptionalReason(value) {
  return String(value || "").trim() || null;
}

async function applyProgressReopenState({ fixtureId, progress, targetStage, shouldIncrementTargetRevision, client }) {
  for (const stage of progress) {
    if (Number(stage.stage_order) < Number(targetStage.stage_order)) {
      await updateProgressRow(
        fixtureId,
        stage.stage_name,
        { status: "APPROVED" },
        client,
      );
      continue;
    }

    const isTargetStage = Number(stage.stage_order) === Number(targetStage.stage_order);
    const stageVersion = isTargetStage && shouldIncrementTargetRevision
      ? normalizeStageVersion(stage.stage_version) + 1
      : normalizeStageVersion(stage.stage_version);
    await updateProgressRow(
      fixtureId,
      stage.stage_name,
      {
        stage_version: stageVersion,
        status: "PENDING",
        assigned_to: null,
        assigned_at: null,
        started_at: null,
        completed_at: null,
        duration_minutes: null,
      },
      client,
    );
  }
}

async function applyManualStageState({ fixtureId, progress, targetStage, targetStatus, client }) {
  for (const stage of progress) {
    const stageOrder = Number(stage.stage_order);
    const targetOrder = Number(targetStage.stage_order);

    if (stageOrder < targetOrder || (stageOrder === targetOrder && targetStatus === "APPROVED")) {
      await updateProgressRow(fixtureId, stage.stage_name, { status: "APPROVED" }, client);
      continue;
    }

    if (stageOrder === targetOrder) {
      const stageVersion = await getNextStageReentryVersion(fixtureId, stage.stage_name, client);
      await updateProgressRow(
        fixtureId,
        stage.stage_name,
        {
          stage_version: stageVersion,
          status: targetStatus,
          assigned_to: null,
          assigned_at: null,
          started_at: null,
          completed_at: null,
          duration_minutes: null,
        },
        client,
      );
      continue;
    }

    const stageVersion = await getNextStageReentryVersion(fixtureId, stage.stage_name, client);
    await updateProgressRow(
      fixtureId,
      stage.stage_name,
      {
        stage_version: stageVersion,
        status: "PENDING",
        assigned_to: null,
        assigned_at: null,
        started_at: null,
        completed_at: null,
        duration_minutes: null,
      },
      client,
    );
  }
}

function buildCurrentStageResponse(progressRows, workflow) {
  const current = deriveCurrentStageByStatus(progressRows);

  if (!current) {
    return { stage: null, status: "APPROVED", stage_order: null, is_complete: true };
  }

  return {
    stage: getBaseStageDisplayName(current.stage_name),
    stage_label: getProgressStageLabel(current),
    stage_version: normalizeStageVersion(current.stage_version),
    revision_code: getProgressRevisionCode(current),
    status: current.status || "PENDING",
    stage_order: current.stage_order ?? null,
    is_complete: false,
  };
}

function resolveOperationalState(progressRow) {
  const status = String(progressRow?.status || WORKFLOW_STATUSES.PENDING).trim().toUpperCase();

  if (status === WORKFLOW_STATUSES.APPROVED) {
    return OPERATIONAL_STATES.APPROVED;
  }

  if (status === WORKFLOW_STATUSES.REJECTED) {
    return OPERATIONAL_STATES.REJECTED;
  }

  if (status === WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION) {
    return OPERATIONAL_STATES.SUBMITTED_FOR_VERIFICATION;
  }

  if (status === WORKFLOW_STATUSES.IN_PROGRESS) {
    return progressRow?.started_at
      ? OPERATIONAL_STATES.IN_PROGRESS
      : OPERATIONAL_STATES.ASSIGNED_NOT_STARTED;
  }

  return OPERATIONAL_STATES.UNASSIGNED;
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

function roundContributionPercent(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function sumContributionPercent(contributions) {
  return roundContributionPercent(
    contributions.reduce((sum, contribution) => sum + Number(contribution.contribution_percent || 0), 0),
  );
}

async function finalizeStageContributions({
  fixtureId,
  departmentId,
  stage,
  assignedTo,
  changedBy,
  taskId = null,
  client,
}) {
  if (!assignedTo) {
    throw new AppError(409, "Cannot finalize stage contribution without an assigned employee");
  }

  const stageName = stage.stage_name;
  const stageRevisionNo = normalizeStageVersion(stage.stage_version);
  const revisionCode = formatStageRevisionCode(stageName, stageRevisionNo);
  let contributions = await listStageContributions(fixtureId, stageName, revisionCode, client);

  for (const contribution of contributions) {
    if (contribution.contribution_kind === "REMAINING") {
      await markRemainingContributionActual(contribution.id, client);
    }
  }

  contributions = await listStageContributions(fixtureId, stageName, revisionCode, client);
  const currentTotal = sumContributionPercent(contributions);

  if (currentTotal > 100.001) {
    throw new AppError(409, "Stage contribution total exceeds 100%");
  }

  if (currentTotal < 99.999) {
    const latestAttempt = await getLatestStageAttempt(fixtureId, stageName, client);
    await insertStageContribution({
      fixture_id: fixtureId,
      department_id: departmentId,
      stage_name: stageName,
      revision_code: revisionCode,
      stage_revision_no: stageRevisionNo,
      employee_id: assignedTo,
      contribution_percent: roundContributionPercent(100 - currentTotal),
      contribution_kind: "ACTUAL",
      changed_by: changedBy || assignedTo,
      previous_stage: stageName,
      stage_instance_id: latestAttempt?.id || null,
      stage_attempt_no: latestAttempt?.attempt_no ?? null,
      metadata: {
        source: currentTotal === 0 ? "stage_approval_full_credit" : "stage_approval_remaining_credit",
        task_id: taskId,
      },
    }, client);
  }

  const finalContributions = await listStageContributions(fixtureId, stageName, revisionCode, client);
  const finalTotal = sumContributionPercent(finalContributions);
  if (Math.abs(finalTotal - 100) > 0.001) {
    throw new AppError(409, "Stage contribution total must equal 100% before approval");
  }

  return finalContributions;
}

async function tryFinalizeStageContributions(context) {
  try {
    return await finalizeStageContributions(context);
  } catch (error) {
    console.warn("[workflow] stage contribution finalization skipped", {
      fixture_id: context.fixtureId,
      department_id: context.departmentId,
      stage_name: context.stage?.stage_name || null,
      error: error?.message || "Unknown contribution finalization error",
      code: error?.code || error?.errorCode || null,
      constraint: error?.constraint || null,
    });
    return [];
  }
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
async function getCurrentStageForFixture(fixtureId, departmentId = null) {
  if (!fixtureId) {
    throw new AppError(400, "fixture_id is required");
  }

  const fixture = await getFixtureWorkflowContext(fixtureId);

  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  if (departmentId && fixture.department_id !== departmentId) {
    throw new AppError(404, "Fixture not found for the selected department");
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

  const workflow = await getActiveWorkflowForDepartment(project.department_id);

  if (!workflow || !workflow.department_id || workflow.department_id !== project.department_id) {
    return null;
  }

  const progress = await ensureProgressInitialized(fixtureId, project.department_id, workflow);

  return buildCurrentStageResponse(progress, workflow);
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

  const progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);

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

  const fixture = await getFixtureWorkflowContext(fixtureId);
  const projectStatus = fixture?.project_status || PROJECT_STATUSES.ACTIVE;
  if (projectStatus !== PROJECT_STATUSES.ACTIVE) {
    return { canAssign: false, reason: buildInactiveProjectReason(projectStatus), currentStage: null };
  }

  // Rule 1: no workflow
  const workflow = await getActiveWorkflowForDepartment(departmentId);
  if (!workflow || !workflow.stages || workflow.stages.length === 0) {
    return { canAssign: false, reason: "No workflow configured for this department", currentStage: null };
  }

  const progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);

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
  if (current.status === WORKFLOW_STATUSES.IN_PROGRESS) {
    return { canAssign: false, reason: "Stage already assigned", currentStage: current };
  }

  if (current.status === WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION) {
    return { canAssign: false, reason: "Stage is locked for verification", currentStage: current };
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
async function assignFixtureStage(fixtureId, departmentId, assignedTo, actor = null) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);
  await assertFixtureProjectIsActive(fixtureId, departmentId);

  const assignee = await findUserByEmployeeId(assignedTo);
  if (!assignee) {
    throw new AppError(400, "Assigned user not found");
  }

  if (assignee.department_id !== departmentId) {
    throw new AppError(400, "Assigned user does not belong to the selected department");
  }

  if (actor && !canAssignTo(actor, assignee)) {
    throw new AppError(403, "Cannot assign to this user");
  }

  const { canAssign, reason, currentStage } = await validateAssignment(fixtureId, departmentId);
  if (!canAssign) {
    throw new AppError(reason === "Stage already assigned" ? 400 : 409, reason);
  }

  if (isReleaseStageName(currentStage?.stage_name)) {
    throw new AppError(400, "Release is not a task assignment stage. Use the workflow release action.");
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

async function submitFixtureStageForVerification({ task, actor, client = pool }) {
  if (!task?.fixture_id || !task?.department_id) {
    throw new AppError(400, "Workflow task is missing fixture execution identity");
  }

  const progress = await getProgressForFixture(task.fixture_id, task.department_id, client);
  const current = deriveCurrentStageByStatus(progress);

  if (!current) {
    throw new AppError(409, "Fixture workflow is already approved");
  }

  if (current.status !== WORKFLOW_STATUSES.IN_PROGRESS) {
    throw new AppError(409, `Stage must be IN_PROGRESS before submission. Current status: ${current.status}`);
  }

  if (!current.assigned_to || current.assigned_to !== task.assigned_to) {
    throw new AppError(409, "Active workflow assignment does not match the task assignee");
  }

  const stageName = current.stage_name;
  const stageRevisionNo = normalizeStageVersion(current.stage_version);
  const revisionCode = formatStageRevisionCode(stageName, stageRevisionNo);
  const contributions = await listStageContributions(task.fixture_id, stageName, revisionCode, client);
  const total = sumContributionPercent(contributions);

  if (total > 100.001) {
    throw new AppError(409, "Stage contribution total exceeds 100%");
  }

  await updateProgressRow(task.fixture_id, stageName, {
    status: WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION,
    completed_at: new Date(),
  }, client);

  return current;
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
  void fixtureId;
  void departmentId;
  throw new AppError(409, "Workflow approval must be performed through task verification");
}

async function approveFixtureStageBypassDisabled(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);
  await assertFixtureProjectIsActive(fixtureId, departmentId);

  const fixture = await getFixtureWorkflowContext(fixtureId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  const nextStage = await advanceFixtureWorkflowStage({
    project_id: fixture.project_id,
    fixture_no: fixture.fixture_no,
    department_id: departmentId,
    fixture_id: fixture.fixture_id,
  });

  if (!nextStage) {
    return { stage: null, status: "APPROVED", stage_order: null, is_complete: true };
  }

  return getCurrentStage(fixtureId, departmentId);
}

/**
 * POST /api/workflows/reject
 * Supervisor: rejects the current submitted stage.
 */
async function rejectFixtureStage(fixtureId, departmentId) {
  void fixtureId;
  void departmentId;
  throw new AppError(409, "Workflow rejection must be performed through task verification");
}

async function rejectFixtureStageBypassDisabled(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);
  await assertFixtureProjectIsActive(fixtureId, departmentId);

  const progress = await getProgressForFixture(fixtureId, departmentId);
  const current = deriveCurrentStageByStatus(progress);

  if (!current) {
    throw new AppError(409, "Fixture is already fully completed");
  }

  if (current.status !== WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION) {
    throw new AppError(409, `Stage must be SUBMITTED_FOR_VERIFICATION before it can be rejected. Current status: ${current.status}`);
  }

  const timestamp = new Date();

  await updateProgressRow(fixtureId, current.stage_name, {
    status: "REJECTED",
    assigned_to: current.assigned_to,
    assigned_at: current.assigned_at,
    started_at: current.started_at,
    completed_at: null,
    duration_minutes: null,
  });
  await rejectStageAttempt(fixtureId, current.stage_name, timestamp);

  return getCurrentStage(fixtureId, departmentId);
}

async function resolveFixtureIdentityForAdvancement(identity, client = pool) {
  const departmentId = String(identity?.department_id || "").trim();
  const projectId = String(identity?.project_id || "").trim();
  const fixtureNo = String(identity?.fixture_no || "").trim();
  const fixtureId = String(identity?.fixture_id || "").trim();

  if (!departmentId) {
    throw new AppError(400, "department_id is required");
  }

  let fixture = null;

  if (projectId && fixtureNo) {
    fixture = await resolveFixtureByCanonicalIdentity(
      {
        project_id: projectId,
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
    fixture_no: fixture.fixture_no,
    project_no: fixture.project_no || null,
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

  const externalClient = identity?.client || null;
  const client = externalClient || await pool.connect();
  let fixtureId = String(identity?.fixture_id || "").trim() || null;

  try {
    if (!externalClient) {
      await client.query("BEGIN");
    }

    const resolvedIdentity = await resolveFixtureIdentityForAdvancement(identity, client);
    fixtureId = resolvedIdentity.fixture_id;
    const progress = await getProgressForFixture(fixtureId, departmentId, client);

    // STEP 1 — FIND CURRENT (FIRST NON-APPROVED)
    const current = progress.find(s => s.status !== "APPROVED");

    if (!current) {
      // All stages already approved → fixture is complete
      await markFixtureComplete(fixtureId, client);
      if (!externalClient) {
        await client.query("COMMIT");
      }
      console.log("[workflow] advanceFixtureWorkflowStage — fixture already complete", { fixture_id: fixtureId });
      return null;
    }

    // STEP 2 — VALIDATE STATE
    if (current.status !== WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION) {
      throw new Error(
        `[workflow] Cannot advance stage "${current.stage_name}" — expected SUBMITTED_FOR_VERIFICATION, got ${current.status}`
      );
    }

    await tryFinalizeStageContributions({
      fixtureId,
      departmentId,
      stage: current,
      assignedTo: current.assigned_to,
      changedBy: current.assigned_to,
      taskId: identity?.task_id || null,
      client,
    });

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
      if (!externalClient) {
        await client.query("COMMIT");
      }
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

    if (!externalClient) {
      await client.query("COMMIT");
    }

    console.log("[workflow] advanceFixtureWorkflowStage — stage advanced", {
      fixture_id: fixtureId,
      from_stage: current.stage_name,
      to_stage: next.stage_name,
    });

    return next;

  } catch (err) {
    if (!externalClient) {
      await client.query("ROLLBACK");
    }
    console.error("[workflow] advanceFixtureWorkflowStage — error", {
      fixture_id: fixtureId,
      department_id: departmentId,
      error: err.message,
    });
    throw err;
  } finally {
    if (!externalClient) {
      client.release();
    }
  }
}

/**
 * Resolves the true fixture_id from the project fixture identity
 * (project_id, fixture_no) and advances
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
async function advanceWorkflowAfterTaskApproval({ project_id, fixture_no, department_id, fixture_id, task_id = null, client = null }) {
  if ((!project_id || !fixture_no) && !fixture_id) {
    console.warn("[WORKFLOW] advanceWorkflowAfterTaskApproval — canonical fixture identity missing, skipping", {
      project_id,
      fixture_no,
      fixture_id,
      department_id,
    });
    return;
  }

  if (!department_id) {
    console.warn("[WORKFLOW] advanceWorkflowAfterTaskApproval — department_id missing, skipping", {
      project_id,
      fixture_no,
      fixture_id,
    });
    return;
  }

  const resolvedIdentity = await resolveFixtureIdentityForAdvancement({
    project_id,
    fixture_no,
    fixture_id,
    department_id,
  }, client || pool);

  const progress = await getProgressForFixture(resolvedIdentity.fixture_id, department_id, client || pool);
  const current = progress.find((s) => s.status !== "APPROVED");

  console.log("[WORKFLOW] advanceWorkflowAfterTaskApproval — resolving advancement", {
    fixture: {
      project_id: resolvedIdentity.project_id,
      fixture_no: resolvedIdentity.fixture_no,
    },
    fixtureId: resolvedIdentity.fixture_id,
    currentStage: current?.stage_name ?? "(all approved)",
    status: current?.status ?? "N/A",
  });

  await advanceFixtureWorkflowStage({
    ...resolvedIdentity,
    task_id,
    client,
  });
}

async function releaseFixtureStageAssignment(fixtureId, departmentId, client = pool) {
  if (!fixtureId || !departmentId) {
    return { released: false, currentStage: null };
  }

  const progress = await getProgressForFixture(fixtureId, departmentId, client);
  const current = deriveCurrentStageByStatus(progress);

  if (!current) {
    return { released: false, currentStage: null };
  }

  if (
    current.status === WORKFLOW_STATUSES.SUBMITTED_FOR_VERIFICATION
    || ![WORKFLOW_STATUSES.PENDING, WORKFLOW_STATUSES.IN_PROGRESS, WORKFLOW_STATUSES.REJECTED].includes(current.status)
  ) {
    return { released: false, currentStage: current };
  }

  const revisionCode = getProgressRevisionCode(current);
  if (revisionCode) {
    const contributions = await listStageContributions(fixtureId, current.stage_name, revisionCode, client);
    for (const contribution of contributions) {
      await supersedeContribution(contribution.id, null, client);
    }
  }

  const latestAttempt = await getLatestStageAttempt(fixtureId, current.stage_name, client);
  if (latestAttempt && !["APPROVED", "REJECTED"].includes(latestAttempt.status)) {
    await client.query(
      `
        UPDATE fixture_workflow_stage_attempts
        SET assigned_to = NULL,
            assigned_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            duration_minutes = NULL,
            approved_at = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [latestAttempt.id],
    );
  }

  await updateProgressRow(fixtureId, current.stage_name, {
    status: "PENDING",
    assigned_to: null,
    assigned_at: null,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
  }, client);
  await markFixtureIncomplete(fixtureId, client);

  return { released: true, currentStage: current };
}

async function releaseFixtureWorkflow({ actor = null, fixtureId, departmentId }) {
  const client = await pool.connect();
  let response = null;

  try {
    await client.query("BEGIN");

    await assertFixtureBelongsToDepartment(fixtureId, departmentId, client);
    const fixtureBeforeRelease = await assertFixtureProjectIsActive(fixtureId, departmentId, client);
    const workflow = await requireWorkflow(departmentId, client);

    await initProgressForFixture(fixtureId, departmentId, workflow.stages, client);
    await client.query(
      "SELECT id FROM fixture_workflow_progress WHERE fixture_id = $1::uuid AND department_id = $2 FOR UPDATE",
      [fixtureId, departmentId],
    );

    const progress = await getProgressForFixture(fixtureId, departmentId, client);
    const lockedReleaseStage = getReleaseStage(progress);
    if (!lockedReleaseStage) {
      throw new AppError(409, "Release stage is not configured for this department workflow");
    }

    const timestamp = new Date();
    const releaseStageOrder = Number(lockedReleaseStage.stage_order || 0);
    const stagesToApprove = progress.filter((stage) => (
      Number(stage.stage_order || 0) <= releaseStageOrder
      && stage.status !== WORKFLOW_STATUSES.APPROVED
    ));
    const fixtureAlreadyReleased = fixtureBeforeRelease?.is_workflow_complete === true
      && stagesToApprove.length === 0
      && progress.every((stage) => stage.status === WORKFLOW_STATUSES.APPROVED);

    let finalProgress = progress;

    if (!fixtureAlreadyReleased) {
      for (const stage of stagesToApprove) {
        if (!isReleaseStageName(stage.stage_name)) {
          await tryFinalizeStageContributions({
            fixtureId,
            departmentId,
            stage,
            assignedTo: stage.assigned_to,
            changedBy: actor?.employee_id || stage.assigned_to,
            taskId: null,
            client,
          });
        }

        const completedAt = stage.completed_at || timestamp;
        const fields = {
          status: WORKFLOW_STATUSES.APPROVED,
          completed_at: completedAt,
        };

        if (stage.duration_minutes == null && stage.started_at && completedAt) {
          fields.duration_minutes = calculateStageDurationMinutes(stage.started_at, completedAt);
        }

        if (isReleaseStageName(stage.stage_name)) {
          fields.assigned_to = null;
          fields.assigned_at = null;
          fields.started_at = null;
          fields.duration_minutes = null;
        }

        await updateProgressRow(fixtureId, stage.stage_name, fields, client);
        await approveStageAttempt(fixtureId, stage.stage_name, timestamp, client);
      }

      await markFixtureComplete(fixtureId, client);
      finalProgress = await getProgressForFixture(fixtureId, departmentId, client);

      const latestDesignStage = getLatestDesignStageBeforeRelease(finalProgress);
      const fixtureContext = await getFixtureWorkflowContext(fixtureId, client);

      await insertCompletionSnapshot({
        fixture_id: fixtureId,
        project_id: fixtureContext?.project_id || null,
        scope: "fixture",
        trigger: "workflow_release",
        payload: {
          fixture_id: fixtureId,
          project_id: fixtureContext?.project_id || null,
          department_id: departmentId,
          release: {
            released_at: timestamp.toISOString(),
            released_by: actor?.employee_id || null,
            release_stage_name: lockedReleaseStage.stage_name,
            current_revision_code: latestDesignStage ? getProgressRevisionCode(latestDesignStage) : null,
            current_revision_stage: latestDesignStage?.stage_name || null,
            current_stage_version: latestDesignStage ? normalizeStageVersion(latestDesignStage.stage_version) : null,
          },
          progress: finalProgress.map((stage) => ({
            stage_name: stage.stage_name,
            stage_order: stage.stage_order,
            stage_version: normalizeStageVersion(stage.stage_version),
            revision_code: getProgressRevisionCode(stage),
            status: stage.status,
            assigned_to: stage.assigned_to || null,
            assigned_at: stage.assigned_at || null,
            started_at: stage.started_at || null,
            completed_at: stage.completed_at || null,
          })),
        },
      }, client);
    }

    response = buildCurrentStageResponse(finalProgress, workflow);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.info("[workflow] releaseFixtureWorkflow completed", {
    fixture_id: fixtureId,
    department_id: departmentId,
    released_by: actor?.employee_id || null,
  });

  return response;
}

/**
 * Returns the full progress detail for a fixture (all stages with statuses).
 * Used for the workflow timeline display.
 */
async function getFullProgressForFixture(fixtureId, departmentId) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);

  const workflow = await requireWorkflow(departmentId);
  const fixture = await getFixtureWorkflowContext(fixtureId);

  const progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);
  const [revisions, contributionRows] = await Promise.all([
    listFixtureRevisions(fixtureId, departmentId),
    listContributionsForFixtures([fixtureId]),
  ]);
  const contributionsByStageRevision = contributionRows.reduce((map, contribution) => {
    const key = `${contribution.stage_name}::${contribution.revision_code}`;
    const entries = map.get(key) || [];
    entries.push(contribution);
    map.set(key, entries);
    return map;
  }, new Map());

  return {
    workflow_name: workflow.name,
    revision_no: Number(fixture?.revision_no || 0),
    is_legacy_workflow: fixture?.is_legacy_workflow === true,
    stages: progress.map((row) => ({
      stage_name: row.stage_name,
      stage_label: getProgressStageLabel(row),
      stage_version: normalizeStageVersion(row.stage_version),
      revision_code: getProgressRevisionCode(row),
      stage_order: row.stage_order,
      status: row.status,
      operational_state: resolveOperationalState(row),
      assigned_to: row.assigned_to,
      assigned_at: row.assigned_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_minutes: row.duration_minutes,
      updated_at: row.updated_at,
      contributions: contributionsByStageRevision.get(`${row.stage_name}::${getProgressRevisionCode(row)}`) || [],
    })),
    revisions: revisions.map((row, index) => {
      const previousRevision = revisions[index + 1]?.revision_code || null;
      return buildRevisionTimelineEntry(row, previousRevision);
    }),
  };
}

/**
 * Returns assignable fixtures for a project (excludes is_workflow_complete = true).
 */
async function listAssignableFixturesForProject(departmentId, projectId) {
  return listAssignableFixtures(departmentId, projectId);
}

async function reopenFixtureStage({
  actor,
  fixtureId,
  departmentId,
  targetStageName = null,
  targetStageOrder = null,
  revisionType,
  revisionReason,
  remarks = null,
  requestedBy = null,
  approvedBy = null,
}) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);
  await assertFixtureProjectIsActive(fixtureId, departmentId);
  assertDesignDepartmentForRevision(departmentId);

  const workflow = await requireWorkflow(departmentId);
  const progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);

  const targetStage = resolveStageFromProgress(progress, { targetStageName, targetStageOrder });
  if (!targetStage) {
    throw new AppError(400, "Target stage was not found in the fixture workflow");
  }

  await executeDesignStageRework({
    actor,
    fixtureId,
    departmentId,
    targetStageName,
    targetStageOrder,
    reasonType: revisionType,
    revisionReason,
    remarks,
    requestedBy,
    approvedBy,
  });

  return getFullProgressForFixture(fixtureId, departmentId);
}

async function manipulateFixtureStage({
  actor,
  fixtureId,
  departmentId,
  targetStageName = null,
  targetStageOrder = null,
  targetStatus = "PENDING",
  reasonType = "MANUAL_OVERRIDE",
  revisionReason,
  remarks = null,
}) {
  await assertFixtureBelongsToDepartment(fixtureId, departmentId);
  await assertFixtureProjectIsActive(fixtureId, departmentId);
  assertDesignDepartmentForRevision(departmentId);

  const fixture = await getFixtureWorkflowContext(fixtureId);
  const normalizedReasonType = normalizeRevisionType(reasonType, "MANUAL_OVERRIDE");
  if (normalizedReasonType !== "MANUAL_OVERRIDE") {
    throw new AppError(400, "Manual override reason type is required");
  }

  const normalizedTargetStatus = String(targetStatus || "PENDING").trim().toUpperCase();
  if (!MANUAL_STAGE_STATUSES.has(normalizedTargetStatus)) {
    throw new AppError(400, `Unsupported target_status "${targetStatus}"`);
  }

  const normalizedRevisionReason = normalizeOptionalReason(revisionReason);
  const normalizedRemarks = String(remarks || "").trim() || null;
  const overrideReason = normalizedRevisionReason || normalizedRemarks;
  if (!overrideReason) {
    throw new AppError(400, "Manual override reason is required");
  }

  const workflow = await requireWorkflow(departmentId);
  const progress = await ensureProgressInitialized(fixtureId, departmentId, workflow);

  const targetStage = resolveStageFromProgress(progress, { targetStageName, targetStageOrder });
  if (!targetStage) {
    throw new AppError(400, "Target stage was not found in the fixture workflow");
  }

  const fromStage = deriveCurrentStageByStatus(progress) || getLastStage(progress);
  if (!fromStage) {
    throw new AppError(409, "Fixture workflow has no stages to manipulate");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await initProgressForFixture(fixtureId, departmentId, workflow.stages, client);
    const lockedProgress = await getProgressForFixture(fixtureId, departmentId, client);
    const lockedTargetStage = resolveStageFromProgress(lockedProgress, { targetStageName, targetStageOrder });
    const lockedFromStage = deriveCurrentStageByStatus(lockedProgress) || getLastStage(lockedProgress);

    if (!lockedTargetStage || !lockedFromStage) {
      throw new AppError(409, "Fixture workflow changed while processing manual override");
    }

    const nextRevisionNo = await incrementFixtureRevision(fixtureId, client);
    await applyManualStageState({
      fixtureId,
      progress: lockedProgress,
      targetStage: lockedTargetStage,
      targetStatus: normalizedTargetStatus,
      client,
    });
    const manipulatedProgress = await getProgressForFixture(fixtureId, departmentId, client);
    const versionedTargetStage = resolveStageFromProgress(manipulatedProgress, { targetStageName, targetStageOrder })
      || lockedTargetStage;
    const fromStageLabel = getProgressStageLabel(lockedFromStage);
    const toStageLabel = getProgressStageLabel(versionedTargetStage);
    const revisionCode = getProgressRevisionCode(versionedTargetStage);

    if (
      normalizedTargetStatus === "APPROVED"
      && Number(lockedTargetStage.stage_order) === Math.max(...lockedProgress.map((stage) => Number(stage.stage_order)))
    ) {
      await markFixtureComplete(fixtureId, client);
    } else {
      await markFixtureIncomplete(fixtureId, client);
    }

    await recordFixtureRevision({
      fixture_id: fixtureId,
      department_id: departmentId,
      revision_no: nextRevisionNo,
      stage_name: lockedTargetStage.stage_name,
      stage_version: normalizeStageVersion(versionedTargetStage.stage_version),
      revision_code: revisionCode,
      reason_type: normalizedReasonType,
      revision_type: normalizedReasonType,
      revision_reason: overrideReason,
      revision_remarks: normalizedRemarks,
      reverted_from_stage: fromStageLabel || lockedFromStage.stage_name,
      reverted_to_stage: toStageLabel || lockedTargetStage.stage_name,
      requested_by: actor.employee_id,
      approved_by: actor.employee_id,
      changed_by: actor.employee_id,
      metadata: {
        operation: "manual_fixture_stage_manipulation",
        from_stage_name: lockedFromStage.stage_name,
        from_stage_version: normalizeStageVersion(lockedFromStage.stage_version),
        from_stage_label: fromStageLabel,
        to_stage_name: lockedTargetStage.stage_name,
        to_stage_version: normalizeStageVersion(versionedTargetStage.stage_version),
        to_stage_label: toStageLabel,
        revision_code: revisionCode,
        from_status: lockedFromStage.status,
        target_status: normalizedTargetStatus,
        manual_override: true,
        actor_user_id: actor.employee_id,
        timestamp: new Date().toISOString(),
      },
    }, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getFullProgressForFixture(fixtureId, departmentId);
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
  listAssignableFixturesForProject,
  manipulateFixtureStage,
  reopenFixtureStage,
  releaseFixtureStageAssignment,
  releaseFixtureWorkflow,
  advanceFixtureWorkflowStage,
  advanceWorkflowAfterTaskApproval,
  submitFixtureStageForVerification,
  resolveOperationalState,
  WORKFLOW_STATUSES,
  OPERATIONAL_STATES,
});
