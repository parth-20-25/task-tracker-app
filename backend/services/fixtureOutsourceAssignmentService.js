const { PERMISSIONS } = require("../config/constants");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const {
  OUTSOURCE_ASSIGNMENT_STATUSES,
  OUTSOURCE_SKIP_CODES,
  assertOutsourceStatusTransition,
  classifyFixtureOutsourceEligibility,
  validateBulkOutsourcePayload,
  validateOutsourceStatusPayload,
  validateReasonPayload,
  validateVendorPayload,
} = require("../lib/fixtureOutsourceAssignments");
const { createAuditLog } = require("../repositories/auditRepository");
const repository = require("../repositories/fixtureOutsourceAssignmentRepository");
const { hasPermission } = require("./accessControlService");

function actorId(user) {
  return String(user?.employee_id || user?.id || "").trim();
}

function assertPermission(user, permission, message) {
  if (!hasPermission(user, permission)) {
    throw new AppError(403, message || "You do not have permission to perform this action");
  }
}

function assertAnyPermission(user, permissions, message) {
  if (!permissions.some((permission) => hasPermission(user, permission))) {
    throw new AppError(403, message || "You do not have permission to perform this action");
  }
}

function buildMissingSelectedSkips(fixtureIds, rows) {
  const found = new Set(rows.map((row) => row.fixture_id));
  return fixtureIds
    .filter((fixtureId) => !found.has(fixtureId))
    .map((fixtureId) => ({
      fixture_id: fixtureId,
      code: OUTSOURCE_SKIP_CODES.FIXTURE_NOT_IN_PROJECT,
      message: "Fixture does not belong to the selected project or is outside your permitted scope",
    }));
}

function partitionScopeRows(rows) {
  const eligible = [];
  const skipped = [];

  for (const row of rows) {
    const reason = classifyFixtureOutsourceEligibility(row);
    if (!reason) {
      eligible.push(row);
      continue;
    }
    skipped.push({
      fixture_id: row.fixture_id,
      fixture_no: row.fixture_no || null,
      ...reason,
    });
  }

  return { eligible, skipped };
}

async function resolveScopeForOperation(user, payload, client, { lock = false } = {}) {
  const project = await repository.findVisibleProjectForOutsource(
    user,
    payload.project_id,
    client,
    { lock },
  );
  if (!project) {
    throw new AppError(404, "Project not found or outside your permitted scope");
  }

  const rows = await repository.resolveFixtureOutsourceScope({
    actor: user,
    projectId: payload.project_id,
    workflowStageCode: payload.workflow_stage_code,
    scope: payload.scope,
    fixtureIds: payload.fixture_ids,
    lock,
  }, client);
  const result = partitionScopeRows(rows);
  if (payload.scope === "selected") {
    result.skipped.push(...buildMissingSelectedSkips(payload.fixture_ids, rows));
  }

  return {
    project,
    rows,
    ...result,
    requested: payload.scope === "selected" ? payload.fixture_ids.length : rows.length,
  };
}

async function assertVendorAndCoordinator(user, payload, client) {
  const vendor = await repository.findVendorById(payload.vendor_id, client);
  const coordinator = await repository.findCoordinatorForOutsourceScope({
    actor: user,
    projectId: payload.project_id,
    coordinatorId: payload.internal_coordinator_id,
    workflowStageCode: payload.workflow_stage_code,
  }, client);

  if (!vendor) {
    throw new AppError(400, "Vendor not found or inactive");
  }
  if (!coordinator) {
    throw new AppError(403, "Internal coordinator is outside the applicable project or team scope or lacks outsourcing review permission");
  }

  return { vendor, coordinator };
}

async function previewFixtureOutsourceScopeForUser(user, payload = {}) {
  assertPermission(
    user,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    "Fixture outsourcing permission is required",
  );
  const normalized = validateBulkOutsourcePayload(payload);
  const scope = await resolveScopeForOperation(user, normalized, pool);
  await assertVendorAndCoordinator(user, normalized, pool);

  return {
    project: scope.project,
    workflow_stage: normalized.workflow_stage,
    workflow_stage_code: normalized.workflow_stage_code,
    scope: normalized.scope,
    requested: scope.requested,
    eligible: scope.eligible.length,
    eligible_fixture_ids: scope.eligible.map((row) => row.fixture_id),
    skipped: scope.skipped,
  };
}

