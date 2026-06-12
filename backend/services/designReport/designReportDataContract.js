const { pool } = require("../../db");
const { listContributionsForFixtures } = require("../../repositories/designStageContributionRepository");
const { listStageAttemptsForFixtures } = require("../../repositories/fixtureWorkflowRepository");
const { loadStageWeightRowsForDepartment } = require("../../repositories/designCompletionRepository");
const { getConfiguredWorkflowForDepartment } = require("../../repositories/fixtureWorkflowRepository");
const { getProjectCompletionTruthById } = require("../designCompletion/designCompletionEngine");
const { collectDesignReportTruthLayerErrors } = require("./designReportValidation");
const { userIdentifierMatchSql } = require("../../repositories/sqlFragments");

async function getFixtureProgressRows(fixtureIds) {
  if (!fixtureIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        progress.fixture_id,
        progress.stage_name,
        progress.stage_version,
        progress.stage_order,
        progress.status,
        progress.assigned_to,
        progress.assigned_at,
        progress.started_at,
        progress.completed_at,
        progress.duration_minutes,
        progress.updated_at,
        users.name AS assigned_to_name
      FROM fixture_workflow_progress progress
      LEFT JOIN users
        ON ${userIdentifierMatchSql("users", "progress.assigned_to")}
      WHERE progress.fixture_id = ANY($1::uuid[])
      ORDER BY progress.fixture_id ASC, progress.stage_order ASC, progress.stage_name ASC
    `,
    [fixtureIds],
  );

  return result.rows;
}

async function getFixtureStageTaskRows(fixtureIds) {
  if (!fixtureIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        t.id AS task_id,
        t.fixture_id,
        COALESCE(NULLIF(t.stage, ''), NULLIF(stage.stage_name, ''), NULLIF(stage.name, ''), 'Workflow Stage') AS stage_name,
        t.proof_url,
        t.status,
        t.priority,
        t.deadline,
        t.due_date,
        t.sla_due_date,
        t.assigned_to,
        t.assignee_ids,
        assignee.name AS assigned_to_name,
        (
          SELECT STRING_AGG(
            COALESCE(task_assignee_user.name, task_assignee.employee_id),
            ', '
            ORDER BY COALESCE(task_assignee_user.name, task_assignee.employee_id)
          )
          FROM jsonb_array_elements_text(COALESCE(t.assignee_ids, '[]'::jsonb)) AS task_assignee(employee_id)
          LEFT JOIN users task_assignee_user
            ON ${userIdentifierMatchSql("task_assignee_user", "task_assignee.employee_id")}
        ) AS assignee_names,
        t.assigned_by,
        assigner.name AS assigned_by_name,
        t.assigned_at,
        t.started_at,
        t.completed_at,
        t.closed_at,
        t.submitted_at,
        t.approved_at,
        t.created_at,
        t.updated_at,
        t.planned_minutes,
        t.actual_minutes
      FROM tasks t
      LEFT JOIN workflow_stages stage
        ON stage.id = t.current_stage_id
      LEFT JOIN users assignee
        ON ${userIdentifierMatchSql("assignee", "t.assigned_to")}
      LEFT JOIN users assigner
        ON ${userIdentifierMatchSql("assigner", "t.assigned_by")}
      WHERE t.fixture_id = ANY($1::uuid[])
        AND t.status <> 'cancelled'
      ORDER BY t.fixture_id ASC, t.created_at ASC, t.id ASC
    `,
    [fixtureIds],
  );

  return result.rows;
}

