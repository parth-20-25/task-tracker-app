const { pool } = require("../db");
const { mapTaskRow } = require("./mappers");
const { buildUserColumns } = require("./sqlFragments");

const OPEN_TASK_STATUSES = ["assigned", "in_progress", "on_hold", "under_review", "rework"];

function mapTaskAttachmentRow(row, { includeFilePath = false } = {}) {
  if (!row) {
    return null;
  }

  const attachment = {
    id: row.id,
    task_id: row.task_id,
    file_url: row.file_url,
    file_name: row.file_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name,
    uploaded_at: row.uploaded_at,
  };

  if (includeFilePath) {
    attachment.file_path = row.file_path || null;
  }

  return attachment;
}

function taskSelectQuery(whereClause = "") {
  return `
    SELECT
      t.*,
      t.workflow_id,
      t.current_stage_id,
      t.lifecycle_status,
      stage.name AS workflow_stage,
      (
        SELECT COUNT(*)::int
        FROM task_activity_logs activity
        WHERE activity.task_id = t.id
      ) AS activity_count,
      ${buildUserColumns({ userAlias: "assignee", roleAlias: "assignee_role", departmentAlias: "assignee_department", prefix: "assignee_" })},
      ${buildUserColumns({ userAlias: "assigner", roleAlias: "assigner_role", departmentAlias: "assigner_department", prefix: "assigner_" })}
    FROM tasks t
    LEFT JOIN workflow_stages stage ON stage.id = t.current_stage_id
    LEFT JOIN users assignee ON assignee.employee_id = t.assigned_to
    LEFT JOIN roles assignee_role ON assignee_role.id = assignee.role
    LEFT JOIN departments assignee_department ON assignee_department.id = assignee.department_id
    LEFT JOIN users assigner ON assigner.employee_id = t.assigned_by
    LEFT JOIN roles assigner_role ON assigner_role.id = assigner.role
    LEFT JOIN departments assigner_department ON assigner_department.id = assigner.department_id
    ${whereClause}
  `;
}

async function listTasksByAccess({ clause = "", params = [] }, client = pool) {
  const result = await client.query(
    `${taskSelectQuery(clause)} ORDER BY t.created_at DESC, t.id DESC`,
    params,
  );

  return result.rows.map((row) => mapTaskRow(row));
}

