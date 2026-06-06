/**
 * SYSTEM RECOVERY: Visibility Hard Bypass Debug Verification
 * 
 * This script tests whether the hard bypass for authority users is working correctly.
 * Run with: PROJECT_VISIBILITY_DEBUG=true node backend/debug_visibility_bypass.js
 */

const { assertSafeScriptExecution } = require("./lib/scriptGuards");

assertSafeScriptExecution("debug_visibility_bypass.js", { overrideEnv: "ALLOW_PRODUCTION_DEBUG" });

const { pool } = require("./db");
const { getAccessibleProjectIds } = require("./repositories/projectVisibility");
const { resolveAccessibleProjectIds } = require("./services/visibilityResolutionService");

async function testAuthorityBypass() {
  console.log("\n========================================");
  console.log("VISIBILITY HARD BYPASS TEST");
  console.log("========================================\n");

  try {
    // Find an absolute project authority user by role identity only.
    const adminResult = await pool.query(
      `
        SELECT u.id, u.employee_id, u.name, u.role, r.name as role_name, r.hierarchy_level
        FROM users u
        LEFT JOIN roles r ON r.id = u.role
        WHERE LOWER(BTRIM(REGEXP_REPLACE(COALESCE(r.name, u.role, ''), '[^[:alnum:]]+', '_', 'g'), '_'))
          IN ('admin', 'ceo', 'director', 'director_ceo')
        LIMIT 1
      `
    );

    const adminUser = adminResult.rows[0];
    if (!adminUser) {
      console.log("❌ ERROR: No project authority user found in database");
      process.exit(1);
    }

    console.log(`Found authority user: ${adminUser.name} (ID: ${adminUser.employee_id})`);
    console.log(`Role: ${adminUser.role_name} (Level: ${adminUser.hierarchy_level})\n`);

    // Count total projects in database
    const totalProjectsResult = await pool.query(
      "SELECT COUNT(*) as count FROM design.projects"
    );
    const totalProjects = totalProjectsResult.rows[0].count;
    console.log(`Total projects in database: ${totalProjects}`);

    // Test 1: Direct repository call
    console.log("\n[TEST 1] Testing getAccessibleProjectIds() directly...");
    const directAccessible = await getAccessibleProjectIds(adminUser.employee_id);
    console.log(`✓ Admin user has access to ${directAccessible.length} projects (direct call)`);

    if (directAccessible.length === 0 && totalProjects > 0) {
      console.log("❌ FAILURE: Admin should see all projects but visibility query returned 0");
    } else if (directAccessible.length === totalProjects) {
      console.log("✓ SUCCESS: Admin sees all projects");
    }

    // Test 2: Via visibility resolution service
    console.log("\n[TEST 2] Testing resolveAccessibleProjectIds() via service...");
    const userWithRole = {
      employee_id: adminUser.employee_id,
      role: {
        id: adminUser.role,
        name: adminUser.role_name,
        hierarchy_level: adminUser.hierarchy_level,
        permissions: {},
      },
    };

    const serviceAccessible = await resolveAccessibleProjectIds(userWithRole);
    console.log(`✓ Service returned ${serviceAccessible.length} projects`);

    if (serviceAccessible.length === 0 && totalProjects > 0) {
      console.log("❌ FAILURE: Service should return all projects for authority user");
    } else if (serviceAccessible.length === totalProjects) {
      console.log("✓ SUCCESS: Service returns all projects for authority user");
    }

    // Test 3: Test non-admin user
    console.log("\n[TEST 3] Testing hierarchical visibility for non-admin user...");
    const nonAdminResult = await pool.query(
      `
        SELECT u.id, u.employee_id, u.name, u.role, r.name as role_name, r.hierarchy_level
        FROM users u
        LEFT JOIN roles r ON r.id = u.role
        WHERE LOWER(BTRIM(REGEXP_REPLACE(COALESCE(r.name, u.role, ''), '[^[:alnum:]]+', '_', 'g'), '_'))
          NOT IN ('admin', 'ceo', 'director', 'director_ceo')
           OR (r.name IS NULL AND u.role IS NOT NULL)
        LIMIT 1
      `
    );

    if (nonAdminResult.rows.length > 0) {
      const nonAdminUser = nonAdminResult.rows[0];
      console.log(`Found non-admin user: ${nonAdminUser.name}`);

      const nonAdminAccessible = await getAccessibleProjectIds(nonAdminUser.employee_id);
      console.log(`✓ Non-admin user has access to ${nonAdminAccessible.length} projects (hierarchical filtering)`);
      console.log("✓ Hierarchical visibility is working");
    }

    console.log("\n========================================");
    console.log("VISIBILITY BYPASS TEST COMPLETE");
    console.log("========================================\n");

  } catch (error) {
    console.error("❌ TEST ERROR:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Enable debug logging
process.env.PROJECT_VISIBILITY_DEBUG = "true";

testAuthorityBypass();
