const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");

function mapFixtureBundleRow(row) {
  return {
    fixture_id: row.fixture_id,
    fixture_no: row.fixture_no,
    project_id: row.project_id,
    department_id: row.department_id,
    revision_no: Number(row.revision_no || 0),
    is_workflow_complete: row.is_workflow_complete === true,
    is_outsourced: row.is_outsourced === true,
    is_legacy_workflow: row.is_legacy_workflow === true,
    removed_from_latest_ingestion: row.removed_from_latest_ingestion === true,
    is_required_for_project_kpi: true,
    project_status: row.project_status,
    progress_rows: Array.isArray(row.progress_rows) ? row.progress_rows : [],
  };
}

async function loadStageWeightRowsForDepartment(departmentId, client = pool) {
  if (!departmentId) {
    return [];
  }

  const result = await client.query(
    `
      SELECT stage_key, weight_percent
      FROM design.stage_completion_weights
      WHERE department_id = $1
        AND is_active = TRUE
      ORDER BY stage_key ASC
    `,
    [departmentId],
  );

  return result.rows;
}

async function loadFixtureBundlesForProject(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        df.id AS fixture_id,
        df.fixture_no,
        df.project_id,
        dp.department_id,
        COALESCE(dp.status, 'active') AS project_status,
        df.revision_no,
        df.is_workflow_complete,
        df.is_outsourced,
        df.is_legacy_workflow,
        df.removed_from_latest_ingestion,
        COALESCE(
          json_agg(
            json_build_object(
              'stage_name', fwp.stage_name,
              'stage_order', fwp.stage_order,
              'stage_version', fwp.stage_version,
              'status', fwp.status,
              'assigned_to', fwp.assigned_to,
              'assigned_at', fwp.assigned_at,
              'started_at', fwp.started_at,
              'completed_at', fwp.completed_at
            )
            ORDER BY fwp.stage_order ASC
          ) FILTER (WHERE fwp.fixture_id IS NOT NULL),
          '[]'::json
        ) AS progress_rows
      FROM design.fixtures df
      JOIN design.projects dp ON dp.id = df.project_id
      LEFT JOIN fixture_workflow_progress fwp
        ON fwp.fixture_id = df.id
       AND fwp.department_id = dp.department_id
      WHERE df.project_id = $1
        AND dp.department_id = $2
      GROUP BY
        df.id,
        df.fixture_no,
        df.project_id,
        dp.department_id,
        dp.status,
        df.revision_no,
        df.is_workflow_complete,
        df.is_outsourced,
        df.is_legacy_workflow,
        df.removed_from_latest_ingestion
      ORDER BY df.fixture_no ASC
    `,
    [projectId, departmentId],
  );

  return result.rows.map(mapFixtureBundleRow);
}

async function loadFixtureBundleById(fixtureId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        df.id AS fixture_id,
        df.fixture_no,
        df.project_id,
        dp.department_id,
        COALESCE(dp.status, 'active') AS project_status,
        df.revision_no,
        df.is_workflow_complete,
        df.is_outsourced,
        df.is_legacy_workflow,
        df.removed_from_latest_ingestion,
        COALESCE(
          json_agg(
            json_build_object(
              'stage_name', fwp.stage_name,
              'stage_order', fwp.stage_order,
              'stage_version', fwp.stage_version,
              'status', fwp.status,
              'assigned_to', fwp.assigned_to,
              'assigned_at', fwp.assigned_at,
              'started_at', fwp.started_at,
              'completed_at', fwp.completed_at
            )
            ORDER BY fwp.stage_order ASC
          ) FILTER (WHERE fwp.fixture_id IS NOT NULL),
          '[]'::json
        ) AS progress_rows
      FROM design.fixtures df
      JOIN design.projects dp ON dp.id = df.project_id
      LEFT JOIN fixture_workflow_progress fwp
        ON fwp.fixture_id = df.id
       AND fwp.department_id = dp.department_id
      WHERE df.id = $1
        AND dp.department_id = $2
      GROUP BY
        df.id,
        df.fixture_no,
        df.project_id,
        dp.department_id,
        dp.status,
        df.revision_no,
        df.is_workflow_complete,
        df.is_outsourced,
        df.is_legacy_workflow,
        df.removed_from_latest_ingestion
      LIMIT 1
    `,
    [fixtureId, departmentId],
  );

  return mapFixtureBundleRow(result.rows[0]);
}

