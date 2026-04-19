const { pool } = require("../db");
const { ensureDesignDepartmentSchema } = require("../repositories/designSchemaRepository");
const { alignPermissionData } = require("../repositories/permissionRepository");
const {
  ensureReferenceTables,
  ensureTasksTable,
  ensureUsersTable,
  normalizeSeedUserPasswords,
  seedPermissionsAndWorkflows,
  seedReferenceData,
  seedTasksIfNeeded,
  seedUsersIfNeeded,
  syncTaskEscalationSchedule,
  syncTaskWorkflowState,
} = require("../repositories/bootstrapRepository");

async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await ensureUsersTable(client);
    await ensureTasksTable(client);
    await ensureReferenceTables(client);
    await seedReferenceData(client);
    await ensureDesignDepartmentSchema(client);
    await seedPermissionsAndWorkflows(client);
    await alignPermissionData(client);
    await seedUsersIfNeeded(client);
    await normalizeSeedUserPasswords(client);
    await seedTasksIfNeeded(client);
    await syncTaskWorkflowState(client);
    await syncTaskEscalationSchedule(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initDatabase,
};
