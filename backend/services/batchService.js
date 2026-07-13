const { pool } = require("../db");
const { PROJECT_STATUSES, PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { instrumentModuleExports } = require("../lib/observability");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  listBatchesWithSummary,
  listBatchesWithSummaryForUser,
  getBatchById,
  getBatchByIdForUser,
  getProjectLifecycleContextByIdForUser,
  checkBatchDeletionBlocked,
  deleteBatchCascade,
  reactivateProjectForModification,
  releaseProject,
  restoreProjectWorkflowForReactivation,
  setProjectLifecycleStatus,
} = require("../repositories/batchRepository");
const { canAccessDepartment, hasPermission, isAdmin, isProjectAuthorityRole } = require("./accessControlService");

const PROJECT_REACTIVATION_REASONS = {
  customer_modification: "Customer modification",
  internal_modification: "Internal modification",
  drawing_update: "Drawing update",
  fixture_correction: "Fixture correction",
  other: "Other",
};

function normalizeProjectStatus(status) {
  return String(status || PROJECT_STATUSES.ACTIVE).trim().toLowerCase();
}

function isTerminalProjectStatus(status) {
  return [PROJECT_STATUSES.COMPLETED, PROJECT_STATUSES.RELEASED].includes(normalizeProjectStatus(status));
}

function normalizeReasonKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeProjectReactivationPayload(payload = {}) {
  const rawReason = payload.reason ?? payload.reactivation_reason ?? payload.reason_type ?? "";
  let reasonKey = normalizeReasonKey(rawReason);

  if (!reasonKey) {
    reasonKey = "other";
  }

  if (!Object.prototype.hasOwnProperty.call(PROJECT_REACTIVATION_REASONS, reasonKey)) {
    const matchingEntry = Object.entries(PROJECT_REACTIVATION_REASONS)
      .find(([, label]) => normalizeReasonKey(label) === reasonKey);
    if (!matchingEntry) {
      throw new AppError(400, "Invalid reactivation reason");
    }
    reasonKey = matchingEntry[0];
  }

  const comment = String(payload.comment ?? payload.reactivation_comment ?? payload.remarks ?? "")
    .trim()
    .slice(0, 1000);

  return {
    reason: reasonKey,
    reason_label: PROJECT_REACTIVATION_REASONS[reasonKey],
    comment: comment || null,
  };
}

function isBatchOwner(user, batch) {
  // Ownership checks must be based on the canonical project creator only.
  // Do NOT treat the batch uploader as an owner for runtime visibility/permissions.
  const ownerId = batch?.project_created_by_user_id || null;
  return Boolean(user?.employee_id && ownerId && user.employee_id === ownerId);
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function identifierMatchesCurrentUser(user, identifier) {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return false;
  }

  return [
    user?.employee_id,
    user?.id,
  ].some((candidate) => normalizeIdentifier(candidate) === normalizedIdentifier);
}

function isProjectUploaderOrCreator(user, project) {
  return [
    project?.project_created_by_user_id,
    project?.project_uploaded_by,
    project?.uploaded_by,
    project?.uploaded_by_user_id,
    project?.batch_uploaded_by,
    project?.batch_uploaded_by_user_id,
  ].some((identifier) => identifierMatchesCurrentUser(user, identifier));
}

async function getBatches(user) {
  const hasGlobalProjectView = isAdmin(user) || isProjectAuthorityRole(user);

  if (!user?.employee_id && !hasGlobalProjectView) {
    throw new AppError(400, "User missing employee_id");
  }

  return listBatchesWithSummaryForUser(user, null);
}

function canManageProjectLifecycle(user, batch) {
  if (!user || !batch) {
    return false;
  }

  if (isAdmin(user) || isProjectAuthorityRole(user)) {
    return true;
  }

  if (hasPermission(user, PERMISSIONS.ASSIGN_TASK) && canAccessDepartment(user, batch.department_id)) {
    return true;
  }

  return hasPermission(user, PERMISSIONS.DELETE_WBS_BATCH) && isBatchOwner(user, batch);
}

