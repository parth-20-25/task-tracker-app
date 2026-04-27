const { pool } = require("../db");
const { backfillDesignProjectRelations, ensureDesignDepartmentSchema } = require("../repositories/designSchemaRepository");

async function main() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureDesignDepartmentSchema(client);
    await backfillDesignProjectRelations(client);

    const summary = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM design.projects) AS project_count,
        (SELECT COUNT(*)::int FROM design.upload_batches) AS batch_count,
        (SELECT COUNT(*)::int FROM design.fixtures) AS fixture_count,
        (SELECT COUNT(*)::int FROM design.fixtures WHERE project_id IS NULL) AS fixtures_missing_project_id
    `);

    await client.query("COMMIT");
    console.log("Design project backfill completed.");
    console.table(summary.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Design project backfill failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