async function bulkOutsourceFixtureStagesForUser(user, payload = {}) {
  assertPermission(
    user,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    "Fixture outsourcing permission is required",
  );
  assertPermission(
    user,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_BULK,
    "Bulk fixture outsourcing permission is required",
  );
  const normalized = validateBulkOutsourcePayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const scope = await resolveScopeForOperation(user, normalized, client, { lock: true });
    const { vendor, coordinator } = await assertVendorAndCoordinator(user, normalized, client);
    const assignments = await repository.insertFixtureOutsourceAssignments(
      scope.eligible,
      {
        ...normalized,
        workflow_stage: normalized.workflow_stage_code,
        outsourced_by: actorId(user),
      },
      client,
    );
    const insertedFixtureIds = new Set(assignments.map((assignment) => assignment.fixture_id));
    const raceSkips = scope.eligible
      .filter((row) => !insertedFixtureIds.has(row.fixture_id))
      .map((row) => ({
        fixture_id: row.fixture_id,
        fixture_no: row.fixture_no || null,
        code: OUTSOURCE_SKIP_CODES.ALREADY_OUTSOURCED,
        message: "Fixture stage is already outsourced",
      }));

    await repository.insertFixtureOutsourceAssignmentEvents(
      assignments.map((assignment) => ({
        assignment_id: assignment.id,
        event_type: "OUTSOURCED",
        previous_status: null,
        new_status: OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED,
        actor_id: actorId(user),
        reason: null,
        metadata: {
          project_id: normalized.project_id,
          fixture_id: assignment.fixture_id,
          workflow_stage: normalized.workflow_stage,
          scope: normalized.scope,
          vendor_id: vendor.id,
          internal_coordinator_id: coordinator.employee_id,
        },
      })),
      client,
    );

    await createAuditLog({
      userEmployeeId: actorId(user),
      actionType: "DESIGN_FIXTURE_STAGES_OUTSOURCED_BULK",
      targetType: "design_project",
      targetId: normalized.project_id,
      metadata: {
        workflow_stage: normalized.workflow_stage,
        workflow_stage_code: normalized.workflow_stage_code,
        scope: normalized.scope,
        requested: scope.requested,
        outsourced: assignments.length,
        vendor_id: vendor.id,
        internal_coordinator_id: coordinator.employee_id,
        fixture_ids: assignments.map((assignment) => assignment.fixture_id),
        skipped: [...scope.skipped, ...raceSkips],
      },
    }, client);

    await client.query("COMMIT");
    return {
      requested: scope.requested,
      outsourced: assignments.length,
      assignments,
      skipped: [...scope.skipped, ...raceSkips],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listVendorsForUser(user, options = {}) {
  assertAnyPermission(user, [
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE,
    PERMISSIONS.DESIGN_VENDOR_MANAGE,
  ], "Fixture outsourcing permission is required");
  const includeInactive = options.include_inactive === true || options.include_inactive === "true";
  if (includeInactive) {
    assertPermission(user, PERMISSIONS.DESIGN_VENDOR_MANAGE, "Vendor management permission is required");
  }
  return repository.listVendors({ includeInactive });
}

async function createVendorForUser(user, payload = {}) {
  assertPermission(user, PERMISSIONS.DESIGN_VENDOR_MANAGE, "Vendor management permission is required");
  const vendor = validateVendorPayload(payload);
  try {
    const created = await repository.createVendor(vendor, actorId(user));
    await createAuditLog({
      userEmployeeId: actorId(user),
      actionType: "DESIGN_VENDOR_CREATED",
      targetType: "design_vendor",
      targetId: created.id,
      metadata: {
        name: created.name,
        code: created.code || null,
      },
    });
    return created;
  } catch (error) {
    if (error?.code === "23505") {
      throw new AppError(409, "A vendor with this name or code already exists");
    }
    throw error;
  }
}

async function listProjectOutsourceAssignmentsForUser(user, projectId) {
  assertAnyPermission(user, [
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_CANCEL,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW,
  ], "Fixture outsourcing permission is required");
  const project = await repository.findVisibleProjectForOutsource(user, projectId);
  if (!project) {
    throw new AppError(404, "Project not found or outside your permitted scope");
  }
  return repository.listProjectFixtureOutsourceAssignments(user, projectId);
}

async function changeFixtureOutsourceStatusForUser(user, assignmentId, payload = {}) {
  const normalized = validateOutsourceStatusPayload(payload);
  if ([
    OUTSOURCE_ASSIGNMENT_STATUSES.PENDING_INTERNAL_REVIEW,
    OUTSOURCE_ASSIGNMENT_STATUSES.CHANGES_REQUIRED,
    OUTSOURCE_ASSIGNMENT_STATUSES.APPROVED,
  ].includes(normalized.status)) {
    assertPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW, "Outsourcing review permission is required");
  } else {
    assertPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE, "Outsourcing management permission is required");
  }

  if (normalized.status === OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED) {
    throw new AppError(400, "Use the outsourcing cancellation action");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const assignment = await repository.findFixtureOutsourceAssignmentForUser(
      user,
      assignmentId,
      client,
      { lock: true },
    );
    if (!assignment) {
      throw new AppError(404, "Outsourcing assignment not found");
    }
    if (
      [OUTSOURCE_ASSIGNMENT_STATUSES.CHANGES_REQUIRED, OUTSOURCE_ASSIGNMENT_STATUSES.APPROVED]
        .includes(normalized.status)
      && assignment.internal_coordinator_id !== actorId(user)
      && !hasPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE)
    ) {
      throw new AppError(403, "Only the internal coordinator or an outsourcing manager can review this work");
    }

    assertOutsourceStatusTransition(assignment.status, normalized.status);
    const updated = await repository.updateFixtureOutsourceAssignmentStatus(
      assignment.id,
      normalized.status,
      client,
    );
    await repository.insertFixtureOutsourceAssignmentEvents([{
      assignment_id: assignment.id,
      event_type: "STATUS_CHANGED",
      previous_status: assignment.status,
      new_status: normalized.status,
      actor_id: actorId(user),
      reason: normalized.reason,
      metadata: {},
    }], client);
    await createAuditLog({
      userEmployeeId: actorId(user),
      actionType: "DESIGN_FIXTURE_OUTSOURCE_STATUS_CHANGED",
      targetType: "fixture_outsource_assignment",
      targetId: assignment.id,
      metadata: {
        fixture_id: assignment.fixture_id,
        workflow_stage_code: assignment.workflow_stage_code,
        previous_status: assignment.status,
        new_status: normalized.status,
      },
    }, client);
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelAssignment(user, assignmentId, payload, eventType) {
  const normalized = validateReasonPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const assignment = await repository.findFixtureOutsourceAssignmentForUser(
      user,
      assignmentId,
      client,
      { lock: true },
    );
    if (!assignment) {
      throw new AppError(404, "Outsourcing assignment not found");
    }
    if (assignment.status === OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED) {
      throw new AppError(409, "Outsourcing assignment is already cancelled");
    }
    if (assignment.status === OUTSOURCE_ASSIGNMENT_STATUSES.APPROVED) {
      throw new AppError(409, "Approved outsourcing work cannot be cancelled after internal handoff");
    }

    const cancelled = await repository.cancelFixtureOutsourceAssignment(
      assignment.id,
      normalized.reason,
      client,
    );
    await repository.resetFixtureStageToAssignable(assignment, client);
    await repository.insertFixtureOutsourceAssignmentEvents([{
      assignment_id: assignment.id,
      event_type: eventType,
      previous_status: assignment.status,
      new_status: OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
      actor_id: actorId(user),
      reason: normalized.reason,
      metadata: {},
    }], client);
    await createAuditLog({
      userEmployeeId: actorId(user),
      actionType: eventType === "CONVERTED_TO_INTERNAL"
        ? "DESIGN_FIXTURE_OUTSOURCE_CONVERTED_TO_INTERNAL"
        : "DESIGN_FIXTURE_OUTSOURCE_CANCELLED",
      targetType: "fixture_outsource_assignment",
      targetId: assignment.id,
      metadata: {
        fixture_id: assignment.fixture_id,
        workflow_stage_code: assignment.workflow_stage_code,
        reason: normalized.reason,
      },
    }, client);
    await client.query("COMMIT");
    return cancelled;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelFixtureOutsourceAssignmentForUser(user, assignmentId, payload = {}) {
  assertPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_CANCEL, "Outsourcing cancellation permission is required");
  return cancelAssignment(user, assignmentId, payload, "CANCELLED");
}

async function convertOutsourceToInternalForUser(user, assignmentId, payload = {}) {
  assertPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE, "Outsourcing management permission is required");
  return cancelAssignment(user, assignmentId, payload, "CONVERTED_TO_INTERNAL");
}