function canReactivateProject(user, project) {
  return canManageProjectLifecycle(user, project) || isProjectUploaderOrCreator(user, project);
}

/**
 * Deletes an operational project upload record.
 *
 * - If force=true and user is admin: bypasses safety check, writes audit log.
 * - Otherwise: validates no active/completed fixtures exist before deleting.
 *
 * @param {object} user - authenticated user
 * @param {string} batchId - UUID of the active upload record for the project
 * @param {boolean} force - bypass safety check (admin only)
 */
async function deleteBatch(user, batchId, force = false) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Project not found");
  }

  const userIsAdmin = isAdmin(user);

  if (!userIsAdmin && !isBatchOwner(user, batch)) {
    throw new AppError(403, "Only the canonical project owner or an admin can delete it");
  }

  if (force) {
    if (!userIsAdmin) {
      throw new AppError(403, "Only admins can force-delete a project");
    }

    // Force delete: no validation, but write audit log
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await deleteBatchCascade(batchId, client);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "FORCE_DELETE_BATCH",
      targetType: "upload_batch",
      targetId: batchId,
      metadata: {
        project_no: batch.project_no,
        uploaded_by_user_id: batch.uploaded_by_user_id,
        total_fixtures: batch.total_fixtures,
        force: true,
      },
    });

    return {
      deleted: true,
      batch_id: batchId,
      force: true,
      message: `Project ${batch.project_no} force-deleted successfully.`,
    };
  }

  // Standard delete: check for blocking conditions
  const { blocked, reason } = await checkBatchDeletionBlocked(batchId);
  if (blocked) {
    throw new AppError(409, reason, null, "BATCH_DELETION_BLOCKED");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteBatchCascade(batchId, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "DELETE_BATCH",
    targetType: "upload_batch",
    targetId: batchId,
    metadata: {
      project_no: batch.project_no,
      uploaded_by_user_id: batch.uploaded_by_user_id,
      total_fixtures: batch.total_fixtures,
    },
  });

  return {
    deleted: true,
    batch_id: batchId,
    force: false,
    message: `Project ${batch.project_no} deleted successfully.`,
  };
}

async function holdProjectForBatch(user, batchId) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Project not found");
  }

  if (!canManageProjectLifecycle(user, batch)) {
    throw new AppError(403, "You do not have permission to place this project on hold");
  }

  if (isTerminalProjectStatus(batch.project_status)) {
    throw new AppError(409, "Released or completed projects cannot be placed on hold");
  }

  if (batch.project_status === PROJECT_STATUSES.ON_HOLD) {
    return {
      project_id: batch.project_id,
      batch_id: batchId,
      status: PROJECT_STATUSES.ON_HOLD,
      message: `Project ${batch.project_no} is already on hold.`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setProjectLifecycleStatus(batch.project_id, PROJECT_STATUSES.ON_HOLD, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "PROJECT_ON_HOLD",
    targetType: "design_project",
    targetId: batch.project_id,
    metadata: {
      batch_id: batchId,
      project_no: batch.project_no,
      previous_status: batch.project_status,
      next_status: PROJECT_STATUSES.ON_HOLD,
    },
  });

  return {
    project_id: batch.project_id,
    batch_id: batchId,
    status: PROJECT_STATUSES.ON_HOLD,
    message: `Project ${batch.project_no} is now on hold.`,
  };
}

async function activateProjectForBatch(user, batchId) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Project not found");
  }

  if (!canManageProjectLifecycle(user, batch)) {
    throw new AppError(403, "You do not have permission to activate this project");
  }

  if (isTerminalProjectStatus(batch.project_status)) {
    throw new AppError(409, "Released or completed projects cannot be activated");
  }

  if (batch.project_status === PROJECT_STATUSES.ACTIVE) {
    return {
      project_id: batch.project_id,
      batch_id: batchId,
      status: PROJECT_STATUSES.ACTIVE,
      message: `Project ${batch.project_no} is already active.`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setProjectLifecycleStatus(batch.project_id, PROJECT_STATUSES.ACTIVE, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "PROJECT_ACTIVATED",
    targetType: "design_project",
    targetId: batch.project_id,
    metadata: {
      batch_id: batchId,
      project_no: batch.project_no,
      previous_status: batch.project_status,
      next_status: PROJECT_STATUSES.ACTIVE,
    },
  });

  return {
    project_id: batch.project_id,
    batch_id: batchId,
    status: PROJECT_STATUSES.ACTIVE,
    message: `Project ${batch.project_no} is now active.`,
  };
}

