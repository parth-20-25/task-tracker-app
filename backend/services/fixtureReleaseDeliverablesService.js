const { pool } = require("../db");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const {
  RELEASE_DELIVERABLE_APPLICABILITY,
  RELEASE_DELIVERABLE_CODES,
  RELEASE_DELIVERABLE_DEFINITIONS,
  RELEASE_DELIVERABLE_STATUSES,
  buildFixtureReleaseBlockers,
  getReleaseDeliverableDefinition,
  isReleaseStageName,
  isResolvedDeliverable,
} = require("../lib/fixtureReleaseDeliverables");
const { createAuditLog } = require("../repositories/auditRepository");
const releaseRepository = require("../repositories/fixtureReleaseDeliverablesRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const {
  isProjectAssignedTo2DTeamMember,
  projectHasActive2DRouting,
} = require("../repositories/projectSubdivisionRoutingRepository");
const {
  canAssignTo,
  canVerifyTask,
  hasPermission,
  isOperationalControllerRole,
} = require("./accessControlService");

function actorId(actor) {
  return String(actor?.employee_id || "").trim() || null;
}

function normalizeText(value, { required = false, field = "value", maxLength = 2000 } = {}) {
  const normalized = String(value || "").trim().slice(0, maxLength) || null;
  if (required && !normalized) {
    throw new AppError(400, `${field} is required`);
  }
  return normalized;
}

function normalizeAssigneeId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new AppError(400, "assignee_id is required");
  }
  if (normalized.length > 50) {
    throw new AppError(400, "assignee_id must be 50 characters or fewer");
  }
  return normalized;
}

function normalizeDueAt(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "due_at must be a valid date and time");
  }
  return parsed;
}

function decoratePackage(releasePackage) {
  if (!releasePackage) {
    return null;
  }
  return {
    ...releasePackage,
    deliverables: (releasePackage.deliverables || []).map((deliverable) => ({
      ...deliverable,
      deliverable_label: getReleaseDeliverableDefinition(deliverable.deliverable_code)?.label
        || deliverable.deliverable_code,
      events: Array.isArray(deliverable.events) ? deliverable.events : [],
    })),
  };
}

function hasResolvedPriorDeliverables(releasePackage, deliverable) {
  return !releasePackage.deliverables.some((entry) => (
    Number(entry.sequence) < Number(deliverable.sequence) && !isResolvedDeliverable(entry)
  ));
}

function canAssignReleaseDeliverables(actor) {
  return isOperationalControllerRole(actor) && hasPermission(actor, PERMISSIONS.ASSIGN_TASK);
}

function canReviewReleaseDeliverables(actor, releasePackage) {
  return canVerifyTask(actor, {
    department_id: releasePackage?.department_id || null,
    approval_stage: "manager",
  });
}

function canReleaseFixture(actor) {
  return isOperationalControllerRole(actor)
    && hasPermission(actor, PERMISSIONS.CHANGE_FIXTURE_STAGE);
}

function getDeliverableAvailableActions(actor, releasePackage, deliverable) {
  const actions = [];
  const employeeId = actorId(actor);
  const isAssignee = Boolean(employeeId) && employeeId === deliverable.assignee_id;
  const canReview = canReviewReleaseDeliverables(actor, releasePackage)
    && !isAssignee;
  const priorResolved = hasResolvedPriorDeliverables(releasePackage, deliverable);

  if (
    canAssignReleaseDeliverables(actor)
    && [
      RELEASE_DELIVERABLE_STATUSES.LOCKED,
      RELEASE_DELIVERABLE_STATUSES.READY,
      RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED,
    ].includes(deliverable.status)
    && deliverable.applicability_status !== RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED
  ) {
    actions.push("ASSIGN");
  }

  if (
    isAssignee
    && priorResolved
    && [
      RELEASE_DELIVERABLE_STATUSES.READY,
      RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED,
    ].includes(deliverable.status)
  ) {
    actions.push("START");
  }

  if (isAssignee && deliverable.status === RELEASE_DELIVERABLE_STATUSES.IN_PROGRESS) {
    actions.push("SUBMIT");
  }

  if (canReview && deliverable.status === RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL) {
    actions.push("REVIEW");
  }

  if (
    canReview
    && priorResolved
    && deliverable.deliverable_code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
    && deliverable.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED
  ) {
    actions.push("SET_APPLICABILITY");
  }

  return actions;
}

