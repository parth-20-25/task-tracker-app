const {
  diagnoseAndBackfillWorkflowProgress,
} = require("../services/designCompletion/workflowProgressBackfillService");
const { pool } = require("../db");

async function run() {
  const apply = process.argv.includes("--apply");
  const projectArg = process.argv.find((arg) => arg.startsWith("--project="));
  const projectId = projectArg ? projectArg.slice("--project=".length) : null;
  const actorEmployeeId = process.env.BACKFILL_ACTOR_EMPLOYEE_ID || "system-progress-backfill";
  const result = await diagnoseAndBackfillWorkflowProgress({
    apply,
    actorEmployeeId,
    projectId,
  });
  console.log(JSON.stringify(result, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