async function convertInternalAssignmentToOutsourceForUser(user, payload = {}) {
  assertPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE, "Fixture outsourcing permission is required");
  assertPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE, "Outsourcing management permission is required");
  const { reason } = validateReasonPayload(payload);
  const normalized = validateBulkOutsourcePayload({
    ...payload,
    scope: "selected",
    fixture_ids: [payload.fixture_id],
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const project = await repository.findVisibleProjectForOutsource(
      user,
      normalized.project_id,
      client,
      { lock: true },
    );
    if (!project) {
      throw new AppError(404, "Project not found or outside your permitted scope");
    }
    const { vendor, coordinator } = await assertVendorAndCoordinator(user, normalized, client);
    const context = await repository.lockInternalAssignmentForConversion({
      actor: user,
      projectId: normalized.project_id,
      fixtureId: normalized.fixture_ids[0],
      workflowStageCode: normalized.workflow_stage_code,
    }, client);
    if (!context) {
      throw new AppError(404, "Fixture not found or outside your permitted scope");
    }

    const hasInternalAssignment = context.internally_assigned === true
      || context.internal_assignment_active === true;
    const blockingReason = classifyFixtureOutsourceEligibility({
      ...context,
      internal_assignment_active: false,
      internally_assigned: false,
      // Conversion deliberately starts from an active internal assignment. Preserve
      // all other eligibility checks, but let the explicit override gate below
      // decide whether already-started internal work may be converted.
      progress_status: context.progress_status === "APPROVED" ? "APPROVED" : "PENDING",
      stage_assignable: true,
    });
    if (blockingReason) {
      throw new AppError(409, blockingReason.message);
    }
    if (!hasInternalAssignment) {
      throw new AppError(409, "Fixture stage has no active internal assignment to convert");
    }
    if (
      context.work_started
      && !hasPermission(user, PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_OVERRIDE)
    ) {
      throw new AppError(403, "Started internal work requires outsourcing override permission");
    }

    await repository.cancelInternalAssignmentForOutsource(
      context,
      reason,
      client,
    );
    const assignments = await repository.insertFixtureOutsourceAssignments([{
      ...context,
      source_internal_task_ids: context.source_internal_task_ids,
    }], {
      ...normalized,
      workflow_stage: normalized.workflow_stage_code,
      outsourced_by: actorId(user),
      conversion_reason: reason,
    }, client);
    if (assignments.length !== 1) {
      throw new AppError(409, "Fixture stage is already outsourced");
    }

    const assignment = assignments[0];
    await repository.insertFixtureOutsourceAssignmentEvents([{
      assignment_id: assignment.id,
      event_type: "INTERNAL_ASSIGNMENT_CONVERTED",
      previous_status: null,
      new_status: OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED,
      actor_id: actorId(user),
      reason,
      metadata: {
        source_internal_task_ids: context.source_internal_task_ids,
        vendor_id: vendor.id,
        internal_coordinator_id: coordinator.employee_id,
      },
    }], client);
    await createAuditLog({
      userEmployeeId: actorId(user),
      actionType: "DESIGN_FIXTURE_INTERNAL_ASSIGNMENT_CONVERTED_TO_OUTSOURCE",
      targetType: "fixture_outsource_assignment",
      targetId: assignment.id,
      metadata: {
        fixture_id: assignment.fixture_id,
        workflow_stage_code: assignment.workflow_stage_code,
        source_internal_task_ids: context.source_internal_task_ids,
        reason,
      },
    }, client);
    await client.query("COMMIT");
    return assignment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  bulkOutsourceFixtureStagesForUser,
  cancelFixtureOutsourceAssignmentForUser,
  changeFixtureOutsourceStatusForUser,
  convertInternalAssignmentToOutsourceForUser,
  convertOutsourceToInternalForUser,
  createVendorForUser,
  listProjectOutsourceAssignmentsForUser,
  listVendorsForUser,
  previewFixtureOutsourceScopeForUser,
};
