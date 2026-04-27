const { pool } = require("../db");
const { ensureDesignDepartmentSchema } = require("../repositories/designSchemaRepository");
const { repairOrphanDesignProjects } = require("./workflowRecoveryService");
const {
  ensureReferenceTables,
  ensureTasksTable,
  ensureUsersTable,
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

    // Acquire an advisory lock so only one bootstrap runs at a time
    await client.query("SELECT pg_advisory_lock(987654321)");

    // Ensure a default schema is selected so unqualified CREATE TABLE statements work
    await client.query("SET search_path TO public");

    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    console.log("[bootstrap] Ensuring tables exist...");
    await ensureUsersTable(client);
    await ensureTasksTable(client);
    await ensureReferenceTables(client);
    await ensurePerformanceAnalyticsTables(client);
    await ensureDesignDepartmentSchema(client);

    console.log("[bootstrap] Skipping seed and demo data initialization.");
    await repairOrphanDesignProjects(null, client);

    console.log("[bootstrap] Syncing task states...");
    await syncTaskWorkflowState(client);
    await syncTaskEscalationSchedule(client);

    console.log("[bootstrap] Core database bootstrap completed.");

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
    console.error("[bootstrap] FATAL: Database initialization failed.", error);
    throw error;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(987654321)");
    } catch (unlockErr) {
      // ignore unlock errors
    }
    client.release();
  }
}

module.exports = {
  initDatabase,
};
