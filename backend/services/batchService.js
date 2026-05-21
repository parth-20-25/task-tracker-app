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
  checkBatchDeletionBlocked,
  deleteBatchCascade,
  releaseProject,
  setProjectLifecycleStatus,
} = require("../repositories/batchRepository");
const { canAccessDepartment, hasPermission, isAdmin, isProjectAuthorityRole } = require("./accessControlService");

function isBatchOwner(user, batch) {
  // Ownership checks must be based on the canonical project creator only.
  // Do NOT treat the batch uploader as an owner for runtime visibility/permissions.
  const ownerId = batch?.project_created_by_user_id || null;
  return Boolean(user?.employee_id && ownerId && user.employee_id === ownerId);
}

async function getBatches(user) {
  const hasGlobalProjectView = isAdmin(user) || isProjectAuthorityRole(user);

  if (!user?.department_id && !hasGlobalProjectView) {
    throw new AppError(400, "User missing department_id");
  }

  return listBatchesWithSummaryForUser(user, hasGlobalProjectView ? null : user.department_id);
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

/**
 * Deletes a batch.
 *
 * - If force=true and user is admin: bypasses safety check, writes audit log.
 * - Otherwise: validates no active/completed fixtures exist before deleting.
 *
 * @param {object} user - authenticated user
 * @param {string} batchId - UUID of batch to delete
 * @param {boolean} force - bypass safety check (admin only)
 */
async function deleteBatch(user, batchId, force = false) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Batch not found");
  }

  const userIsAdmin = isAdmin(user);

  if (!userIsAdmin && batch.department_id !== user.department_id) {
    throw new AppError(403, "You do not have access to this batch");
  }

  if (!userIsAdmin && !isBatchOwner(user, batch)) {
    throw new AppError(403, "Only the uploader of this WBS batch or an admin can delete it");
  }

  if (force) {
    if (!userIsAdmin) {
      throw new AppError(403, "Only admins can force-delete a batch");
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
      message: `Batch ${batchId} force-deleted successfully.`,
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
    message: `Batch ${batchId} deleted successfully.`,
  };
}

async function holdProjectForBatch(user, batchId) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Batch not found");
  }

  if (!canManageProjectLifecycle(user, batch)) {
    throw new AppError(403, "You do not have permission to place this project on hold");
  }

  if (batch.project_status === PROJECT_STATUSES.COMPLETED) {
    throw new AppError(409, "Completed projects cannot be placed on hold");
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

async function releaseProjectForBatch(user, batchId) {
  const batch = await getBatchByIdForUser(batchId, user);
  if (!batch) {
    throw new AppError(404, "Batch not found");
  }

  if (!canManageProjectLifecycle(user, batch)) {
    throw new AppError(403, "You do not have permission to release this project");
  }

  if (batch.project_status === PROJECT_STATUSES.COMPLETED) {
    return {
      project_id: batch.project_id,
      batch_id: batchId,
      status: PROJECT_STATUSES.COMPLETED,
      message: `Project ${batch.project_no} is already completed.`,
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
  getBatches,
  deleteBatch,
  holdProjectForBatch,
  releaseProjectForBatch,
});