async function getTaskAttachmentsByTaskIds(taskIds) {
  const filteredTaskIds = [...new Set(taskIds.map((taskId) => Number(taskId)).filter(Number.isInteger))];

  if (!filteredTaskIds.length) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT
        ta.id,
        ta.task_id,
        ta.file_url,
        ta.file_name,
        ta.mime_type,
        ta.file_size,
        ta.uploaded_by,
        uploader.name AS uploaded_by_name,
        ta.uploaded_at
      FROM task_attachments ta
      LEFT JOIN users uploader
        ON ${userIdentifierMatchSql("uploader", "ta.uploaded_by")}
      WHERE ta.task_id = ANY($1::int[])
      ORDER BY ta.task_id ASC, ta.uploaded_at ASC, ta.id ASC
    `,
    [filteredTaskIds],
  );

  return result.rows.reduce((map, row) => {
    const taskId = Number(row.task_id);
    const attachments = map.get(taskId) || [];
    attachments.push(row);
    map.set(taskId, attachments);
    return map;
  }, new Map());
}

async function getTaskActivitiesByTaskIds(taskIds) {
  const filteredTaskIds = [...new Set(taskIds.map((taskId) => Number(taskId)).filter(Number.isInteger))];

  if (!filteredTaskIds.length) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT
        activity.task_id,
        activity.user_employee_id,
        activity.action_type,
        activity.notes,
        activity.metadata,
        activity.created_at,
        users.name AS user_name
      FROM task_activity_logs activity
      LEFT JOIN users
        ON ${userIdentifierMatchSql("users", "activity.user_employee_id")}
      WHERE activity.task_id = ANY($1::int[])
      ORDER BY activity.task_id ASC, activity.created_at ASC, activity.id ASC
    `,
    [filteredTaskIds],
  );

  return result.rows.reduce((map, row) => {
    const taskId = Number(row.task_id);
    const entries = map.get(taskId) || [];
    entries.push(row);
    map.set(taskId, entries);
    return map;
  }, new Map());
}

async function listRevisionsForFixtures(fixtureIds, departmentId) {
  if (!fixtureIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        fwr.*,
        requester.name AS requested_by_name,
        approver.name AS approved_by_name,
        changer.name AS changed_by_name
      FROM fixture_workflow_revisions fwr
      LEFT JOIN users requester ON ${userIdentifierMatchSql("requester", "fwr.requested_by")}
      LEFT JOIN users approver ON ${userIdentifierMatchSql("approver", "fwr.approved_by")}
      LEFT JOIN users changer ON ${userIdentifierMatchSql("changer", "fwr.changed_by")}
      WHERE fwr.fixture_id = ANY($1::uuid[])
        AND fwr.department_id = $2
      ORDER BY fwr.fixture_id ASC, fwr.stage_version DESC, fwr.changed_at DESC
    `,
    [fixtureIds, departmentId],
  );

  return result.rows;
}

/**
 * Aggregated, batched report payload for template-exact export generation.
 */
async function loadDesignReportExportData({
  fixtures,
  projectId,
  departmentId,
}) {
  const fixtureIds = fixtures.map((fixture) => fixture.fixture_id);

  const [
    progressRows,
    attemptRows,
    stageTasks,
    contributions,
    revisions,
    projectTruth,
    weightRows,
    workflow,
  ] = await Promise.all([
    getFixtureProgressRows(fixtureIds),
    listStageAttemptsForFixtures(fixtureIds),
    getFixtureStageTaskRows(fixtureIds),
    listContributionsForFixtures(fixtureIds),
    listRevisionsForFixtures(fixtureIds, departmentId),
    getProjectCompletionTruthById(projectId, departmentId),
    loadStageWeightRowsForDepartment(departmentId),
    getConfiguredWorkflowForDepartment(departmentId),
  ]);

  const outsourcedFixtureIds = new Set(
    (projectTruth?.fixtures || [])
      .filter((truth) => truth.is_outsourced)
      .map((truth) => String(truth.fixture_id)),
  );

  const integrityWarnings = collectDesignReportTruthLayerErrors({
    fixtures,
    progressRows,
    attemptRows,
    contributions,
    revisions,
    projectTruth,
    outsourcedFixtureIds,
  });

  const stageTaskIds = stageTasks.map((task) => task.task_id);
  const reportTaskIds = [
    ...fixtures.map((fixture) => fixture.task_id).filter(Boolean),
    ...stageTaskIds,
  ];

  const [attachmentsByTaskId, activitiesByTaskId] = await Promise.all([
    getTaskAttachmentsByTaskIds(reportTaskIds),
    getTaskActivitiesByTaskIds(reportTaskIds),
  ]);

  return {
    progressRows,
    attemptRows,
    stageTasks,
    contributions,
    revisions,
    projectTruth,
    weightRows,
    workflowStages: workflow?.stages || [],
    attachmentsByTaskId,
    activitiesByTaskId,
    outsourcedFixtureIds,
    integrityWarnings,
  };
}

module.exports = {
  getFixtureProgressRows,
  getFixtureStageTaskRows,
  getTaskActivitiesByTaskIds,
  getTaskAttachmentsByTaskIds,
  listRevisionsForFixtures,
  loadDesignReportExportData,
};