function decoratePackageForActor(actor, releasePackage) {
  if (!releasePackage) {
    return null;
  }

  const currentDeliverable = [...releasePackage.deliverables]
    .sort((left, right) => Number(left.sequence) - Number(right.sequence))
    .find((deliverable) => !isResolvedDeliverable(deliverable));
  const now = Date.now();

  return {
    ...releasePackage,
    deliverables: releasePackage.deliverables.map((deliverable) => {
      const dueAt = deliverable.due_at ? new Date(deliverable.due_at).getTime() : Number.NaN;
      return {
        ...deliverable,
        is_overdue: Number.isFinite(dueAt)
          && dueAt < now
          && !isResolvedDeliverable(deliverable),
        is_current_actionable: deliverable.id === currentDeliverable?.id,
        available_actions: getDeliverableAvailableActions(actor, releasePackage, deliverable),
      };
    }),
  };
}

function buildMainWorkflowStatus(progressRows) {
  const stages = progressRows.filter((stage) => !isReleaseStageName(stage.stage_name));
  const approved = stages.filter((stage) => stage.status === "APPROVED").length;

  if (stages.length === 0) {
    return { code: "NOT_STARTED", label: "Not Started" };
  }
  if (approved === stages.length) {
    return { code: "COMPLETED", label: "Completed" };
  }
  return { code: "IN_PROGRESS", label: approved + "/" + stages.length + " approved" };
}

function buildReleaseDeliverablesStatus(releasePackage) {
  const mandatoryTotal = RELEASE_DELIVERABLE_DEFINITIONS.filter(
    (definition) => definition.isRequired,
  ).length;
  if (!releasePackage) {
    return {
      code: "NOT_STARTED",
      label: "Not Started",
      approved: 0,
      total: mandatoryTotal,
    };
  }

  const byCode = new Map(
    releasePackage.deliverables.map((deliverable) => [deliverable.deliverable_code, deliverable]),
  );
  const mimic = byCode.get(RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY);
  const total = mandatoryTotal + (
    mimic?.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED ? 1 : 0
  );
  const approved = releasePackage.deliverables.filter((deliverable) => (
    deliverable.status === RELEASE_DELIVERABLE_STATUSES.APPROVED
    && (
      deliverable.deliverable_code !== RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
      || deliverable.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED
    )
  )).length;
  const complete = RELEASE_DELIVERABLE_DEFINITIONS.every(
    (definition) => isResolvedDeliverable(byCode.get(definition.code)),
  );

  return {
    code: complete ? "COMPLETE" : "IN_PROGRESS",
    label: complete ? "Complete" : approved + "/" + total + " approved",
    approved,
    total,
  };
}

