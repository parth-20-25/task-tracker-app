const { pool } = require("../db");
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
    reason: row.reason,
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
        status,
        started_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW(), NOW())
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

async function updateWorkflowOwner(workflowId, assignedUserId, assignedBy, client = pool) {
  await client.query(
    `
      UPDATE project_workflows
      SET assigned_user_id = $2,
          assigned_by = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [workflowId, assignedUserId, assignedBy || null],
  );
}

function workflowSelectSql(whereClause) {
  return `
    SELECT
      pw.*,
      p.project_no,
      p.project_name,
      p.customer_name,
      COALESCE(p.status, 'active') AS project_status,
      NULL::text AS dispatch_status,
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
          AND pw.status = 'active'
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
        status,
        raised_by,
        assigned_to,
        remarks,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'not_started', $8, $9, $10, NOW(), NOW())
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
        reason,
        remarks,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [
      values.workflow_stage_id,
      values.workflow_id,
      values.unlocked_by,
      values.reason,
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
      SELECT override_row.*, unlocker.name AS unlocked_by_name
      FROM workflow_unlock_overrides override_row
      LEFT JOIN users unlocker ON ${userIdentifierMatchSql("unlocker", "override_row.unlocked_by")}
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

module.exports = {
  findActiveProjectWorkflow,
  findPendingSubmissionForStage,
  findRevisionById,
  findSubDepartmentByName,
  findTemplateById,
  findTemplateBySubDepartment,
  findWorkflowById,
  findWorkflowStage,
  hydrateWorkflowDetails,
  insertDocumentHistory,
  insertOverride,
  insertProjectWorkflow,
  insertProjectWorkflowStage,
  insertRevision,
  insertSubmission,
  listControlSubDepartments,
  listPendingApprovalQueue,
  listRevisionQueue,
  listTemplateStages,
  listWorkflowStages,
  updateRevision,
  updateStage,
  updateSubmissionReview,
  updateWorkflowCurrentStage,
  updateWorkflowOwner,
  updateWorkflowStatus,
};
