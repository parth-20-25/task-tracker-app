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
    task_rows: Array.isArray(row.task_rows) ? row.task_rows : [],
    task_attachment_rows: Array.isArray(row.task_attachment_rows) ? row.task_attachment_rows : [],
    stage_attempt_rows: Array.isArray(row.stage_attempt_rows) ? row.stage_attempt_rows : [],
    contribution_rows: Array.isArray(row.contribution_rows) ? row.contribution_rows : [],
  };
}

async function tableExists(qualifiedName, client = pool) {
  const result = await client.query("SELECT to_regclass($1) AS exists", [qualifiedName]);
  return Boolean(result.rows[0]?.exists);
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
        ) AS progress_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'task_id', t.id,
                'stage_name', COALESCE(NULLIF(t.stage, ''), NULLIF(stage.stage_name, ''), NULLIF(stage.name, ''), 'Workflow Stage'),
                'status', t.status,
                'assigned_to', t.assigned_to,
                'assignee_ids', COALESCE(t.assignee_ids, '[]'::jsonb),
                'proof_url', COALESCE(t.proof_url, '[]'::jsonb),
                'submitted_at', t.submitted_at,
                'approved_at', t.approved_at,
                'closed_at', t.closed_at,
                'completion_percent', t.completion_percent
              )
              ORDER BY t.created_at ASC, t.id ASC
            ),
            '[]'::jsonb
          )
          FROM tasks t
          LEFT JOIN workflow_stages stage
            ON stage.id = t.current_stage_id
          WHERE t.fixture_id = df.id
            AND t.department_id = dp.department_id
            AND t.status <> 'cancelled'
        ) AS task_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'attachment_id', ta.id,
                'task_id', ta.task_id,
                'file_url', ta.file_url,
                'uploaded_by', ta.uploaded_by,
                'uploaded_at', ta.uploaded_at
              )
              ORDER BY ta.uploaded_at ASC, ta.id ASC
            ),
            '[]'::jsonb
          )
          FROM task_attachments ta
          JOIN tasks t
            ON t.id = ta.task_id
          WHERE t.fixture_id = df.id
            AND t.department_id = dp.department_id
            AND t.status <> 'cancelled'
        ) AS task_attachment_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'stage_name', attempts.stage_name,
                'attempt_no', attempts.attempt_no,
                'stage_version', attempts.stage_version,
                'status', attempts.status,
                'assigned_to', attempts.assigned_to,
                'started_at', attempts.started_at,
                'completed_at', attempts.completed_at,
                'approved_at', attempts.approved_at
              )
              ORDER BY attempts.stage_name ASC, attempts.attempt_no ASC
            ),
            '[]'::jsonb
          )
          FROM fixture_workflow_stage_attempts attempts
          WHERE attempts.fixture_id = df.id
            AND attempts.department_id = dp.department_id
        ) AS stage_attempt_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'stage_name', contribution.stage_name,
                'revision_code', contribution.revision_code,
                'stage_revision_no', contribution.stage_revision_no,
                'employee_id', contribution.employee_id,
                'contribution_percent', contribution.contribution_percent,
                'contribution_kind', contribution.contribution_kind,
                'changed_at', contribution.changed_at
              )
              ORDER BY contribution.stage_name ASC, contribution.changed_at ASC, contribution.id ASC
            ),
            '[]'::jsonb
          )
          FROM design.fixture_stage_contributions contribution
          WHERE contribution.fixture_id = df.id
            AND contribution.department_id = dp.department_id
            AND contribution.superseded_by IS NULL
        ) AS contribution_rows
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
        ) AS progress_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'task_id', t.id,
                'stage_name', COALESCE(NULLIF(t.stage, ''), NULLIF(stage.stage_name, ''), NULLIF(stage.name, ''), 'Workflow Stage'),
                'status', t.status,
                'assigned_to', t.assigned_to,
                'assignee_ids', COALESCE(t.assignee_ids, '[]'::jsonb),
                'proof_url', COALESCE(t.proof_url, '[]'::jsonb),
                'submitted_at', t.submitted_at,
                'approved_at', t.approved_at,
                'closed_at', t.closed_at,
                'completion_percent', t.completion_percent
              )
              ORDER BY t.created_at ASC, t.id ASC
            ),
            '[]'::jsonb
          )
          FROM tasks t
          LEFT JOIN workflow_stages stage
            ON stage.id = t.current_stage_id
          WHERE t.fixture_id = df.id
            AND t.department_id = dp.department_id
            AND t.status <> 'cancelled'
        ) AS task_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'attachment_id', ta.id,
                'task_id', ta.task_id,
                'file_url', ta.file_url,
                'uploaded_by', ta.uploaded_by,
                'uploaded_at', ta.uploaded_at
              )
              ORDER BY ta.uploaded_at ASC, ta.id ASC
            ),
            '[]'::jsonb
          )
          FROM task_attachments ta
          JOIN tasks t
            ON t.id = ta.task_id
          WHERE t.fixture_id = df.id
            AND t.department_id = dp.department_id
            AND t.status <> 'cancelled'
        ) AS task_attachment_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'stage_name', attempts.stage_name,
                'attempt_no', attempts.attempt_no,
                'stage_version', attempts.stage_version,
                'status', attempts.status,
                'assigned_to', attempts.assigned_to,
                'started_at', attempts.started_at,
                'completed_at', attempts.completed_at,
                'approved_at', attempts.approved_at
              )
              ORDER BY attempts.stage_name ASC, attempts.attempt_no ASC
            ),
            '[]'::jsonb
          )
          FROM fixture_workflow_stage_attempts attempts
          WHERE attempts.fixture_id = df.id
            AND attempts.department_id = dp.department_id
        ) AS stage_attempt_rows,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'stage_name', contribution.stage_name,
                'revision_code', contribution.revision_code,
                'stage_revision_no', contribution.stage_revision_no,
                'employee_id', contribution.employee_id,
                'contribution_percent', contribution.contribution_percent,
                'contribution_kind', contribution.contribution_kind,
                'changed_at', contribution.changed_at
              )
              ORDER BY contribution.stage_name ASC, contribution.changed_at ASC, contribution.id ASC
            ),
            '[]'::jsonb
          )
          FROM design.fixture_stage_contributions contribution
          WHERE contribution.fixture_id = df.id
            AND contribution.department_id = dp.department_id
            AND contribution.superseded_by IS NULL
        ) AS contribution_rows
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
              'progress_rows', fixture_progress.progress_rows,
              'task_rows', fixture_tasks.task_rows,
              'task_attachment_rows', fixture_task_attachments.task_attachment_rows,
              'stage_attempt_rows', fixture_stage_attempts.stage_attempt_rows,
              'contribution_rows', fixture_contributions.contribution_rows
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
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'task_id', t.id,
              'stage_name', COALESCE(NULLIF(t.stage, ''), NULLIF(stage.stage_name, ''), NULLIF(stage.name, ''), 'Workflow Stage'),
              'status', t.status,
              'assigned_to', t.assigned_to,
              'assignee_ids', COALESCE(t.assignee_ids, '[]'::jsonb),
              'proof_url', COALESCE(t.proof_url, '[]'::jsonb),
              'submitted_at', t.submitted_at,
              'approved_at', t.approved_at,
              'closed_at', t.closed_at,
              'completion_percent', t.completion_percent
            )
            ORDER BY t.created_at ASC, t.id ASC
          ),
          '[]'::jsonb
        ) AS task_rows
        FROM tasks t
        LEFT JOIN workflow_stages stage
          ON stage.id = t.current_stage_id
        WHERE t.fixture_id = df.id
          AND t.department_id = dp.department_id
          AND t.status <> 'cancelled'
      ) fixture_tasks ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'attachment_id', ta.id,
              'task_id', ta.task_id,
              'file_url', ta.file_url,
              'uploaded_by', ta.uploaded_by,
              'uploaded_at', ta.uploaded_at
            )
            ORDER BY ta.uploaded_at ASC, ta.id ASC
          ),
          '[]'::jsonb
        ) AS task_attachment_rows
        FROM task_attachments ta
        JOIN tasks t
          ON t.id = ta.task_id
        WHERE t.fixture_id = df.id
          AND t.department_id = dp.department_id
          AND t.status <> 'cancelled'
      ) fixture_task_attachments ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'stage_name', attempts.stage_name,
              'attempt_no', attempts.attempt_no,
              'stage_version', attempts.stage_version,
              'status', attempts.status,
              'assigned_to', attempts.assigned_to,
              'started_at', attempts.started_at,
              'completed_at', attempts.completed_at,
              'approved_at', attempts.approved_at
            )
            ORDER BY attempts.stage_name ASC, attempts.attempt_no ASC
          ),
          '[]'::jsonb
        ) AS stage_attempt_rows
        FROM fixture_workflow_stage_attempts attempts
        WHERE attempts.fixture_id = df.id
          AND attempts.department_id = dp.department_id
      ) fixture_stage_attempts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'stage_name', contribution.stage_name,
              'revision_code', contribution.revision_code,
              'stage_revision_no', contribution.stage_revision_no,
              'employee_id', contribution.employee_id,
              'contribution_percent', contribution.contribution_percent,
              'contribution_kind', contribution.contribution_kind,
              'changed_at', contribution.changed_at
            )
            ORDER BY contribution.stage_name ASC, contribution.changed_at ASC, contribution.id ASC
          ),
          '[]'::jsonb
        ) AS contribution_rows
        FROM design.fixture_stage_contributions contribution
        WHERE contribution.fixture_id = df.id
          AND contribution.department_id = dp.department_id
          AND contribution.superseded_by IS NULL
      ) fixture_contributions ON TRUE
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
      task_rows: Array.isArray(bundle.task_rows) ? bundle.task_rows : [],
      task_attachment_rows: Array.isArray(bundle.task_attachment_rows) ? bundle.task_attachment_rows : [],
      stage_attempt_rows: Array.isArray(bundle.stage_attempt_rows) ? bundle.stage_attempt_rows : [],
      contribution_rows: Array.isArray(bundle.contribution_rows) ? bundle.contribution_rows : [],
    })),
  }));
}

async function insertCompletionSnapshot(snapshot, client = pool) {
  if (!(await tableExists("design.workflow_completion_snapshots", client))) {
    return null;
  }

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
