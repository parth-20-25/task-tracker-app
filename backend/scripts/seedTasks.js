const { pool } = require("../db");
const { env } = require("../config/env");
const { seedTasksIfNeeded } = require("../repositories/taskSeedRepository");

async function main() {

  if (process.env.NODE_ENV === "production") {
    console.error("Task seeding is not allowed in production");
    process.exit(1);
  }

  if (!env.enableTaskSeed) {
    console.error('Task seeding is disabled. Set ENABLE_TASK_SEED="true" to run this script.');
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await seedTasksIfNeeded(client);

    const summary = await client.query(`SELECT COUNT(*)::int AS count FROM tasks`);

    await client.query("COMMIT");
    console.log("Task seed completed.");
    console.table(summary.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Task seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