function buildReleaseStatus(progressRows, releasePackage, blockers, allowedToRelease) {
  const releaseStage = progressRows.find((stage) => isReleaseStageName(stage.stage_name));
  const released = releaseStage?.status === "APPROVED"
    || releasePackage?.is_workflow_complete === true;

  if (released) {
    return { code: "RELEASED", label: "Released", can_release: false };
  }
  if (blockers.length === 0) {
    return {
      code: "READY_FOR_RELEASE",
      label: "Ready for Release",
      can_release: allowedToRelease,
    };
  }

  const blockedByDeliverables = blockers.some((blocker) => (
    blocker.deliverable
    || blocker.code === "RELEASE_PACKAGE_MISSING"
    || blocker.code === "MIMIC_APPLICABILITY_UNRESOLVED"
  ));
  return {
    code: "BLOCKED",
    label: blockedByDeliverables ? "Blocked by deliverables" : "Blocked by workflow",
    can_release: false,
  };
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function findDeliverable(releasePackage, deliverableId) {
  const deliverable = releasePackage.deliverables.find((entry) => entry.id === deliverableId);
  if (!deliverable) {
    throw new AppError(404, "Release deliverable not found for this fixture");
  }
  return deliverable;
}

function assertPriorDeliverablesResolved(releasePackage, deliverable) {
  const unresolvedPrior = releasePackage.deliverables.find((entry) => (
    Number(entry.sequence) < Number(deliverable.sequence) && !isResolvedDeliverable(entry)
  ));
  if (unresolvedPrior) {
    throw new AppError(409, "Only the next eligible release deliverable can start");
  }
}

function requirePackage(releasePackage) {
  if (!releasePackage) {
    throw new AppError(409, "The fixture does not have an eligible 2D release-deliverables package");
  }
  return releasePackage;
}

function assertApprover(actor, releasePackage, deliverable) {
  if (!canVerifyTask(actor, { department_id: releasePackage.department_id, approval_stage: "manager" })) {
    throw new AppError(403, "You do not have permission to review release deliverables");
  }
  if (actorId(actor) === deliverable.assignee_id) {
    throw new AppError(403, "A release deliverable assignee cannot approve or reject their own submission");
  }
}

async function recordEvent({ releasePackage, before, after, eventType, actor, reason = null, metadata = {} }, client) {
  const employeeId = actorId(actor);
  await releaseRepository.insertDeliverableEvent({
    deliverableId: before.id,
    eventType,
    previousStatus: before.status,
    newStatus: after.status,
    actorId: employeeId,
    reason,
    metadata,
  }, client);
  await createAuditLog({
    userEmployeeId: employeeId,
    actionType: `FIXTURE_RELEASE_DELIVERABLE_${eventType}`,
    targetType: "fixture_release_deliverable",
    targetId: before.id,
    metadata: {
      fixture_id: releasePackage.fixture_id,
      package_id: releasePackage.id,
      deliverable_code: before.deliverable_code,
      previous_status: before.status,
      new_status: after.status,
      reason,
      ...metadata,
    },
  }, client);
}

async function unlockNextEligible(releasePackage, completedDeliverable, client) {
  for (const candidate of releasePackage.deliverables) {
    if (Number(candidate.sequence) <= Number(completedDeliverable.sequence) || isResolvedDeliverable(candidate)) {
      continue;
    }
    if (candidate.status !== RELEASE_DELIVERABLE_STATUSES.LOCKED) {
      return null;
    }
    if (candidate.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED) {
      return null;
    }
    return releaseRepository.unlockDeliverable(candidate.id, client);
  }
  return null;
}

async function ensureFixtureReleasePackage({ fixtureId, createdBy = null }, client = pool) {
  const result = await releaseRepository.ensurePackageForApproved2D({ fixtureId, createdBy }, client);
  if (result.created && createdBy) {
    await createAuditLog({
      userEmployeeId: createdBy,
      actionType: "FIXTURE_RELEASE_PACKAGE_CREATED",
      targetType: "fixture_release_package",
      targetId: result.package.id,
      metadata: { fixture_id: fixtureId, version: result.package.version },
    }, client);
  }
  return decoratePackage(result.package);
}

async function getFixtureReleasePackage(fixtureId, client = pool) {
  return decoratePackage(await releaseRepository.getPackageByFixtureId(fixtureId, client));
}

async function getFixtureReleasePackageResponse(actor, fixtureId, progressRows = [], client = pool) {
  const releasePackage = await getFixtureReleasePackage(fixtureId, client);
  const blockers = buildFixtureReleaseBlockers(progressRows, releasePackage);
  const releasePermission = canReleaseFixture(actor);
  const releaseStatus = buildReleaseStatus(
    progressRows,
    releasePackage,
    blockers,
    releasePermission,
  );

  return {
    release_package: decoratePackageForActor(actor, releasePackage),
    statuses: {
      main_workflow: buildMainWorkflowStatus(progressRows),
      release_deliverables: buildReleaseDeliverablesStatus(releasePackage),
      release: releaseStatus,
    },
    blockers,
    available_actions: releaseStatus.can_release ? ["RELEASE"] : [],
  };
}

async function assignReleaseDeliverable(actor, fixtureId, deliverableId, payload = {}) {
  return withTransaction(async (client) => {
    const releasePackage = requirePackage(await releaseRepository.getPackageForUpdate(fixtureId, client));
    const deliverable = findDeliverable(releasePackage, deliverableId);
    const employeeId = actorId(actor);
    const assigneeId = normalizeAssigneeId(payload.assignee_id);

    if (!isOperationalControllerRole(actor) || !hasPermission(actor, PERMISSIONS.ASSIGN_TASK)) {
      throw new AppError(403, "Task assignment permission is required to assign release deliverables");
    }
    if (![RELEASE_DELIVERABLE_STATUSES.LOCKED, RELEASE_DELIVERABLE_STATUSES.READY, RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED].includes(deliverable.status)) {
      throw new AppError(409, `Deliverable cannot be assigned while ${deliverable.status}`);
    }
    if (deliverable.applicability_status === RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED) {
      throw new AppError(409, "Mimic Display applicability must be resolved before assignment");
    }

    const assignee = await findUserByEmployeeId(assigneeId, client);
    if (!assignee) {
      throw new AppError(403, "Release deliverable assignee is outside your assignable user scope");
    }
    const assigneeDepartmentId = String(assignee.department_id || "").trim().toLowerCase();
    const packageDepartmentId = String(releasePackage.department_id || "").trim().toLowerCase();
    if (!assigneeDepartmentId || assigneeDepartmentId !== packageDepartmentId) {
      throw new AppError(400, "Release deliverables can only be assigned to active Design 2D users");
    }
    if (!canAssignTo(actor, assignee)) {
      throw new AppError(403, "Release deliverable assignee is outside your assignable user scope");
    }
    if (String(assignee?.subdivision?.subdivision_name || "").trim().toLowerCase() !== "2d") {
      throw new AppError(400, "Release deliverables can only be assigned to active Design 2D users");
    }
    if (
      await projectHasActive2DRouting(releasePackage.project_id, client)
      && !(await isProjectAssignedTo2DTeamMember(releasePackage.project_id, assigneeId, client))
    ) {
      throw new AppError(403, "Release deliverables can only be assigned within the project's assigned 2D team");
    }

    const updated = await releaseRepository.assignDeliverable(deliverable.id, {
      assigneeId,
      dueAt: normalizeDueAt(payload.due_at),
    }, client);
    await recordEvent({
      releasePackage,
      before: deliverable,
      after: updated,
      eventType: "ASSIGNED",
      actor,
      metadata: { previous_assignee_id: deliverable.assignee_id || null, assignee_id: assigneeId },
    }, client);
    return getFixtureReleasePackage(fixtureId, client);
  });
}

async function startReleaseDeliverable(actor, fixtureId, deliverableId) {
  return withTransaction(async (client) => {
    const releasePackage = requirePackage(await releaseRepository.getPackageForUpdate(fixtureId, client));
    const deliverable = findDeliverable(releasePackage, deliverableId);
    assertPriorDeliverablesResolved(releasePackage, deliverable);
    if (deliverable.assignee_id !== actorId(actor)) {
      throw new AppError(403, "Only the assigned user can start this release deliverable");
    }
    if (![RELEASE_DELIVERABLE_STATUSES.READY, RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED].includes(deliverable.status)) {
      throw new AppError(409, `Deliverable cannot start while ${deliverable.status}`);
    }

    const updated = await releaseRepository.updateDeliverableStatus(
      deliverable.id,
      RELEASE_DELIVERABLE_STATUSES.IN_PROGRESS,
      { actorId: actorId(actor) },
      client,
    );
    await recordEvent({ releasePackage, before: deliverable, after: updated, eventType: "STARTED", actor }, client);
    return getFixtureReleasePackage(fixtureId, client);
  });
}

async function submitReleaseDeliverable(actor, fixtureId, deliverableId, payload = {}) {
  return withTransaction(async (client) => {
    const releasePackage = requirePackage(await releaseRepository.getPackageForUpdate(fixtureId, client));
    const deliverable = findDeliverable(releasePackage, deliverableId);
    if (deliverable.assignee_id !== actorId(actor)) {
      throw new AppError(403, "Only the assigned user can submit this release deliverable");
    }
    if (deliverable.status !== RELEASE_DELIVERABLE_STATUSES.IN_PROGRESS) {
      throw new AppError(409, `Deliverable cannot be submitted while ${deliverable.status}`);
    }
    const comment = normalizeText(payload.comment);
    const updated = await releaseRepository.updateDeliverableStatus(
      deliverable.id,
      RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL,
      { actorId: actorId(actor), comment },
      client,
    );
    await recordEvent({ releasePackage, before: deliverable, after: updated, eventType: "SUBMITTED", actor, reason: comment }, client);
    return getFixtureReleasePackage(fixtureId, client);
  });
}

async function reviewReleaseDeliverable(actor, fixtureId, deliverableId, payload = {}) {
  return withTransaction(async (client) => {
    const releasePackage = requirePackage(await releaseRepository.getPackageForUpdate(fixtureId, client));
    const deliverable = findDeliverable(releasePackage, deliverableId);
    assertApprover(actor, releasePackage, deliverable);
    if (deliverable.status !== RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL) {
      throw new AppError(409, `Deliverable cannot be reviewed while ${deliverable.status}`);
    }

    const decision = String(payload.decision || "").trim().toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      throw new AppError(400, "decision must be APPROVE or REJECT");
    }
    const reason = normalizeText(payload.reason, { required: decision === "REJECT", field: "reason" });
    const status = decision === "APPROVE"
      ? RELEASE_DELIVERABLE_STATUSES.APPROVED
      : RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED;
    const updated = await releaseRepository.updateDeliverableStatus(
      deliverable.id,
      status,
      { actorId: actorId(actor), comment: reason },
      client,
    );
    await recordEvent({ releasePackage, before: deliverable, after: updated, eventType: decision === "APPROVE" ? "APPROVED" : "REJECTED", actor, reason }, client);
    if (decision === "APPROVE") {
      await unlockNextEligible(releasePackage, deliverable, client);
    }
    await releaseRepository.refreshPackageStatus(releasePackage.id, client);
    return getFixtureReleasePackage(fixtureId, client);
  });
}

