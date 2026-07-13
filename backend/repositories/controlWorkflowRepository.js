const { pool } = require("../db");
const { CONTROL_DEPARTMENT_ID } = require("../lib/controlWorkflow");
const { userIdentifierMatchSql } = require("./sqlFragments");

function mapTemplate(row, stages = []) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    department_id: row.department_id,
    department_name: row.department_name || null,
    sub_department_id: row.sub_department_id || null,
    sub_department_name: row.sub_department_name || null,
    name: row.template_name || row.name,
    template_name: row.template_name || row.name,
    is_active: row.is_active !== false,
    stages,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStage(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workflow_id: row.workflow_id,
    template_stage_id: row.template_stage_id || null,
    stage_name: row.stage_name,
    sequence_order: Number(row.sequence_order),
    is_required: row.is_required !== false,
    status: row.status,
    current_document_path: row.current_document_path || null,
    started_at: row.started_at || null,
    submitted_at: row.submitted_at || null,
    approved_at: row.approved_at || null,
    approved_by: row.approved_by || null,
    approved_by_name: row.approved_by_name || null,
    due_date: row.due_date || null,
    remarks: row.remarks || null,
    revision_count: Number(row.revision_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    submissions: [],
    revisions: [],
    document_history: [],
    override_history: [],
  };
}

function mapWorkflow(row, stages = []) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    project_id: row.project_id,
    project_no: row.project_no || null,
    project_name: row.project_name || null,
    customer_name: row.customer_name || null,
    project_status: row.project_status || null,
    dispatch_status: row.dispatch_status || null,
    dispatched_by: row.dispatched_by || null,
    dispatched_by_name: row.dispatched_by_name || null,
    dispatched_at: row.dispatched_at || null,
    dispatch_remarks: row.dispatch_remarks || null,
    department_id: row.department_id,
    department_name: row.department_name || null,
    sub_department_id: row.sub_department_id,
    sub_department_name: row.sub_department_name || null,
    template_id: row.template_id,
    template_name: row.template_name || null,
    assigned_user_id: row.assigned_user_id,
    assigned_user_name: row.assigned_user_name || null,
    assigned_by: row.assigned_by || null,
    assigned_by_name: row.assigned_by_name || null,
    assigned_at: row.assigned_at || null,
    current_stage_id: row.current_stage_id || null,
    status: row.status,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stages,
  };
}

