const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { instrumentModuleExports } = require("../lib/observability");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  listBatchesWithSummary,
  getBatchById,
  checkBatchDeletionBlocked,
  deleteBatchCascade,
} = require("../repositories/batchRepository");
const { isAdmin } = require("./accessControlService");

/**
 * Returns all upload batches visible to the user with their status summary.
 * Admins see all batches; department users see only their department's batches.
 */
async function getBatches(user) {
  const departmentId = isAdmin(user) ? null : user.department_id;
  const batches = await listBatchesWithSummary(departmentId);
  return batches;
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
  const batch = await getBatchById(batchId);
  if (!batch) {
    throw new AppError(404, "Batch not found");
  }

  // Department-scope check for non-admins
  if (!isAdmin(user) && batch.department_id !== user.department_id) {
    throw new AppError(403, "You do not have access to this batch");
  }

  if (force) {
    if (!isAdmin(user)) {
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
        scope_name: batch.scope_name,
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
      scope_name: batch.scope_name,
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

module.exports = instrumentModuleExports("service.batchService", {
  getBatches,
  deleteBatch,
});
