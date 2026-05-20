const { AppError } = require("../lib/AppError");
const { pool } = require("../db");
const { isDesignDepartment } = require("../lib/designDepartment");
const {
  getDesignStageDisplayName,
  normalizeDesignStageName,
} = require("../lib/designWorkflowStages");
const {
  formatStageRevisionCode,
  formatStageVersionLabel,
  normalizeStageVersion,
} = require("../lib/workflowStageVersioning");
const {
  normalizeDesignRevisionReasonType,
  getDesignRevisionReasonLabel,
} = require("../lib/designRevisionTypes");
const {
  getProgressForFixture,
  incrementFixtureRevision,
  recordFixtureRevision,
  updateProgressRow,
  getLatestStageRevisionForStage,
} = require("../repositories/fixtureWorkflowRepository");

function normalizeProgressStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function assertDesignDepartmentForRevision(departmentId) {
  if (!isDesignDepartment({ id: departmentId })) {
    throw new AppError(403, "Stage revision and rework are only available for the Design department");
  }
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

function resolveStageFromProgress(progressRows, { targetStageName = null, targetStageOrder = null } = {}) {
  const normalizedStageName = String(targetStageName || "").trim().toLowerCase();
  const normalizedStageOrder = Number(targetStageOrder);

  return progressRows.find((stage) => {
    if (Number.isFinite(normalizedStageOrder) && Number(stage.stage_order) === normalizedStageOrder) {
      return true;
    }

    if (!normalizedStageName) {
      return false;
    }

    return String(stage.stage_name || "").trim().toLowerCase() === normalizedStageName;
  }) || null;
}

async function applyDesignProgressReopenState({
  fixtureId,
  progress,
  targetStage,
  nextStageVersion,
  client,
}) {
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
    await updateProgressRow(
      fixtureId,
      stage.stage_name,
      {
        stage_version: isTargetStage ? nextStageVersion : normalizeStageVersion(stage.stage_version),
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

function buildRevisionTimelineEntry(row, previousRevisionCode = null) {
  const stageKey = normalizeDesignStageName(row.stage_name);
  const stageDisplay = getDesignStageDisplayName(stageKey, row.stage_name) || row.stage_name;
  const reasonType = row.reason_type || row.revision_type;

  return {
    id: row.id,
    fixture_id: row.fixture_id,
    department_id: row.department_id,
    revision_no: Number(row.revision_no),
    stage: stageDisplay,
    stage_name: row.stage_name,
    revision: row.revision_code || null,
    revision_code: row.revision_code || null,
    stage_version: normalizeStageVersion(row.stage_version),
    reason_type: reasonType,
    reason_type_label: getDesignRevisionReasonLabel(reasonType),
    revision_type: row.revision_type,
    revision_reason: row.revision_reason,
    revision_remarks: row.revision_remarks,
    previous_revision: previousRevisionCode || row.metadata?.previous_revision_code || null,
    approval_state: row.metadata?.approval_state_at_change || row.metadata?.target_status || null,
    reverted_from_stage: row.reverted_from_stage,
    reverted_to_stage: row.reverted_to_stage,
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name || null,
    approved_by: row.approved_by,
    approved_by_name: row.approved_by_name || null,
    changed_by: row.changed_by,
    changed_by_name: row.changed_by_name || null,
    changed_at: row.changed_at,
    metadata: row.metadata || {},
  };
}

/**
 * Design-only controlled rework: append revision history, bump stage_version, preserve prior attempts.
 * Revision increments only when the target stage was previously APPROVED (completed).
 */
async function executeDesignStageRework({
  actor,
  fixtureId,
  departmentId,
  targetStageName = null,
  targetStageOrder = null,
  reasonType,
  remarks = null,
  requestedBy = null,
  approvedBy = null,
  revisionReason = null,
}) {
  assertDesignDepartmentForRevision(departmentId);

  const reasonResult = normalizeDesignRevisionReasonType(reasonType, { required: true });
  if (!reasonResult.ok) {
    throw new AppError(400, reasonResult.error);
  }

  const normalizedReasonType = reasonResult.value;
  const normalizedRemarks = String(remarks || "").trim() || null;
  const normalizedRevisionReason = String(revisionReason || "").trim() || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockedProgress = await getProgressForFixture(fixtureId, departmentId, client);
    const lockedTargetStage = resolveStageFromProgress(lockedProgress, { targetStageName, targetStageOrder });

    if (!lockedTargetStage) {
      throw new AppError(400, "Target stage was not found in the fixture workflow");
    }

    const targetStatus = normalizeProgressStatus(lockedTargetStage.status);
    if (targetStatus !== "APPROVED") {
      throw new AppError(
        409,
        "Design rework requires the target stage to have been completed (approved) before a new revision can be created",
      );
    }

    const lockedFromStage = lockedProgress.find((stage) => stage.status !== "APPROVED")
      || lockedProgress.sort((a, b) => Number(b.stage_order) - Number(a.stage_order))[0];

    if (!lockedFromStage) {
      throw new AppError(409, "Fixture workflow has no active stage context for rework");
    }

    if (Number(lockedTargetStage.stage_order) > Number(lockedFromStage.stage_order)) {
      throw new AppError(400, "Revision can only reopen the current or a previous stage");
    }

    const previousRevisionCode = getProgressRevisionCode(lockedTargetStage)
      || (await getLatestStageRevisionForStage(fixtureId, lockedTargetStage.stage_name, client))?.revision_code
      || null;

    const previousStageVersion = normalizeStageVersion(lockedTargetStage.stage_version);
    const nextStageVersion = previousStageVersion + 1;
    const nextRevisionNo = await incrementFixtureRevision(fixtureId, client);

    await applyDesignProgressReopenState({
      fixtureId,
      progress: lockedProgress,
      targetStage: lockedTargetStage,
      nextStageVersion,
      client,
    });

    const reopenedProgress = await getProgressForFixture(fixtureId, departmentId, client);
    const versionedTargetStage = resolveStageFromProgress(reopenedProgress, { targetStageName, targetStageOrder })
      || lockedTargetStage;

    const revisionCode = formatStageRevisionCode(
      versionedTargetStage.stage_name,
      normalizeStageVersion(versionedTargetStage.stage_version),
    );

    const revisionRow = await recordFixtureRevision({
      fixture_id: fixtureId,
      department_id: departmentId,
      revision_no: nextRevisionNo,
      stage_name: lockedTargetStage.stage_name,
      stage_version: normalizeStageVersion(versionedTargetStage.stage_version),
      revision_code: revisionCode,
      reason_type: normalizedReasonType,
      revision_type: normalizedReasonType,
      revision_reason: normalizedRevisionReason,
      revision_remarks: normalizedRemarks,
      reverted_from_stage: getProgressStageLabel(lockedFromStage) || lockedFromStage.stage_name,
      reverted_to_stage: getProgressStageLabel(versionedTargetStage) || lockedTargetStage.stage_name,
      requested_by: String(requestedBy || actor?.employee_id || "").trim(),
      approved_by: String(approvedBy || "").trim() || null,
      changed_by: actor.employee_id,
      metadata: {
        operation: "design_stage_rework",
        stage: getBaseStageDisplayName(lockedTargetStage.stage_name),
        revision: revisionCode,
        reason_type: normalizedReasonType,
        reason_type_label: getDesignRevisionReasonLabel(normalizedReasonType),
        previous_revision_code: previousRevisionCode,
        previous_stage_version: previousStageVersion,
        approval_state_at_change: targetStatus,
        from_stage_name: lockedFromStage.stage_name,
        from_stage_version: normalizeStageVersion(lockedFromStage.stage_version),
        to_stage_name: lockedTargetStage.stage_name,
        to_stage_version: normalizeStageVersion(versionedTargetStage.stage_version),
        revision_incremented: true,
        from_status: lockedFromStage.status,
        to_status: "PENDING",
      },
    }, client);

    await client.query("COMMIT");

    return {
      revision: revisionRow,
      timelineEntry: buildRevisionTimelineEntry(revisionRow, previousRevisionCode),
      revisionCode,
      stageVersion: normalizeStageVersion(versionedTargetStage.stage_version),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  assertDesignDepartmentForRevision,
  applyDesignProgressReopenState,
  buildRevisionTimelineEntry,
  executeDesignStageRework,
  getProgressRevisionCode,
  getProgressStageLabel,
  getBaseStageDisplayName,
};