async function resolveMimicApplicability(actor, fixtureId, deliverableId, payload = {}) {
  return withTransaction(async (client) => {
    const releasePackage = requirePackage(await releaseRepository.getPackageForUpdate(fixtureId, client));
    const deliverable = findDeliverable(releasePackage, deliverableId);
    assertApprover(actor, releasePackage, deliverable);
    assertPriorDeliverablesResolved(releasePackage, deliverable);
    if (deliverable.deliverable_code !== RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY) {
      throw new AppError(400, "Applicability can only be set for Mimic Display");
    }
    if (deliverable.applicability_status !== RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED) {
      throw new AppError(409, "Mimic Display applicability is already resolved");
    }

    const applicability = String(payload.applicability || "").trim().toUpperCase();
    if (![RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED, RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE].includes(applicability)) {
      throw new AppError(400, "applicability must be REQUIRED or NOT_APPLICABLE");
    }
    const required = applicability === RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED;
    const reason = normalizeText(payload.reason, { required: !required, field: "reason" });
    const updated = await releaseRepository.setMimicApplicability(deliverable.id, {
      required,
      actorId: actorId(actor),
      reason,
    }, client);
    await recordEvent({ releasePackage, before: deliverable, after: updated, eventType: required ? "MARKED_REQUIRED" : "MARKED_NOT_APPLICABLE", actor, reason }, client);
    if (!required) {
      await unlockNextEligible(releasePackage, deliverable, client);
    }
    await releaseRepository.refreshPackageStatus(releasePackage.id, client);
    return getFixtureReleasePackage(fixtureId, client);
  });
}