async function reactivateProjectForModificationById(user, projectId, payload = {}) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required");
  }

  const project = await getProjectLifecycleContextByIdForUser(normalizedProjectId, user);
  if (!project) {
    throw new AppError(404, "Project not found");
  }

  if (!canReactivateProject(user, project)) {
    throw new AppError(403, "You do not have permission to reactivate this project");
  }

  const reactivation = normalizeProjectReactivationPayload(payload);
  const reactivatedAt = new Date().toISOString();
  let updatedProject = null;
  let restoration = {};
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    updatedProject = await reactivateProjectForModification(project.project_id, client);

    if (!updatedProject) {
      throw new AppError(404, "Project not found");
    }

    restoration = await restoreProjectWorkflowForReactivation(project.project_id, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "PROJECT_REACTIVATED",
      targetType: "design_project",
      targetId: project.project_id,
      metadata: {
        batch_id: project.batch_id || null,
        project_no: project.project_no,
        reactivated_by: user.employee_id,
        reactivated_at: reactivatedAt,
        reactivation_reason: reactivation.reason,
        reactivation_reason_label: reactivation.reason_label,
        reactivation_comment: reactivation.comment,
        previous_status: project.project_status,
        next_status: PROJECT_STATUSES.ACTIVE,
        previous_is_modified: project.is_modified === true,
        next_is_modified: updatedProject.is_modified === true,
        preserved_completed_at: project.completed_at || null,
        workflow_restoration: restoration,
      },
    }, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    project_id: project.project_id,
    batch_id: project.batch_id || null,
    status: PROJECT_STATUSES.ACTIVE,
    previous_status: project.project_status,
    is_modified: updatedProject?.is_modified === true,
    project: updatedProject,
    reactivation_reason: reactivation.reason,
    reactivation_reason_label: reactivation.reason_label,
    reactivation_comment: reactivation.comment,
    workflow_restoration: restoration,
    message: `Project ${project.project_no} has been reactivated for modification work.`,
  };
}

async function reactivateProjectForBatch(user, batchId, payload = {}) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Project not found");
  }

  return reactivateProjectForModificationById(user, batch.project_id, payload);
}

async function releaseProjectForBatch(user, batchId) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Project not found");
  }

  if (!canManageProjectLifecycle(user, batch)) {
    throw new AppError(403, "You do not have permission to release this project");
  }

  if (isTerminalProjectStatus(batch.project_status)) {
    return {
      project_id: batch.project_id,
      batch_id: batchId,
      status: batch.project_status,
      message: `Project ${batch.project_no} is already released or completed.`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await releaseProject(batch.project_id, user.employee_id, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "PROJECT_RELEASED",
    targetType: "design_project",
    targetId: batch.project_id,
    metadata: {
      batch_id: batchId,
      project_no: batch.project_no,
      previous_status: batch.project_status,
      next_status: PROJECT_STATUSES.COMPLETED,
    },
  });

  return {
    project_id: batch.project_id,
    batch_id: batchId,
    status: PROJECT_STATUSES.COMPLETED,
    message: `Project ${batch.project_no} has been released and marked completed.`,
  };
}

module.exports = instrumentModuleExports("service.batchService", {
  activateProjectForBatch,
  getBatches,
  deleteBatch,
  holdProjectForBatch,
  normalizeProjectReactivationPayload,
  reactivateProjectForBatch,
  reactivateProjectForModificationById,
  releaseProjectForBatch,
});