async function loadProjectBundlesForProjects(projectMetas = [], client = pool) {
  const ids = projectMetas.map((meta) => meta.project_id).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        dp.id AS project_id,
        dp.project_no,
        dp.department_id,
        COALESCE(dp.status, 'active') AS project_status,
        COALESCE(
          json_agg(
            json_build_object(
              'fixture_id', df.id,
              'fixture_no', df.fixture_no,
              'project_id', df.project_id,
              'department_id', dp.department_id,
              'project_status', COALESCE(dp.status, 'active'),
              'revision_no', df.revision_no,
              'is_workflow_complete', df.is_workflow_complete,
              'is_outsourced', df.is_outsourced,
              'is_legacy_workflow', df.is_legacy_workflow,
              'removed_from_latest_ingestion', df.removed_from_latest_ingestion,
              'is_required_for_project_kpi', TRUE,
              'progress_rows', fixture_progress.progress_rows
            )
            ORDER BY df.fixture_no ASC
          ) FILTER (WHERE df.id IS NOT NULL),
          '[]'::json
        ) AS fixture_bundles
      FROM design.projects dp
      LEFT JOIN design.fixtures df
        ON df.project_id = dp.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'stage_name', fwp.stage_name,
              'stage_order', fwp.stage_order,
              'stage_version', fwp.stage_version,
              'status', fwp.status,
              'assigned_to', fwp.assigned_to,
              'assigned_at', fwp.assigned_at,
              'started_at', fwp.started_at,
              'completed_at', fwp.completed_at
            )
            ORDER BY fwp.stage_order ASC
          ) FILTER (WHERE fwp.fixture_id IS NOT NULL),
          '[]'::json
        ) AS progress_rows
        FROM fixture_workflow_progress fwp
        WHERE fwp.fixture_id = df.id
          AND fwp.department_id = dp.department_id
      ) fixture_progress ON TRUE
      WHERE dp.id = ANY($1::uuid[])
      GROUP BY dp.id, dp.project_no, dp.department_id, dp.status
    `,
    [ids],
  );

  const metaById = new Map(projectMetas.map((meta) => [meta.project_id, meta]));

  return result.rows.map((row) => ({
    project_id: row.project_id,
    project_no: row.project_no || metaById.get(row.project_id)?.project_no || null,
    department_id: row.department_id,
    project_status: row.project_status,
    fixture_bundles: (row.fixture_bundles || []).map((bundle) => ({
      ...bundle,
      revision_no: Number(bundle.revision_no || 0),
      is_workflow_complete: bundle.is_workflow_complete === true,
      is_outsourced: bundle.is_outsourced === true,
      is_legacy_workflow: bundle.is_legacy_workflow === true,
      removed_from_latest_ingestion: bundle.removed_from_latest_ingestion === true,
      is_required_for_project_kpi: bundle.is_required_for_project_kpi !== false,
      progress_rows: Array.isArray(bundle.progress_rows) ? bundle.progress_rows : [],
    })),
  }));
}

async function insertCompletionSnapshot(snapshot, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.workflow_completion_snapshots (
        fixture_id,
        project_id,
        scope,
        trigger,
        payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id, captured_at
    `,
    [
      snapshot.fixture_id || null,
      snapshot.project_id || null,
      snapshot.scope,
      snapshot.trigger,
      JSON.stringify(snapshot.payload || {}),
    ],
  );

  return result.rows[0] || null;
}

module.exports = instrumentModuleExports("repository.designCompletionRepository", {
  insertCompletionSnapshot,
  loadFixtureBundleById,
  loadFixtureBundlesForProject,
  loadProjectBundlesForProjects,
  loadStageWeightRowsForDepartment,
});
