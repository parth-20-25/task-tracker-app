const { pool } = require("../db");
const { ensureDesignDepartmentSchema } = require("../repositories/designSchemaRepository");
const { alignPermissionData } = require("../repositories/permissionRepository");
const {
  ensureDefaultWorkflowsForAllDepartments,
  repairOrphanDesignProjects,
} = require("./workflowRecoveryService");
const {
  ensureReferenceTables,
  ensureTasksTable,
  ensureUsersTable,
  normalizeSeedUserPasswords,
  seedPermissionsAndWorkflows,
  seedReferenceData,
  seedUsersIfNeeded,
  syncTaskEscalationSchedule,
  syncTaskWorkflowState,
} = require("../repositories/bootstrapRepository");
const { ensurePerformanceAnalyticsTables } = require("../repositories/performanceAnalyticsRepository");
const { refreshPerformanceAnalyticsAtStartup } = require("./performanceAnalyticsService");

async function initDatabase() {
  const client = await pool.connect();
  const startTime = Date.now();

  try {
    console.log("[bootstrap] Starting database initialization...");
    await client.query("BEGIN");
    
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    
    console.log("[bootstrap] Ensuring tables exist...");
    await ensureUsersTable(client);
    await ensureTasksTable(client);
    await ensureReferenceTables(client);
    await ensurePerformanceAnalyticsTables(client);
    
    console.log("[bootstrap] Seeding reference data...");
    await seedReferenceData(client);
    await ensureDesignDepartmentSchema(client);
    await seedPermissionsAndWorkflows(client);
    await alignPermissionData(client);
    
    console.log("[bootstrap] Ensuring users and workflows...");
    await seedUsersIfNeeded(client);
    await normalizeSeedUserPasswords(client);
    await repairOrphanDesignProjects(null, client);
    await ensureDefaultWorkflowsForAllDepartments(client);
    
    console.log("[bootstrap] Syncing task states...");
    await syncTaskWorkflowState(client);
    await syncTaskEscalationSchedule(client);
    
    await client.query("COMMIT");
    console.log("[bootstrap] Core database bootstrap committed.");

    try {
      console.log("[bootstrap] Refreshing performance analytics snapshots...");
      // CRITICAL: Pass the same client to avoid deadlock since we might be in a shared pool
      await refreshPerformanceAnalyticsAtStartup(client);
      console.log("[bootstrap] Performance analytics refreshed successfully.");
    } catch (refreshError) {
      console.error("[bootstrap] Initial performance analytics refresh failed:", refreshError?.message || refreshError);
    }
    
    console.log(`[bootstrap] Database initialization completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[bootstrap] FATAL: Database initialization failed. Transaction rolled back.", error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initDatabase,
};