async function getFixtureReleaseReadiness(fixtureId, progressRows, client = pool) {
  const releasePackage = await getFixtureReleasePackage(fixtureId, client);
  return {
    package: releasePackage,
    status: releasePackage?.status || null,
    blockers: buildFixtureReleaseBlockers(progressRows, releasePackage),
  };
}

async function assertProjectFixturesReleased(projectId, client = pool) {
  const fixtures = await releaseRepository.listUnreleasedProjectFixtures(projectId, client);
  if (fixtures.length > 0) {
    throw new AppError(409, "Project release is blocked until every fixture is explicitly released", {
      code: "PROJECT_RELEASE_BLOCKED",
      blockers: fixtures.map((fixture) => ({
        code: "FIXTURE_NOT_RELEASED",
        fixture_id: fixture.fixture_id,
        fixture_no: fixture.fixture_no,
        message: `${fixture.fixture_no || fixture.fixture_id} has not been released`,
      })),
    }, "PROJECT_RELEASE_BLOCKED");
  }
}

module.exports = {
  assertPriorDeliverablesResolved,
  assertProjectFixturesReleased,
  assignReleaseDeliverable,
  ensureFixtureReleasePackage,
  getFixtureReleasePackage,
  getFixtureReleasePackageResponse,
  getFixtureReleaseReadiness,
  resolveMimicApplicability,
  reviewReleaseDeliverable,
  startReleaseDeliverable,
  submitReleaseDeliverable,
};
