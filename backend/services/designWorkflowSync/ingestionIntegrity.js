const { AppError } = require("../../lib/AppError");
const { fixtureCanonicalKey } = require("./canonicalIdentity");

/**
 * Post-merge integrity checks inside the same DB transaction. Any failure aborts the whole commit.
 */
async function assertPostIngestionWorkflowIntegrity(client, { projectId, departmentId }) {
  const errors = [];

  const fixtureNos = await client.query(
    `SELECT fixture_no FROM design.fixtures WHERE project_id = $1::uuid`,
    [projectId],
  );
  const seenCanonical = new Set();
  for (const row of fixtureNos.rows) {
    const k = fixtureCanonicalKey(row.fixture_no);
    if (seenCanonical.has(k)) {
      errors.push(`duplicate_canonical_fixture_identity:${k}`);
      break;
    }
    seenCanonical.add(k);
  }

  const orphanTasks = await client.query(
    `
      SELECT t.id::text
      FROM tasks t
      WHERE t.fixture_id IS NOT NULL
        AND t.project_id = $1::uuid
        AND NOT EXISTS (SELECT 1 FROM design.fixtures f WHERE f.id = t.fixture_id)
      LIMIT 20
    `,
    [projectId],
  );
  if (orphanTasks.rows.length > 0) {
    errors.push(`orphan_tasks:${orphanTasks.rows.map((r) => r.id).join(",")}`);
  }

  const orphanProgress = await client.query(
    `
      SELECT fp.fixture_id::text
      FROM fixture_workflow_progress fp
      WHERE fp.department_id = $1
        AND NOT EXISTS (SELECT 1 FROM design.fixtures f WHERE f.id = fp.fixture_id)
      LIMIT 20
    `,
    [departmentId],
  );
  if (orphanProgress.rows.length > 0) {
    errors.push(`orphan_fixture_workflow_progress:${orphanProgress.rows.map((r) => r.fixture_id).join(",")}`);
  }

  const dupActiveTasks = await client.query(
    `
      SELECT t.fixture_id::text, t.stage, COUNT(*)::int AS c
      FROM tasks t
      WHERE t.project_id = $1::uuid
        AND t.fixture_id IS NOT NULL
        AND t.status NOT IN ('closed', 'cancelled')
      GROUP BY t.fixture_id, t.stage
      HAVING COUNT(*) > 1
      LIMIT 20
    `,
    [projectId],
  );
  if (dupActiveTasks.rows.length > 0) {
    errors.push(
      `duplicate_active_tasks_per_stage:${dupActiveTasks.rows.map((r) => `${r.fixture_id}:${r.stage}:${r.c}`).join(";")}`,
    );
  }

  const outsourceViolations = await client.query(
    `
      SELECT f.id::text
      FROM design.fixtures f
      WHERE f.project_id = $1::uuid
        AND f.is_outsourced = TRUE
        AND (f.vendor_name IS NULL OR BTRIM(f.vendor_name) = '')
      LIMIT 20
    `,
    [projectId],
  );
  if (outsourceViolations.rows.length > 0) {
    errors.push(`outsource_missing_vendor:${outsourceViolations.rows.map((r) => r.id).join(",")}`);
  }

  if (errors.length > 0) {
    throw new AppError(500, "Design ingestion integrity validation failed; transaction rolled back.", {
      integrity_errors: errors,
    });
  }
}

module.exports = {
  assertPostIngestionWorkflowIntegrity,
};
