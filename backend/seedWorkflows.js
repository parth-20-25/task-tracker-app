const { Pool } = require("pg");
const { env } = require("./config/env");
const { ROLE_DEFAULT_PERMISSIONS } = require("./config/constants");
const { assignPermissionsToRole, seedPermissions } = require("./repositories/permissionRepository");

const pool = new Pool({
  user: env.db.user,
  host: env.db.host,
  database: env.db.database,
  password: env.db.password,
  port: env.db.port,
});

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await seedPermissions(client);

    const rolesResult = await client.query("SELECT id FROM roles");
    const roles = new Set(rolesResult.rows.map((row) => row.id));

    for (const [roleId, permissionIds] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      if (!roles.has(roleId)) {
        continue;
      }

      await assignPermissionsToRole(roleId, permissionIds, client, {
        autoCreateMissingPermissions: true,
        source: "seedWorkflows",
      });
    }

    await client.query("COMMIT");
    console.log("Permission seed completed. Workflow templates are no longer auto-generated.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Seeding failed:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
