const { pool } = require("../db");
const { logger } = require("../lib/logger");
const { getExecutionMetadata, instrumentModuleExports, safeSerialize } = require("../lib/observability");
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
      project.id AS resolved_project_id,
      scope.id AS resolved_scope_id,
      fixture.id AS resolved_fixture_id,
      COALESCE(project.project_no, NULLIF(t.project_no, '')) AS resolved_project_no,
      COALESCE(project.project_name, NULLIF(t.project_name, ''), NULLIF(t.project_description, '')) AS resolved_project_name,
      COALESCE(project.customer_name, NULLIF(t.customer_name, '')) AS resolved_customer_name,
      COALESCE(scope.scope_name, NULLIF(t.scope_name, '')) AS resolved_scope_name,
      COALESCE(fixture.fixture_no, NULLIF(t.fixture_no, ''), NULLIF(t.quantity_index, '')) AS resolved_fixture_no,
      t.workflow_id,
      t.current_stage_id,
      t.lifecycle_status,
      COALESCE(stage.stage_name, stage.name) AS workflow_stage,
      workflow_progress.status AS workflow_status,
      (
        SELECT COUNT(*)::int
        FROM task_activity_logs activity
        WHERE activity.task_id = t.id
      ) AS activity_count,
      ${buildUserColumns({ userAlias: "assignee", roleAlias: "assignee_role", departmentAlias: "assignee_department", prefix: "assignee_" })},
      ${buildUserColumns({ userAlias: "assigner", roleAlias: "assigner_role", departmentAlias: "assigner_department", prefix: "assigner_" })}
    FROM tasks t
    LEFT JOIN workflow_stages stage ON stage.id = t.current_stage_id
    LEFT JOIN fixture_workflow_progress workflow_progress
      ON workflow_progress.fixture_id = t.fixture_id
      AND workflow_progress.department_id = t.department_id
      AND workflow_progress.stage_name = COALESCE(stage.stage_name, stage.name)
    LEFT JOIN design.projects project
      ON (
        t.project_id IS NOT NULL
        AND project.id = t.project_id
      ) OR (
        t.project_id IS NULL
        AND project.project_no = NULLIF(t.project_no, '')
        AND project.department_id = t.department_id
      )
    LEFT JOIN design.scopes scope
      ON (
        t.scope_id IS NOT NULL
        AND scope.id = t.scope_id
      ) OR (
        t.scope_id IS NULL
        AND scope.project_id = project.id
        AND scope.scope_name = NULLIF(t.scope_name, '')
      )
    LEFT JOIN design.fixtures fixture
      ON fixture.id = t.fixture_id
      OR (
        t.fixture_id IS NULL
        AND fixture.scope_id = COALESCE(t.scope_id, scope.id)
        AND fixture.fixture_no = COALESCE(NULLIF(t.fixture_no, ''), NULLIF(t.quantity_index, ''))
      )
    LEFT JOIN users assignee ON assignee.employee_id = t.assigned_to
    LEFT JOIN roles assignee_role ON assignee_role.id = assignee.role
    LEFT JOIN departments assignee_department ON assignee_department.id = assignee.department_id
    LEFT JOIN users assigner ON assigner.employee_id = t.assigned_by
    LEFT JOIN roles assigner_role ON assigner_role.id = assigner.role
    LEFT JOIN departments assigner_department ON assigner_department.id = assigner.department_id
    ${whereClause}
  `;
}

function requireRow(result, errorMessage) {
  const row = result?.rows?.[0];

  if (!row) {
    throw new Error(errorMessage);
  }

  return row;
}

function hasOwn(values, key) {
  return Object.prototype.hasOwnProperty.call(values || {}, key);
}

async function executeRepositoryQuery(operation, client, queryText, params = []) {
  const metadata = getExecutionMetadata({
    layer: "repository.tasksRepository",
    operation,
    query: queryText.trim(),
    params: safeSerialize(params),
  });

  logger.info("tasksRepository query start", metadata);

  try {
    const result = await client.query(queryText, params);
    logger.info("tasksRepository query success", {
      ...metadata,
      rowCount: result?.rowCount ?? result?.rows?.length ?? 0,
    });
    return result;
  } catch (error) {
    logger.error("tasksRepository query failed", {
      ...metadata,
      errorMessage: error?.message || "Unknown database error",
      errorDetail: error?.detail || null,
      errorCode: error?.code || null,
      constraint: error?.constraint || null,
      stack: error?.stack || null,
    });
    throw error;
  }
}

async function listTasksByAccess({ clause = "", params = [] }, client = pool) {
  const result = await client.query(
    `${taskSelectQuery(clause)} ORDER BY t.created_at DESC, t.id DESC`,
    params,
  );

  return result.rows.map((row) => mapTaskRow(row));
}

async function listVerificationTasksByAccess({ clause = "", params = [] }, currentUserEmployeeId, client = pool) {
  const nextParams = [...params, currentUserEmployeeId];
  const verificationClause = clause
    ? `${clause} AND t.status = 'under_review' AND t.assigned_to <> $${nextParams.length}`
    : `WHERE t.status = 'under_review' AND t.assigned_to <> $${nextParams.length}`;

  const result = await client.query(
    `${taskSelectQuery(verificationClause)} ORDER BY t.created_at DESC, t.id DESC`,
    nextParams,
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

  const insertQuery = `
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
        project_id,
        scope_id,
        fixture_id,
        fixture_no,
        project_no,
        project_name,
        customer_name,
        project_description,
        scope_name,
        quantity_index,
        instance_count,
        rework_date,
        assigned_user_id,
        due_date,
        sla_due_date,
        rejection_count,
        stage,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NOW(), NOW(), $10,
        $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, NOW()
      )
      RETURNING id
    `;
  const insertParams = [
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
    task.project_id || null,
    task.scope_id || null,
    task.fixture_id || null,
    task.fixture_no || null,
    task.project_no || null,
    task.project_name || null,
    task.customer_name || null,
    task.project_description || null,
    task.scope_name || null,
    task.quantity_index || null,
    task.instance_count ?? null,
    task.rework_date || null,
    task.assigned_user_id || task.assigned_to,
    task.due_date || task.deadline || null,
    task.sla_due_date || task.due_date || task.deadline || null,
    task.rejection_count || 0,
    task.stage || null
  ];

  const result = await executeRepositoryQuery("insertTask", client, insertQuery, insertParams);

  return requireRow(result, "Task insert did not return an id").id;
}

async function updateTaskStatus(taskId, incomingValues, client = pool) {
  const hasSubmittedAt = hasOwn(incomingValues, "submitted_at");
  const hasApprovedAt = hasOwn(incomingValues, "approved_at");
  const values = {
    status: incomingValues.status,
    started_at: incomingValues.started_at ?? null,
    completed_at: incomingValues.completed_at ?? null,
    verification_status: incomingValues.verification_status ?? null,
    actual_minutes: incomingValues.actual_minutes ?? null,
    approval_stage: incomingValues.approval_stage ?? null,
    closed_at: incomingValues.closed_at ?? null,
    current_stage_id: incomingValues.current_stage_id ?? null,
    lifecycle_status: incomingValues.lifecycle_status ?? null,
    submitted_at: incomingValues.submitted_at ?? null,
    approved_at: incomingValues.approved_at ?? null,
  };

  await client.query(
    `
      UPDATE tasks
      SET status = $1::text,
          started_at = $2::timestamp,
          completed_at = $3::timestamp,
          verification_status = $4::text,
          actual_minutes = $5::int,
          approval_stage = $6::text,
          closed_at = $7::timestamp,
          current_stage_id = COALESCE($8::text, current_stage_id),
          lifecycle_status = CASE
            WHEN $9::text IS NOT NULL THEN $9::text
            WHEN $1::text IN ('closed', 'completed') THEN 'completed'
            WHEN $1::text = 'cancelled' THEN 'cancelled'
            WHEN $1::text = 'rework' THEN 'rework'
            WHEN $1::text IN ('in_progress', 'on_hold', 'under_review') THEN 'in_progress'
            WHEN $1::text = 'assigned' THEN 'assigned'
            ELSE lifecycle_status
          END,
          assigned_user_id = COALESCE(assigned_user_id, assigned_to),
          due_date = COALESCE(due_date, deadline),
          sla_due_date = COALESCE(sla_due_date, due_date, deadline),
          submitted_at = CASE WHEN $10::boolean THEN $11::timestamp ELSE submitted_at END,
          approved_at = CASE WHEN $12::boolean THEN $13::timestamp ELSE approved_at END,
          updated_at = NOW()
      WHERE id = $14::int
    `,
    [
      values.status,
      values.started_at,
      values.completed_at,
      values.verification_status,
      values.actual_minutes,
      values.approval_stage,
      values.closed_at,
      values.current_stage_id ?? null,
      values.lifecycle_status || null,
      hasSubmittedAt,
      values.submitted_at ?? null,
      hasApprovedAt,
      values.approved_at ?? null,
      taskId,
    ],
  );
}

async function updateTaskVerification(taskId, values, client = pool) {
  const hasActualMinutes = Object.prototype.hasOwnProperty.call(values, "actual_minutes");
  const hasKpiTarget = Object.prototype.hasOwnProperty.call(values, "kpi_target");
  const hasKpiStatus = Object.prototype.hasOwnProperty.call(values, "kpi_status");
  const hasApprovedAt = Object.prototype.hasOwnProperty.call(values, "approved_at");
  const hasSubmittedAt = Object.prototype.hasOwnProperty.call(values, "submitted_at");
  const hasVerifiedAt = Object.prototype.hasOwnProperty.call(values, "verified_at");
  const hasClosedAt = Object.prototype.hasOwnProperty.call(values, "closed_at");
  const rejectionCountIncrement = Number(values.rejection_count_increment || 0);

  await client.query(
    `
      UPDATE tasks
      SET verification_status = $1::text,
          remarks = $2::text,
          verified_at = CASE WHEN $3::boolean THEN $4::timestamp ELSE verified_at END,
          status = $5::text,
          approval_stage = $6::text,
          closed_at = CASE WHEN $7::boolean THEN $8::timestamp ELSE closed_at END,
          actual_minutes = CASE WHEN $9::boolean THEN $10::int ELSE actual_minutes END,
          kpi_target = CASE WHEN $11::boolean THEN $12 ELSE kpi_target END,
          kpi_status = CASE WHEN $13::boolean THEN $14::text ELSE kpi_status END,
          current_stage_id = COALESCE($15::text, current_stage_id),
          lifecycle_status = CASE
            WHEN $16::text IS NOT NULL THEN $16::text
            WHEN $5::text IN ('closed', 'completed') THEN 'completed'
            WHEN $5::text = 'cancelled' THEN 'cancelled'
            WHEN $5::text = 'rework' THEN 'rework'
            WHEN $5::text IN ('in_progress', 'on_hold', 'under_review') THEN 'in_progress'
            WHEN $5::text = 'assigned' THEN 'assigned'
            ELSE lifecycle_status
          END,
          assigned_user_id = COALESCE(assigned_user_id, assigned_to),
          due_date = COALESCE(due_date, deadline),
          sla_due_date = COALESCE(sla_due_date, due_date, deadline),
          approved_at = CASE WHEN $17::boolean THEN $18::timestamp ELSE approved_at END,
          submitted_at = CASE WHEN $19::boolean THEN $20::timestamp ELSE submitted_at END,
          rejection_count = COALESCE(rejection_count, 0) + $21::int,
          updated_at = NOW()
      WHERE id = $22::int
    `,
    [
      values.verification_status ?? null,
      values.remarks ?? null,
      hasVerifiedAt,
      values.verified_at ?? null,
      values.status ?? null,
      values.approval_stage ?? null,
      hasClosedAt,
      values.closed_at ?? null,
      hasActualMinutes,
      values.actual_minutes ?? null,
      hasKpiTarget,
      values.kpi_target ?? null,
      hasKpiStatus,
      values.kpi_status ?? null,
      values.current_stage_id ?? null,
      values.lifecycle_status || null,
      hasApprovedAt,
      values.approved_at ?? null,
      hasSubmittedAt,
      values.submitted_at ?? null,
      rejectionCountIncrement,
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
  const normalizedProofUrl = typeof values.proof_url === "string" ? values.proof_url.trim() : "";
  const shouldAppendProofUrl = hasProofUrl && Boolean(normalizedProofUrl);

  if (shouldAppendProofUrl) {
    await client.query(`
      UPDATE tasks
      SET proof_url = COALESCE(proof_url, '{}') || $1
      WHERE id = $2
    `, [[normalizedProofUrl], taskId]);
  }

  if (!hasProofType && !hasProofName && !hasProofMime && !hasProofSize && !shouldAppendProofUrl) {
    return;
  }

  await client.query(
    `
      UPDATE tasks
      SET proof_type = CASE WHEN $1::boolean THEN $2::text ELSE proof_type END,
          proof_name = CASE WHEN $3::boolean THEN $4::text ELSE proof_name END,
          proof_mime = CASE WHEN $5::boolean THEN $6::text ELSE proof_mime END,
          proof_size = CASE WHEN $7::boolean THEN $8::int ELSE proof_size END,
          updated_at = NOW()
      WHERE id = $9::int
    `,
    [
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
  const hasDescription = hasOwn(values, "description");
  const hasPriority = hasOwn(values, "priority");
  const hasDeadline = hasOwn(values, "deadline");
  const hasPlannedMinutes = hasOwn(values, "planned_minutes");
  const hasMachineId = hasOwn(values, "machine_id");
  const hasMachineName = hasOwn(values, "machine_name");
  const hasLocationTag = hasOwn(values, "location_tag");
  const hasRecurrenceRule = hasOwn(values, "recurrence_rule");
  const hasDependencyIds = hasOwn(values, "dependency_ids");
  const hasRequiresQualityApproval = hasOwn(values, "requires_quality_approval");
  const hasAssignedTo = hasOwn(values, "assigned_to");
  const hasAssigneeIds = hasOwn(values, "assignee_ids");
  const hasAssignedUserId = hasOwn(values, "assigned_user_id");

  await client.query(
    `
      UPDATE tasks
      SET description = CASE WHEN $1::boolean THEN $2::text ELSE description END,
          priority = CASE WHEN $3::boolean THEN $4::text ELSE priority END,
          deadline = CASE WHEN $5::boolean THEN $6::timestamp ELSE deadline END,
          due_date = CASE WHEN $5::boolean THEN COALESCE($6::timestamp, due_date, deadline) ELSE due_date END,
          sla_due_date = CASE WHEN $5::boolean THEN COALESCE($6::timestamp, sla_due_date, due_date, deadline) ELSE sla_due_date END,
          planned_minutes = CASE WHEN $7::boolean THEN $8::int ELSE planned_minutes END,
          machine_id = CASE WHEN $9::boolean THEN $10::text ELSE machine_id END,
          machine_name = CASE WHEN $11::boolean THEN $12::text ELSE machine_name END,
          location_tag = CASE WHEN $13::boolean THEN $14::text ELSE location_tag END,
          recurrence_rule = CASE WHEN $15::boolean THEN $16::text ELSE recurrence_rule END,
          dependency_ids = CASE WHEN $17::boolean THEN $18::jsonb ELSE dependency_ids END,
          requires_quality_approval = CASE WHEN $19::boolean THEN $20::boolean ELSE requires_quality_approval END,
          assigned_to = CASE WHEN $21::boolean THEN $22::text ELSE assigned_to END,
          assignee_ids = CASE WHEN $23::boolean THEN $24::jsonb ELSE assignee_ids END,
          assigned_user_id = CASE WHEN $25::boolean THEN $26::text ELSE assigned_user_id END,
          assigned_at = CASE WHEN $21::boolean OR $23::boolean THEN NOW() ELSE assigned_at END,
          next_escalation_at = CASE WHEN $27::boolean THEN $28::timestamp ELSE next_escalation_at END,
          last_escalated_at = CASE WHEN $29::boolean THEN $30::timestamp ELSE last_escalated_at END,
          updated_at = NOW()
      WHERE id = $31::int
    `,
    [
      hasDescription,
      values.description ?? null,
      hasPriority,
      values.priority ?? null,
      hasDeadline,
      values.deadline ?? null,
      hasPlannedMinutes,
      values.planned_minutes ?? null,
      hasMachineId,
      values.machine_id ?? null,
      hasMachineName,
      values.machine_name ?? null,
      hasLocationTag,
      values.location_tag ?? null,
      hasRecurrenceRule,
      values.recurrence_rule ?? null,
      hasDependencyIds,
      hasDependencyIds ? JSON.stringify(values.dependency_ids ?? []) : null,
      hasRequiresQualityApproval,
      values.requires_quality_approval ?? null,
      hasAssignedTo,
      values.assigned_to ?? null,
      hasAssigneeIds,
      hasAssigneeIds ? JSON.stringify(values.assignee_ids ?? []) : null,
      hasAssignedUserId,
      values.assigned_user_id ?? null,
      Boolean(values.has_next_escalation_at),
      values.next_escalation_at ?? null,
      Boolean(values.has_last_escalated_at),
      values.last_escalated_at ?? null,
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

module.exports = instrumentModuleExports("repository.tasksRepository", {
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
  listVerificationTasksByAccess,
  updateTaskChecklist,
  updateTaskDetails,
  updateTaskProof,
  updateTaskStatus,
  updateTaskVerification,
});
