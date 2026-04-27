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
  seedUsersIfNeeded,
} = require("../repositories/bootstrapRepository");
const { ensureDefaultWorkflowsForAllDepartments } = require("../services/workflowRecoveryService");

async function main() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await ensureUsersTable(client);
    await ensureTasksTable(client);
    await ensureReferenceTables(client);
    await ensureDesignDepartmentSchema(client);
    await seedReferenceData(client);
    await seedPermissionsAndWorkflows(client);
    await alignPermissionData(client);
    await seedUsersIfNeeded(client);
    await normalizeSeedUserPasswords(client);
    await ensureDefaultWorkflowsForAllDepartments(client);
    await client.query("COMMIT");
    console.log("Reference bootstrap completed.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Reference bootstrap failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