async function findTaskById(taskId, client = pool) {
  const result = await client.query(
    `${taskSelectQuery("WHERE t.id = $1")} LIMIT 1`,
    [taskId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapTaskRow(result.rows[0]);
}

async function listTasksForWorkflowInstance({
  departmentId,
  projectNo,
  scopeName,
  instanceCode,
  instanceIndex,
}, client = pool) {
  if (!departmentId || !projectNo || !scopeName || !instanceCode) {
    return [];
  }

  const parsedInstanceIndex = Number(instanceIndex);
  if (!Number.isInteger(parsedInstanceIndex)) {
    return [];
  }

  const result = await client.query(
    `
      ${taskSelectQuery(`
        WHERE t.department_id = $1
          AND t.project_no = $2
          AND t.scope_name = $3
          AND t.quantity_index = $4
          AND t.instance_count = $5
          AND t.status <> 'cancelled'
      `)}
      ORDER BY t.created_at ASC, t.id ASC
    `,
    [departmentId, projectNo, scopeName, instanceCode, parsedInstanceIndex],
  );

  return result.rows.map((row) => mapTaskRow(row));
}

async function insertTask(task, client = pool) {
  if (!task.workflow_id || !task.current_stage_id) {
    throw new Error("System configuration error: Tasks must be bound to a workflow and an active stage.");
  }

  const result = await client.query(
    `
      INSERT INTO tasks (
        internal_identifier,
        description,
        assigned_to,
        assignee_ids,
        assigned_by,
        department_id,
        status,
        priority,
        deadline,
        created_at,
        assigned_at,
        verification_status,
        planned_minutes,
        machine_id,
        machine_name,
        location_tag,
        recurrence_rule,
        dependency_ids,
        requires_quality_approval,
        next_escalation_at,
        last_escalated_at,
        approval_stage,
        workflow_id,
        current_stage_id,
        lifecycle_status,
        project_no,
        project_name,
        customer_name,
        project_description,
        scope_name,
        quantity_index,
        instance_count,
        rework_date,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NOW(), NOW(), $10,
        $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, NOW()
      )
      RETURNING id
    `,
    [
      task.internal_identifier,
      task.description,
      task.assigned_to,
      JSON.stringify(task.assignee_ids || [task.assigned_to]),
      task.assigned_by,
      task.department_id,
      task.status,
      task.priority,
      task.deadline,
      task.verification_status,
      task.planned_minutes,
      task.machine_id,
      task.machine_name,
      task.location_tag,
      task.recurrence_rule,
      JSON.stringify(task.dependency_ids || []),
      task.requires_quality_approval,
      task.next_escalation_at || null,
      task.last_escalated_at || null,
      task.approval_stage,
      task.workflow_id,
      task.current_stage_id,
      task.lifecycle_status || deriveLifecycleStatus(task.status),
      task.project_no || null,
      task.project_name || null,
      task.customer_name || null,
      task.project_description || null,
      task.scope_name || null,
      task.quantity_index || null,
      task.instance_count ?? null,
      task.rework_date || null,
    ],
  );

  return result.rows[0].id;
}

async function updateTaskStatus(taskId, values, client = pool) {
  await client.query(
    `
      UPDATE tasks
      SET status = $1,
          started_at = $2,
          completed_at = $3,
          verification_status = $4,
          actual_minutes = $5,
          approval_stage = $6,
          closed_at = $7,
          current_stage_id = COALESCE($8, current_stage_id),
          lifecycle_status = COALESCE(
            $9,
            CASE
              WHEN $1 = 'closed' THEN 'completed'
              WHEN $1 = 'cancelled' THEN 'cancelled'
              WHEN $1 = 'rework' THEN 'rework'
              WHEN $1 IN ('in_progress', 'on_hold', 'under_review') THEN 'in_progress'
              WHEN $1 = 'assigned' THEN 'assigned'
              ELSE lifecycle_status
            END
          ),
          updated_at = NOW()
      WHERE id = $10
    `,
    [
      values.status,
      values.started_at,
      values.completed_at,
      values.verification_status,
      values.actual_minutes,
      values.approval_stage,
      values.closed_at,
      values.current_stage_id || null,
      values.lifecycle_status || null,
      taskId,
    ],
  );
}

async function updateTaskVerification(taskId, values, client = pool) {
  const hasActualMinutes = Object.prototype.hasOwnProperty.call(values, "actual_minutes");
  const hasKpiTarget = Object.prototype.hasOwnProperty.call(values, "kpi_target");
  const hasKpiStatus = Object.prototype.hasOwnProperty.call(values, "kpi_status");

  await client.query(
    `
      UPDATE tasks
      SET verification_status = $1,
          remarks = $2,
          verified_at = $3,
          status = $4,
          approval_stage = $5,
          closed_at = $6,
          actual_minutes = CASE WHEN $7 THEN $8 ELSE actual_minutes END,
          kpi_target = CASE WHEN $9 THEN $10 ELSE kpi_target END,
          kpi_status = CASE WHEN $11 THEN $12 ELSE kpi_status END,
          current_stage_id = COALESCE($13, current_stage_id),
          lifecycle_status = COALESCE(
            $14,
            CASE
              WHEN $4 = 'closed' THEN 'completed'
              WHEN $4 = 'cancelled' THEN 'cancelled'
              WHEN $4 = 'rework' THEN 'rework'
              WHEN $4 IN ('in_progress', 'on_hold', 'under_review') THEN 'in_progress'
              WHEN $4 = 'assigned' THEN 'assigned'
              ELSE lifecycle_status
            END
          ),
          updated_at = NOW()
      WHERE id = $15
    `,
    [
      values.verification_status,
      values.remarks,
      values.verified_at,
      values.status,
      values.approval_stage,
      values.closed_at,
      hasActualMinutes,
      values.actual_minutes,
      hasKpiTarget,
      values.kpi_target,
      hasKpiStatus,
      values.kpi_status,
      values.current_stage_id || null,
      values.lifecycle_status || null,
      taskId,
    ],
  );
}

async function updateTaskProof(taskId, values, client = pool) {
  const hasProofUrl = Object.prototype.hasOwnProperty.call(values, "proof_url");
  const hasProofType = Object.prototype.hasOwnProperty.call(values, "proof_type");
  const hasProofName = Object.prototype.hasOwnProperty.call(values, "proof_name");
  const hasProofMime = Object.prototype.hasOwnProperty.call(values, "proof_mime");
  const hasProofSize = Object.prototype.hasOwnProperty.call(values, "proof_size");

  await client.query(
    `
      UPDATE tasks
      SET proof_url = CASE WHEN $1 THEN $2 ELSE proof_url END,
          proof_type = CASE WHEN $3 THEN $4 ELSE proof_type END,
          proof_name = CASE WHEN $5 THEN $6 ELSE proof_name END,
          proof_mime = CASE WHEN $7 THEN $8 ELSE proof_mime END,
          proof_size = CASE WHEN $9 THEN $10 ELSE proof_size END,
          updated_at = NOW()
      WHERE id = $11
    `,
    [
      hasProofUrl,
      values.proof_url ?? null,
      hasProofType,
      values.proof_type ?? null,
      hasProofName,
      values.proof_name ?? null,
      hasProofMime,
      values.proof_mime ?? null,
      hasProofSize,
      values.proof_size ?? null,
      taskId,
    ],
  );
}

async function updateTaskDetails(taskId, values, client = pool) {
  await client.query(
    `
      UPDATE tasks
      SET description = COALESCE($1, description),
          priority = COALESCE($2, priority),
          deadline = COALESCE($3, deadline),
          planned_minutes = COALESCE($4, planned_minutes),
          machine_id = COALESCE($5, machine_id),
          machine_name = COALESCE($6, machine_name),
          location_tag = COALESCE($7, location_tag),
          recurrence_rule = COALESCE($8, recurrence_rule),
          dependency_ids = COALESCE($9::jsonb, dependency_ids),
          requires_quality_approval = COALESCE($10, requires_quality_approval),
          next_escalation_at = CASE WHEN $11 THEN $12 ELSE next_escalation_at END,
          last_escalated_at = CASE WHEN $13 THEN $14 ELSE last_escalated_at END,
          updated_at = NOW()
      WHERE id = $15
    `,
    [
      values.description,
      values.priority,
      values.deadline,
      values.planned_minutes,
      values.machine_id,
      values.machine_name,
      values.location_tag,
      values.recurrence_rule,
      values.dependency_ids ? JSON.stringify(values.dependency_ids) : null,
      values.requires_quality_approval,
      Boolean(values.has_next_escalation_at),
      values.next_escalation_at,
      Boolean(values.has_last_escalated_at),
      values.last_escalated_at,
      taskId,
    ],
  );
}

async function cancelTask(taskId, { cancelledBy, reason }, client = pool) {
  const result = await client.query(
    `
      UPDATE tasks
      SET status = 'cancelled',
          verification_status = 'rejected',
          approval_stage = 'cancelled',
          remarks = COALESCE($2, remarks),
          next_escalation_at = NULL,
          current_stage_id = NULL,
          lifecycle_status = 'cancelled',
          updated_at = NOW()
      WHERE id = $1
        AND status <> 'cancelled'
      RETURNING id
    `,
    [taskId, reason || null],
  );

  if (result.rowCount === 0) {
    return null;
  }

  await appendTaskActivity(taskId, {
    userEmployeeId: cancelledBy,
    actionType: "task_cancelled",
    notes: reason || null,
    metadata: { status: "cancelled" },
  }, client);

  return result.rows[0].id;
}

function deriveLifecycleStatus(status) {
  switch (status) {
    case "closed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "rework":
      return "rework";
    case "in_progress":
    case "on_hold":
    case "under_review":
      return "in_progress";
    default:
      return "assigned";
  }
}

async function listTasksDueForEscalation(limit = 100, client = pool) {
  const result = await client.query(
    `
      ${taskSelectQuery(`
        WHERE t.status = ANY($2::text[])
          AND t.next_escalation_at IS NOT NULL
          AND t.next_escalation_at <= NOW()
      `)}
      ORDER BY t.next_escalation_at ASC, t.id ASC
      LIMIT $1
      FOR UPDATE OF t SKIP LOCKED
    `,
    [limit, OPEN_TASK_STATUSES],
  );

  return result.rows.map((row) => mapTaskRow(row));
}

async function advanceTaskEscalation(taskId, values, client = pool) {
  await client.query(
    `
      UPDATE tasks
      SET escalation_level = $1,
          last_escalated_at = $2,
          next_escalation_at = $3,
          updated_at = NOW()
      WHERE id = $4
    `,
    [values.escalation_level, values.last_escalated_at, values.next_escalation_at, taskId],
  );
}

async function appendTaskActivity(taskId, { userEmployeeId, actionType, notes, metadata = {} }, client = pool) {
  await client.query(
    `
      INSERT INTO task_activity_logs (task_id, user_employee_id, action_type, notes, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [taskId, userEmployeeId, actionType, notes || null, JSON.stringify(metadata)],
  );
}

async function listTaskActivity(taskId, client = pool) {
  const result = await client.query(
    `
      SELECT tal.*, u.name AS user_name
      FROM task_activity_logs tal
      LEFT JOIN users u ON u.employee_id = tal.user_employee_id
      WHERE tal.task_id = $1
      ORDER BY tal.created_at DESC, tal.id DESC
    `,
    [taskId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    user_employee_id: row.user_employee_id,
    user_name: row.user_name,
    action_type: row.action_type,
    notes: row.notes,
    metadata: row.metadata || {},
    created_at: row.created_at,
  }));
}

async function listTaskLogs(taskId, client = pool) {
  const result = await client.query(
    `
      SELECT
        tl.id,
        tl.task_id,
        COALESCE(tl.step_name, tl.action, 'execution_update') AS step_name,
        COALESCE(tl.status, 'recorded') AS status,
        tl.notes,
        COALESCE(tl.updated_by, tl.user_employee_id) AS updated_by,
        u.name AS updated_by_name,
        tl.timestamp
      FROM task_logs tl
      LEFT JOIN users u ON u.employee_id = COALESCE(tl.updated_by, tl.user_employee_id)
      WHERE tl.task_id = $1
      ORDER BY tl.timestamp DESC, tl.id DESC
    `,
    [taskId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    step_name: row.step_name,
    status: row.status,
    notes: row.notes,
    updated_by: row.updated_by,
    updated_by_name: row.updated_by_name,
    action: row.step_name,
    user_employee_id: row.updated_by,
    user_name: row.updated_by_name,
    timestamp: row.timestamp,
  }));
}

async function addTaskLog(taskId, { updatedBy, stepName, status, notes }, client = pool) {
  await client.query(
    `
      INSERT INTO task_logs (task_id, step_name, status, updated_by, user_employee_id, action, notes)
      VALUES ($1, $2, $3, $4, $4, $2, $5)
    `,
    [taskId, stepName, status, updatedBy || null, notes || null],
  );
}

async function listTaskChecklists(taskId, client = pool) {
  const result = await client.query(
    `
      SELECT tc.*, u.name AS completed_by_name
      FROM task_checklists tc
      LEFT JOIN users u ON u.employee_id = tc.completed_by
      WHERE tc.task_id = $1
      ORDER BY tc.created_at ASC
    `,
    [taskId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    item: row.item,
    is_completed: row.is_completed,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    completed_by_name: row.completed_by_name,
    created_at: row.created_at,
  }));
}

async function addTaskChecklist(taskId, checklistItem, client = pool) {
  const result = await client.query(
    `
      INSERT INTO task_checklists (task_id, item, is_completed, completed_at, completed_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [
      taskId,
      checklistItem.item,
      checklistItem.is_completed === true,
      checklistItem.completed_at || null,
      checklistItem.completed_by || null,
    ],
  );

  return result.rows[0]?.id || null;
}

async function updateTaskChecklist(taskId, checklistId, checklistItem, client = pool) {
  const hasItem = Object.prototype.hasOwnProperty.call(checklistItem, "item");
  const hasCompletionState = Object.prototype.hasOwnProperty.call(checklistItem, "is_completed");
  const result = await client.query(
    `
      UPDATE task_checklists
      SET item = CASE WHEN $1 THEN $2 ELSE item END,
          is_completed = CASE WHEN $3 THEN $4 ELSE is_completed END,
          completed_at = CASE
            WHEN $3 AND $4 THEN $5
            WHEN $3 AND NOT $4 THEN NULL
            ELSE completed_at
          END,
          completed_by = CASE
            WHEN $3 AND $4 THEN $6
            WHEN $3 AND NOT $4 THEN NULL
            ELSE completed_by
          END
      WHERE task_id = $7 AND id = $8
      RETURNING id
    `,
    [
      hasItem,
      checklistItem.item || "",
      hasCompletionState,
      checklistItem.is_completed === true,
      checklistItem.completed_at || null,
      checklistItem.completed_by || null,
      taskId,
      checklistId,
    ],
  );

  return result.rows[0]?.id || null;
}

async function deleteTaskChecklist(taskId, checklistId, client = pool) {
  const result = await client.query(`DELETE FROM task_checklists WHERE task_id = $1 AND id = $2 RETURNING id`, [taskId, checklistId]);
  return result.rows[0]?.id || null;
}

async function listTaskAttachments(taskId, client = pool) {
  const result = await client.query(
    `
      SELECT ta.*, u.name AS uploaded_by_name
      FROM task_attachments ta
      LEFT JOIN users u ON u.employee_id = ta.uploaded_by
      WHERE ta.task_id = $1
      ORDER BY ta.uploaded_at DESC
    `,
    [taskId],
  );

  return result.rows.map((row) => mapTaskAttachmentRow(row));
}

async function findLatestTaskAttachment(taskId, client = pool) {
  const result = await client.query(
    `
      SELECT ta.*, u.name AS uploaded_by_name
      FROM task_attachments ta
      LEFT JOIN users u ON u.employee_id = ta.uploaded_by
      WHERE ta.task_id = $1
      ORDER BY ta.uploaded_at DESC, ta.id DESC
      LIMIT 1
    `,
    [taskId],
  );

  return mapTaskAttachmentRow(result.rows[0]);
}

async function addTaskAttachment(taskId, attachment, client = pool) {
  const result = await client.query(
    `
      INSERT INTO task_attachments (task_id, file_url, file_path, file_name, mime_type, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, task_id, file_url, file_path, file_name, mime_type, file_size, uploaded_by, uploaded_at
    `,
    [
      taskId,
      attachment.file_url,
      attachment.file_path || null,
      attachment.file_name,
      attachment.mime_type,
      attachment.file_size,
      attachment.uploaded_by,
    ],
  );

  return mapTaskAttachmentRow(result.rows[0]);
}

async function deleteTaskAttachment(taskId, attachmentId, client = pool) {
  const result = await client.query(
    `
      DELETE FROM task_attachments
      WHERE task_id = $1 AND id = $2
      RETURNING id, task_id, file_url, file_path, file_name, mime_type, file_size, uploaded_by, uploaded_at
    `,
    [taskId, attachmentId],
  );

  return mapTaskAttachmentRow(result.rows[0], { includeFilePath: true });
}

module.exports = {
  addTaskAttachment,
  addTaskLog,
  advanceTaskEscalation,
  appendTaskActivity,
  cancelTask,
  deleteTaskAttachment,
  deleteTaskChecklist,
  findTaskById,
  findLatestTaskAttachment,
  insertTask,
  addTaskChecklist,
  listTaskActivity,
  listTaskAttachments,
  listTaskChecklists,
  listTaskLogs,
  listTasksByAccess,
  listTasksDueForEscalation,
  listTasksForWorkflowInstance,
  updateTaskChecklist,
  updateTaskDetails,
  updateTaskProof,
  updateTaskStatus,
  updateTaskVerification,
};