function mapSubmission(row) {
  return {
    id: row.id,
    workflow_stage_id: row.workflow_stage_id,
    workflow_id: row.workflow_id,
    revision_id: row.revision_id || null,
    submitted_by: row.submitted_by,
    submitted_by_name: row.submitted_by_name || null,
    submitted_document_path: row.submitted_document_path,
    remarks: row.remarks || null,
    status: row.status,
    reviewed_by: row.reviewed_by || null,
    reviewed_by_name: row.reviewed_by_name || null,
    reviewed_at: row.reviewed_at || null,
    review_remarks: row.review_remarks || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRevision(row) {
  return {
    id: row.id,
    workflow_stage_id: row.workflow_stage_id,
    workflow_id: row.workflow_id,
    revision_reason: row.revision_reason,
    manual_reason: row.manual_reason || null,
    description: row.description,
    due_date: row.due_date,
    priority: row.priority || null,
    affected_stage_ids: Array.isArray(row.affected_stage_ids) ? row.affected_stage_ids : [],
    status: row.status,
    raised_by: row.raised_by,
    raised_by_name: row.raised_by_name || null,
    assigned_to: row.assigned_to,
    assigned_to_name: row.assigned_to_name || null,
    started_at: row.started_at || null,
    submitted_at: row.submitted_at || null,
    approved_by: row.approved_by || null,
    approved_by_name: row.approved_by_name || null,
    approved_at: row.approved_at || null,
    remarks: row.remarks || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapHistory(row) {
  return {
    id: row.id,
    workflow_stage_id: row.workflow_stage_id,
    old_path: row.old_path || null,
    new_path: row.new_path,
    changed_by: row.changed_by,
    changed_by_name: row.changed_by_name || null,
    change_remarks: row.change_remarks || null,
    created_at: row.created_at,
  };
}

function mapOverride(row) {
  return {
    id: row.id,
    workflow_stage_id: row.workflow_stage_id,
    workflow_id: row.workflow_id,
    unlocked_by: row.unlocked_by,
    unlocked_by_name: row.unlocked_by_name || null,
    action_type: row.action_type || "override_unlock",
    reason: row.reason,
    supporting_document_path: row.supporting_document_path || null,
    approved_by: row.approved_by || null,
    approved_by_name: row.approved_by_name || null,
    remarks: row.remarks,
    created_at: row.created_at,
  };
}

async function listControlSubDepartments(client = pool) {
  const result = await client.query(
    `
      SELECT ds.id, ds.department_id, ds.subdivision_name, ds.is_active, ds.created_at, ds.updated_at
      FROM department_subdivisions ds
      JOIN departments d ON d.id = ds.department_id
      WHERE d.id = 'control'
        AND ds.is_active = TRUE
      ORDER BY ds.subdivision_name ASC
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    department_id: row.department_id,
    subdivision_name: row.subdivision_name,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function findSubDepartmentByName(name, client = pool) {
  const result = await client.query(
    `
      SELECT id, department_id, subdivision_name, is_active, created_at, updated_at
      FROM department_subdivisions
      WHERE department_id = 'control'
        AND LOWER(BTRIM(subdivision_name)) = LOWER(BTRIM($1))
      LIMIT 1
    `,
    [name],
  );

  return result.rows[0] || null;
}

async function listTemplateStages(templateId, client = pool) {
  const result = await client.query(
    `
      SELECT id, template_id, stage_name, sequence_order, is_required, created_at, updated_at
      FROM workflow_template_stages
      WHERE template_id = $1
      ORDER BY sequence_order ASC
    `,
    [templateId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    template_id: row.template_id,
    stage_name: row.stage_name,
    sequence_order: Number(row.sequence_order),
    is_required: row.is_required !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function findTemplateBySubDepartment(subDepartmentId, client = pool) {
  const result = await client.query(
    `
      SELECT wt.*, d.name AS department_name, ds.subdivision_name AS sub_department_name
      FROM workflow_templates wt
      JOIN departments d ON d.id = wt.department_id
      JOIN department_subdivisions ds ON ds.id = wt.sub_department_id
      WHERE wt.sub_department_id = $1
        AND wt.is_active = TRUE
        AND wt.workflow_family = 'control_project'
      ORDER BY wt.updated_at DESC
      LIMIT 1
    `,
    [subDepartmentId],
  );

  const template = mapTemplate(result.rows[0]);
  if (!template) {
    return null;
  }

  template.stages = await listTemplateStages(template.id, client);
  return template;
}

async function findTemplateById(templateId, client = pool) {
  const result = await client.query(
    `
      SELECT wt.*, d.name AS department_name, ds.subdivision_name AS sub_department_name
      FROM workflow_templates wt
      JOIN departments d ON d.id = wt.department_id
      LEFT JOIN department_subdivisions ds ON ds.id = wt.sub_department_id
      WHERE wt.id = $1
      LIMIT 1
    `,
    [templateId],
  );

  const template = mapTemplate(result.rows[0]);
  if (!template) {
    return null;
  }

  template.stages = await listTemplateStages(template.id, client);
  return template;
}

async function insertProjectWorkflow(values, client = pool) {
  const result = await client.query(
    `
      INSERT INTO project_workflows (
        project_id,
        department_id,
        sub_department_id,
        template_id,
        assigned_user_id,
        assigned_by,
        assigned_at,
        status,
        started_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5::varchar IS NULL THEN NULL ELSE NOW() END, 'active', NOW(), NOW(), NOW())
      RETURNING id
    `,
    [
      values.project_id,
      values.department_id,
      values.sub_department_id,
      values.template_id,
      values.assigned_user_id,
      values.assigned_by || null,
    ],
  );

  return result.rows[0]?.id || null;
}

async function insertProjectWorkflowStage(stage, client = pool) {
  const result = await client.query(
    `
      INSERT INTO project_workflow_stages (
        workflow_id,
        template_stage_id,
        stage_name,
        sequence_order,
        is_required,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id
    `,
    [
      stage.workflow_id,
      stage.template_stage_id || null,
      stage.stage_name,
      stage.sequence_order,
      stage.is_required !== false,
      stage.status,
    ],
  );

  return result.rows[0]?.id || null;
}

async function updateWorkflowCurrentStage(workflowId, currentStageId, client = pool) {
  await client.query(
    `
      UPDATE project_workflows
      SET current_stage_id = $2,
          updated_at = NOW()
      WHERE id = $1
    `,
    [workflowId, currentStageId || null],
  );
}

async function updateWorkflowStatus(workflowId, status, client = pool) {
  await client.query(
    `
      UPDATE project_workflows
      SET status = $2,
          completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
          updated_at = NOW()
      WHERE id = $1
    `,
    [workflowId, status],
  );
}

async function updateWorkflowOwner(workflowId, assignedUserId, assignedBy, reason = null, client = pool) {
  await client.query(
    `
      WITH previous AS (
        SELECT id, assigned_user_id
        FROM project_workflows
        WHERE id = $1
      ), updated AS (
        UPDATE project_workflows
        SET assigned_user_id = $2,
            assigned_by = $3,
            assigned_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, assigned_user_id
      )
      INSERT INTO workflow_assignment_history (
        workflow_id,
        old_assigned_user_id,
        new_assigned_user_id,
        changed_by,
        reason,
        created_at
      )
      SELECT updated.id, previous.assigned_user_id, updated.assigned_user_id, $3, $4, NOW()
      FROM updated
      JOIN previous ON previous.id = updated.id
      WHERE previous.assigned_user_id IS DISTINCT FROM updated.assigned_user_id
    `,
    [workflowId, assignedUserId, assignedBy || null, reason || null],
  );
}

function workflowSelectSql(whereClause) {
  return `
    SELECT
      pw.*,
      p.project_no,
      p.project_name,
      p.customer_name,
      COALESCE(pcr.lifecycle_status, p.status, 'active') AS project_status,
      CASE
        WHEN pcr.lifecycle_status = 'dispatched' THEN 'Dispatched'
        WHEN pcr.lifecycle_status = 'ready_for_dispatch' THEN 'Ready for Dispatch'
        ELSE 'Not dispatched'
      END AS dispatch_status,
      pcr.dispatched_by,
      dispatcher.name AS dispatched_by_name,
      pcr.dispatched_at,
      pcr.dispatch_remarks,
      d.name AS department_name,
      ds.subdivision_name AS sub_department_name,
      wt.template_name,
      owner.name AS assigned_user_name,
      assigner.name AS assigned_by_name
    FROM project_workflows pw
    JOIN design.projects p ON p.id = pw.project_id
    JOIN departments d ON d.id = pw.department_id
    JOIN department_subdivisions ds ON ds.id = pw.sub_department_id
    JOIN workflow_templates wt ON wt.id = pw.template_id
    LEFT JOIN project_control_records pcr
      ON pcr.project_id = pw.project_id
     AND pcr.sub_department_id = pw.sub_department_id
     AND pcr.status = 'active'
    LEFT JOIN users dispatcher ON ${userIdentifierMatchSql("dispatcher", "pcr.dispatched_by")}
    LEFT JOIN users owner ON ${userIdentifierMatchSql("owner", "pw.assigned_user_id")}
    LEFT JOIN users assigner ON ${userIdentifierMatchSql("assigner", "pw.assigned_by")}
    ${whereClause}
  `;
}

async function findActiveProjectWorkflow({ projectId, subDepartmentId, templateId = null }, client = pool) {
  const params = [projectId, subDepartmentId, templateId || null];
  const result = await client.query(
    `
      ${workflowSelectSql(`
        WHERE pw.project_id = $1
          AND pw.sub_department_id = $2
          AND ($3::uuid IS NULL OR pw.template_id = $3)
          AND pw.status <> 'cancelled'
      `)}
      ORDER BY pw.created_at DESC
      LIMIT 1
    `,
    params,
  );

  return mapWorkflow(result.rows[0]);
}

async function findWorkflowById(workflowId, client = pool) {
  const result = await client.query(
    `
      ${workflowSelectSql("WHERE pw.id = $1")}
      LIMIT 1
    `,
    [workflowId],
  );

  return mapWorkflow(result.rows[0]);
}

async function listWorkflowStages(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT
        pws.*,
        approver.name AS approved_by_name,
        (
          SELECT COUNT(*)::int
          FROM workflow_stage_revisions revision
          WHERE revision.workflow_stage_id = pws.id
        ) AS revision_count
      FROM project_workflow_stages pws
      LEFT JOIN users approver ON ${userIdentifierMatchSql("approver", "pws.approved_by")}
      WHERE pws.workflow_id = $1
      ORDER BY pws.sequence_order ASC
    `,
    [workflowId],
  );

  return result.rows.map(mapStage);
}

async function findWorkflowStage(stageId, client = pool) {
  const result = await client.query(
    `
      SELECT
        pws.*,
        approver.name AS approved_by_name,
        (
          SELECT COUNT(*)::int
          FROM workflow_stage_revisions revision
          WHERE revision.workflow_stage_id = pws.id
        ) AS revision_count
      FROM project_workflow_stages pws
      LEFT JOIN users approver ON ${userIdentifierMatchSql("approver", "pws.approved_by")}
      WHERE pws.id = $1
      LIMIT 1
    `,
    [stageId],
  );

  return mapStage(result.rows[0]);
}

async function updateStage(stageId, values, client = pool) {
  await client.query(
    `
      UPDATE project_workflow_stages
      SET status = COALESCE($2, status),
          current_document_path = CASE WHEN $3::boolean THEN $4 ELSE current_document_path END,
          started_at = CASE WHEN $5::boolean THEN COALESCE(started_at, NOW()) ELSE started_at END,
          submitted_at = CASE WHEN $6::boolean THEN NOW() ELSE submitted_at END,
          approved_at = CASE WHEN $7::boolean THEN COALESCE($8::timestamptz, NOW()) ELSE approved_at END,
          approved_by = CASE WHEN $9::boolean THEN $10 ELSE approved_by END,
          due_date = CASE WHEN $11::boolean THEN $12::timestamptz ELSE due_date END,
          remarks = CASE WHEN $13::boolean THEN $14 ELSE remarks END,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      stageId,
      values.status || null,
      Object.prototype.hasOwnProperty.call(values, "current_document_path"),
      values.current_document_path || null,
      values.touch_started_at === true,
      values.touch_submitted_at === true,
      values.touch_approved_at === true,
      values.approved_at || null,
      Object.prototype.hasOwnProperty.call(values, "approved_by"),
      values.approved_by || null,
      Object.prototype.hasOwnProperty.call(values, "due_date"),
      values.due_date || null,
      Object.prototype.hasOwnProperty.call(values, "remarks"),
      values.remarks || null,
    ],
  );
}

async function insertSubmission(values, client = pool) {
  const result = await client.query(
    `
      INSERT INTO workflow_stage_submissions (
        workflow_stage_id,
        workflow_id,
        revision_id,
        submitted_by,
        submitted_document_path,
        remarks,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())
      RETURNING id
    `,
    [
      values.workflow_stage_id,
      values.workflow_id,
      values.revision_id || null,
      values.submitted_by,
      values.submitted_document_path,
      values.remarks || null,
    ],
  );

  return result.rows[0]?.id || null;
}

async function findPendingSubmissionForStage(stageId, client = pool) {
  const result = await client.query(
    `
      SELECT sub.*, submitter.name AS submitted_by_name, reviewer.name AS reviewed_by_name
      FROM workflow_stage_submissions sub
      LEFT JOIN users submitter ON ${userIdentifierMatchSql("submitter", "sub.submitted_by")}
      LEFT JOIN users reviewer ON ${userIdentifierMatchSql("reviewer", "sub.reviewed_by")}
      WHERE sub.workflow_stage_id = $1
        AND sub.status = 'pending'
      ORDER BY sub.created_at DESC
      LIMIT 1
    `,
    [stageId],
  );

  return result.rows[0] ? mapSubmission(result.rows[0]) : null;
}

async function updateSubmissionReview(submissionId, values, client = pool) {
  await client.query(
    `
      UPDATE workflow_stage_submissions
      SET status = $2,
          reviewed_by = $3,
          reviewed_at = NOW(),
          review_remarks = $4,
          updated_at = NOW()
      WHERE id = $1
    `,
    [submissionId, values.status, values.reviewed_by, values.review_remarks || null],
  );
}

async function insertRevision(values, client = pool) {
  const result = await client.query(
    `
      INSERT INTO workflow_stage_revisions (
        workflow_stage_id,
        workflow_id,
        revision_reason,
        manual_reason,
        description,
        due_date,
        priority,
        affected_stage_ids,
        status,
        raised_by,
        assigned_to,
        remarks,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], 'not_started', $9, $10, $11, NOW(), NOW())
      RETURNING id
    `,
    [
      values.workflow_stage_id,
      values.workflow_id,
      values.revision_reason,
      values.manual_reason || null,
      values.description,
      values.due_date,
      values.priority || null,
      values.affected_stage_ids || [],
      values.raised_by,
      values.assigned_to,
      values.remarks || null,
    ],
  );

  return result.rows[0]?.id || null;
}

async function findRevisionById(revisionId, client = pool) {
  const result = await client.query(
    `
      SELECT
        revision.*,
        raiser.name AS raised_by_name,
        assignee.name AS assigned_to_name,
        approver.name AS approved_by_name
      FROM workflow_stage_revisions revision
      LEFT JOIN users raiser ON ${userIdentifierMatchSql("raiser", "revision.raised_by")}
      LEFT JOIN users assignee ON ${userIdentifierMatchSql("assignee", "revision.assigned_to")}
      LEFT JOIN users approver ON ${userIdentifierMatchSql("approver", "revision.approved_by")}
      WHERE revision.id = $1
      LIMIT 1
    `,
    [revisionId],
  );

  return result.rows[0] ? mapRevision(result.rows[0]) : null;
}

async function updateRevision(revisionId, values, client = pool) {
  await client.query(
    `
      UPDATE workflow_stage_revisions
      SET status = COALESCE($2, status),
          started_at = CASE WHEN $3::boolean THEN COALESCE(started_at, NOW()) ELSE started_at END,
          submitted_at = CASE WHEN $4::boolean THEN NOW() ELSE submitted_at END,
          approved_by = CASE WHEN $5::boolean THEN $6 ELSE approved_by END,
          approved_at = CASE WHEN $7::boolean THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
          remarks = CASE WHEN $8::boolean THEN $9 ELSE remarks END,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      revisionId,
      values.status || null,
      values.touch_started_at === true,
      values.touch_submitted_at === true,
      Object.prototype.hasOwnProperty.call(values, "approved_by"),
      values.approved_by || null,
      values.touch_approved_at === true,
      Object.prototype.hasOwnProperty.call(values, "remarks"),
      values.remarks || null,
    ],
  );
}

async function insertDocumentHistory(values, client = pool) {
  await client.query(
    `
      INSERT INTO workflow_document_path_history (
        workflow_stage_id,
        old_path,
        new_path,
        changed_by,
        change_remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [
      values.workflow_stage_id,
      values.old_path || null,
      values.new_path,
      values.changed_by,
      values.change_remarks || null,
    ],
  );
}

async function insertOverride(values, client = pool) {
  await client.query(
    `
      INSERT INTO workflow_unlock_overrides (
        workflow_stage_id,
        workflow_id,
        unlocked_by,
        action_type,
        reason,
        supporting_document_path,
        approved_by,
        remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
    [
      values.workflow_stage_id,
      values.workflow_id,
      values.unlocked_by,
      values.action_type || "override_unlock",
      values.reason,
      values.supporting_document_path || null,
      values.approved_by || null,
      values.remarks,
    ],
  );
}

async function hydrateWorkflowDetails(workflow, client = pool) {
  if (!workflow) {
    return null;
  }

  const [stages, submissions, revisions, history, overrides] = await Promise.all([
    listWorkflowStages(workflow.id, client),
    listSubmissionsForWorkflow(workflow.id, client),
    listRevisionsForWorkflow(workflow.id, client),
    listDocumentHistoryForWorkflow(workflow.id, client),
    listOverridesForWorkflow(workflow.id, client),
  ]);

  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  submissions.forEach((submission) => stageMap.get(submission.workflow_stage_id)?.submissions.push(submission));
  revisions.forEach((revision) => stageMap.get(revision.workflow_stage_id)?.revisions.push(revision));
  history.forEach((item) => stageMap.get(item.workflow_stage_id)?.document_history.push(item));
  overrides.forEach((item) => stageMap.get(item.workflow_stage_id)?.override_history.push(item));

  return mapWorkflow(workflow, stages);
}

async function listSubmissionsForWorkflow(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT sub.*, submitter.name AS submitted_by_name, reviewer.name AS reviewed_by_name
      FROM workflow_stage_submissions sub
      LEFT JOIN users submitter ON ${userIdentifierMatchSql("submitter", "sub.submitted_by")}
      LEFT JOIN users reviewer ON ${userIdentifierMatchSql("reviewer", "sub.reviewed_by")}
      WHERE sub.workflow_id = $1
      ORDER BY sub.created_at DESC
    `,
    [workflowId],
  );

  return result.rows.map(mapSubmission);
}

async function listRevisionsForWorkflow(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT
        revision.*,
        raiser.name AS raised_by_name,
        assignee.name AS assigned_to_name,
        approver.name AS approved_by_name
      FROM workflow_stage_revisions revision
      LEFT JOIN users raiser ON ${userIdentifierMatchSql("raiser", "revision.raised_by")}
      LEFT JOIN users assignee ON ${userIdentifierMatchSql("assignee", "revision.assigned_to")}
      LEFT JOIN users approver ON ${userIdentifierMatchSql("approver", "revision.approved_by")}
      WHERE revision.workflow_id = $1
      ORDER BY revision.created_at DESC
    `,
    [workflowId],
  );

  return result.rows.map(mapRevision);
}

async function listDocumentHistoryForWorkflow(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT history.*, changer.name AS changed_by_name
      FROM workflow_document_path_history history
      JOIN project_workflow_stages stage ON stage.id = history.workflow_stage_id
      LEFT JOIN users changer ON ${userIdentifierMatchSql("changer", "history.changed_by")}
      WHERE stage.workflow_id = $1
      ORDER BY history.created_at DESC
    `,
    [workflowId],
  );

  return result.rows.map(mapHistory);
}

async function listOverridesForWorkflow(workflowId, client = pool) {
  const result = await client.query(
    `
      SELECT override_row.*, unlocker.name AS unlocked_by_name, approver.name AS approved_by_name
      FROM workflow_unlock_overrides override_row
      LEFT JOIN users unlocker ON ${userIdentifierMatchSql("unlocker", "override_row.unlocked_by")}
      LEFT JOIN users approver ON ${userIdentifierMatchSql("approver", "override_row.approved_by")}
      WHERE override_row.workflow_id = $1
      ORDER BY override_row.created_at DESC
    `,
    [workflowId],
  );

  return result.rows.map(mapOverride);
}

async function listPendingApprovalQueue({ departmentId = null } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT
        sub.*,
        submitter.name AS submitted_by_name,
        NULL::text AS reviewed_by_name,
        stage.stage_name,
        stage.due_date,
        workflow.assigned_user_id,
        p.project_no,
        p.project_name,
        p.customer_name,
        ds.subdivision_name AS sub_department_name
      FROM workflow_stage_submissions sub
      JOIN project_workflow_stages stage ON stage.id = sub.workflow_stage_id
      JOIN project_workflows workflow ON workflow.id = sub.workflow_id
      JOIN design.projects p ON p.id = workflow.project_id
      JOIN department_subdivisions ds ON ds.id = workflow.sub_department_id
      LEFT JOIN users submitter ON ${userIdentifierMatchSql("submitter", "sub.submitted_by")}
      WHERE sub.status = 'pending'
        AND ($1::text IS NULL OR workflow.department_id = $1)
      ORDER BY sub.created_at ASC
    `,
    [departmentId || null],
  );

  return result.rows.map((row) => ({
    ...mapSubmission(row),
    stage_name: row.stage_name,
    due_date: row.due_date || null,
    assigned_user_id: row.assigned_user_id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name,
    sub_department_name: row.sub_department_name,
  }));
}

async function listRevisionQueue({ departmentId = null, assignedTo = null } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT
        revision.*,
        stage.stage_name,
        p.project_no,
        p.project_name,
        ds.subdivision_name AS sub_department_name,
        raiser.name AS raised_by_name,
        assignee.name AS assigned_to_name,
        NULL::text AS approved_by_name
      FROM workflow_stage_revisions revision
      JOIN project_workflow_stages stage ON stage.id = revision.workflow_stage_id
      JOIN project_workflows workflow ON workflow.id = revision.workflow_id
      JOIN design.projects p ON p.id = workflow.project_id
      JOIN department_subdivisions ds ON ds.id = workflow.sub_department_id
      LEFT JOIN users raiser ON ${userIdentifierMatchSql("raiser", "revision.raised_by")}
      LEFT JOIN users assignee ON ${userIdentifierMatchSql("assignee", "revision.assigned_to")}
      WHERE revision.status <> 'approved'
        AND ($1::text IS NULL OR workflow.department_id = $1)
        AND ($2::text IS NULL OR revision.assigned_to = $2)
      ORDER BY revision.due_date ASC, revision.created_at ASC
    `,
    [departmentId || null, assignedTo || null],
  );

  return result.rows.map((row) => ({
    ...mapRevision(row),
    stage_name: row.stage_name,
    project_no: row.project_no,
    project_name: row.project_name,
    sub_department_name: row.sub_department_name,
  }));
}

function mapControlRecord(row) {
  if (!row?.control_record_id) {
    return null;
  }

  return {
    id: row.control_record_id,
    project_id: row.project_id,
    sub_department_id: row.control_record_sub_department_id,
    budget_amount: row.control_record_budget_amount === null || row.control_record_budget_amount === undefined
      ? null
      : Number(row.control_record_budget_amount),
    budget_currency: row.control_record_budget_currency || "INR",
    status: row.control_record_status || "active",
    lifecycle_status: row.control_record_lifecycle_status || "unassigned",
    created_by: row.control_record_created_by || null,
    dispatched_by: row.control_record_dispatched_by || null,
    dispatched_at: row.control_record_dispatched_at || null,
    dispatch_remarks: row.control_record_dispatch_remarks || null,
    created_at: row.control_record_created_at || null,
    updated_at: row.control_record_updated_at || null,
  };
}

function mapControlDesignProject(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id,
    project_no: row.project_no,
    project_name: row.project_name,
    customer_name: row.customer_name || null,
    department_id: row.department_id,
    department_name: row.department_name || null,
    project_status: row.project_status || "active",
    completion_percent: null,
    total_fixtures: 0,
    total_tasks: 0,
    pending_tasks: 0,
    active_tasks: 0,
    completed_tasks: 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    control_record: mapControlRecord(row),
    workflow: row.workflow_id ? {
      id: row.workflow_id,
      project_id: row.project_id,
      sub_department_id: row.workflow_sub_department_id,
      assigned_user_id: row.assigned_user_id || null,
      assigned_user_name: row.assigned_user_name || null,
      assigned_by: row.assigned_by || null,
      assigned_by_name: row.assigned_by_name || null,
      assigned_at: row.assigned_at || null,
      status: row.workflow_status || "active",
      current_stage_id: row.current_stage_id || null,
      template_id: row.template_id || null,
      template_name: row.template_name || null,
      created_at: row.workflow_created_at || null,
      updated_at: row.workflow_updated_at || null,
    } : null,
  };
}

async function findProjectControlRecord(projectId, subDepartmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS control_record_id,
        project_id,
        sub_department_id AS control_record_sub_department_id,
        budget_amount AS control_record_budget_amount,
        budget_currency AS control_record_budget_currency,
        status AS control_record_status,
        lifecycle_status AS control_record_lifecycle_status,
        created_by AS control_record_created_by,
        dispatched_by AS control_record_dispatched_by,
        dispatched_at AS control_record_dispatched_at,
        dispatch_remarks AS control_record_dispatch_remarks,
        created_at AS control_record_created_at,
        updated_at AS control_record_updated_at
      FROM project_control_records
      WHERE project_id = $1
        AND sub_department_id = $2
        AND status = 'active'
      LIMIT 1
    `,
    [projectId, subDepartmentId],
  );

  return mapControlRecord(result.rows[0]);
}

async function upsertProjectControlRecord(values, client = pool) {
  const result = await client.query(
    `
      INSERT INTO project_control_records (
        project_id,
        sub_department_id,
        budget_amount,
        budget_currency,
        status,
        lifecycle_status,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'active', COALESCE($5, 'unassigned'), $6, NOW(), NOW())
      ON CONFLICT (project_id, sub_department_id)
      WHERE status = 'active'
      DO UPDATE
      SET budget_amount = EXCLUDED.budget_amount,
          budget_currency = EXCLUDED.budget_currency,
          lifecycle_status = COALESCE(NULLIF($5, ''), project_control_records.lifecycle_status),
          updated_at = NOW()
      RETURNING
        id AS control_record_id,
        project_id,
        sub_department_id AS control_record_sub_department_id,
        budget_amount AS control_record_budget_amount,
        budget_currency AS control_record_budget_currency,
        status AS control_record_status,
        lifecycle_status AS control_record_lifecycle_status,
        created_by AS control_record_created_by,
        dispatched_by AS control_record_dispatched_by,
        dispatched_at AS control_record_dispatched_at,
        dispatch_remarks AS control_record_dispatch_remarks,
        created_at AS control_record_created_at,
        updated_at AS control_record_updated_at
    `,
    [
      values.project_id,
      values.sub_department_id,
      values.budget_amount,
      values.budget_currency,
      values.lifecycle_status || null,
      values.created_by || null,
    ],
  );

  return mapControlRecord(result.rows[0]);
}

async function updateProjectControlLifecycle(values, client = pool) {
  const result = await client.query(
    `
      UPDATE project_control_records
      SET lifecycle_status = $3,
          dispatched_by = CASE WHEN $4::boolean THEN $5 ELSE dispatched_by END,
          dispatched_at = CASE WHEN $4::boolean THEN COALESCE($6::timestamptz, NOW()) ELSE dispatched_at END,
          dispatch_remarks = CASE WHEN $4::boolean THEN $7 ELSE dispatch_remarks END,
          updated_at = NOW()
      WHERE project_id = $1
        AND sub_department_id = $2
        AND status = 'active'
      RETURNING
        id AS control_record_id,
        project_id,
        sub_department_id AS control_record_sub_department_id,
        budget_amount AS control_record_budget_amount,
        budget_currency AS control_record_budget_currency,
        status AS control_record_status,
        lifecycle_status AS control_record_lifecycle_status,
        created_by AS control_record_created_by,
        dispatched_by AS control_record_dispatched_by,
        dispatched_at AS control_record_dispatched_at,
        dispatch_remarks AS control_record_dispatch_remarks,
        created_at AS control_record_created_at,
        updated_at AS control_record_updated_at
    `,
    [
      values.project_id,
      values.sub_department_id,
      values.lifecycle_status,
      values.mark_dispatched === true,
      values.dispatched_by || null,
      values.dispatched_at || null,
      values.dispatch_remarks || null,
    ],
  );

  return mapControlRecord(result.rows[0]);
}

async function insertControlNotification(values, client = pool) {
  if (!values.recipient_user_id) {
    return null;
  }

  const result = await client.query(
    `
      INSERT INTO control_workflow_notifications (
        workflow_id,
        project_id,
        recipient_user_id,
        notification_type,
        title,
        message,
        idempotency_key,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (idempotency_key) DO UPDATE
      SET title = EXCLUDED.title,
          message = EXCLUDED.message,
          updated_at = NOW()
      RETURNING *
    `,
    [
      values.workflow_id || null,
      values.project_id || null,
      values.recipient_user_id,
      values.notification_type,
      values.title,
      values.message,
      values.idempotency_key,
    ],
  );

  return result.rows[0] || null;
}
function controlDesignProjectSelect(whereClause) {
  return `
    WITH active_workflow AS (
      SELECT DISTINCT ON (pw.project_id)
        pw.*
      FROM project_workflows pw
      WHERE pw.sub_department_id = $1
        AND pw.status <> 'cancelled'
      ORDER BY pw.project_id, pw.updated_at DESC, pw.created_at DESC
    )
    SELECT
      p.id AS project_id,
      p.project_no,
      COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
      p.customer_name,
      p.department_id,
      d.name AS department_name,
      COALESCE(pcr.lifecycle_status, p.status, 'active') AS project_status,
      p.created_at,
      p.updated_at,
      pcr.id AS control_record_id,
      pcr.sub_department_id AS control_record_sub_department_id,
      pcr.budget_amount AS control_record_budget_amount,
      pcr.budget_currency AS control_record_budget_currency,
      pcr.status AS control_record_status,
      pcr.lifecycle_status AS control_record_lifecycle_status,
      pcr.created_by AS control_record_created_by,
      pcr.dispatched_by AS control_record_dispatched_by,
      pcr.dispatched_at AS control_record_dispatched_at,
      pcr.dispatch_remarks AS control_record_dispatch_remarks,
      pcr.created_at AS control_record_created_at,
      pcr.updated_at AS control_record_updated_at,
      aw.id AS workflow_id,
      aw.sub_department_id AS workflow_sub_department_id,
      aw.assigned_user_id,
      owner.name AS assigned_user_name,
      aw.assigned_by,
      assigner.name AS assigned_by_name,
      aw.assigned_at,
      aw.current_stage_id,
      aw.status AS workflow_status,
      aw.template_id,
      wt.template_name,
      aw.created_at AS workflow_created_at,
      aw.updated_at AS workflow_updated_at
    FROM design.projects p
    JOIN departments d ON d.id = p.department_id
    LEFT JOIN project_control_records pcr
      ON pcr.project_id = p.id
     AND pcr.sub_department_id = $1
     AND pcr.status = 'active'
    LEFT JOIN active_workflow aw ON aw.project_id = p.id
    LEFT JOIN workflow_templates wt ON wt.id = aw.template_id
    LEFT JOIN users owner ON ${userIdentifierMatchSql("owner", "aw.assigned_user_id")}
    LEFT JOIN users assigner ON ${userIdentifierMatchSql("assigner", "aw.assigned_by")}
    ${whereClause}
  `;
}

async function listControlDesignProjects({ subDepartmentId, assignedUserId = null, activeOnly = false } = {}, client = pool) {
  const result = await client.query(
    `
      ${controlDesignProjectSelect(`
        WHERE p.department_id = $2
          AND (pcr.id IS NOT NULL OR aw.id IS NOT NULL)
          AND ($3::text IS NULL OR aw.assigned_user_id = $3)
          AND ($4::boolean = FALSE OR COALESCE(p.status, 'active') = 'active')
      `)}
      ORDER BY
        CASE WHEN aw.id IS NULL THEN 1 ELSE 0 END,
        p.updated_at DESC,
        p.created_at DESC,
        p.project_no ASC
    `,
    [subDepartmentId, CONTROL_DEPARTMENT_ID, assignedUserId || null, activeOnly === true],
  );

  return result.rows.map(mapControlDesignProject);
}

async function findControlDesignProject(projectId, subDepartmentId, client = pool) {
  const result = await client.query(
    `
      ${controlDesignProjectSelect(`
        WHERE p.id = $2
          AND p.department_id = $3
      `)}
      LIMIT 1
    `,
    [subDepartmentId, projectId, CONTROL_DEPARTMENT_ID],
  );

  return mapControlDesignProject(result.rows[0]);
}
module.exports = {
  findActiveProjectWorkflow,
  findControlDesignProject,
  findProjectControlRecord,
  findPendingSubmissionForStage,
  findRevisionById,
  findSubDepartmentByName,
  findTemplateById,
  findTemplateBySubDepartment,
  findWorkflowById,
  findWorkflowStage,
  hydrateWorkflowDetails,
  listControlDesignProjects,
  insertDocumentHistory,
  insertOverride,
  insertControlNotification,
  insertProjectWorkflow,
  insertProjectWorkflowStage,
  insertRevision,
  insertSubmission,
  listControlSubDepartments,
  listPendingApprovalQueue,
  listRevisionQueue,
  listTemplateStages,
  listWorkflowStages,
  updateProjectControlLifecycle,
  updateRevision,
  updateStage,
  updateSubmissionReview,
  updateWorkflowCurrentStage,
  upsertProjectControlRecord,
  updateWorkflowOwner,
  updateWorkflowStatus,
};
