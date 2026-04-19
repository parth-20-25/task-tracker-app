function parsePermissions(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function mapRoleRow(row, prefix = "") {
  const id = row[`${prefix}role_id`];

  if (!id) {
    return null;
  }

  return {
    id,
    name: row[`${prefix}role_name`],
    hierarchy_level: row[`${prefix}role_hierarchy_level`],
    permissions: parsePermissions(row[`${prefix}role_permissions`]),
    scope: row[`${prefix}role_scope`],
    parent_role: row[`${prefix}role_parent_role`],
  };
}

function mapDepartmentRow(row, prefix = "") {
  const id = row[`${prefix}department_record_id`] ?? row[`${prefix}department_id`];

  if (!id) {
    return null;
  }

  return {
    id,
    name: row[`${prefix}department_name`],
    parent_department: row[`${prefix}department_parent_department`],
  };
}

function mapUserRow(row, prefix = "") {
  const employeeId = row[`${prefix}employee_id`];

  if (!employeeId) {
    return null;
  }

  const role = row[`${prefix}role`] ?? row[`${prefix}role_id`];

  return {
    employee_id: employeeId,
    name: row[`${prefix}name`],
    email: row[`${prefix}email`],
    role_id: role,
    department_id: row[`${prefix}department_id`],
    is_active: row[`${prefix}is_active`],
    created_at: row[`${prefix}created_at`],
    role: mapRoleRow(row, prefix),
    department: mapDepartmentRow(row, prefix),
  };
}

function mapTaskRow(row) {
  return {
    id: row.id,
    internal_identifier: row.internal_identifier,
    description: row.description,
    assigned_to: row.assigned_to,
    assignee_ids: parseJsonArray(row.assignee_ids),
    assigned_by: row.assigned_by,
    department_id: row.department_id,
    status: row.status,
    verification_status: row.verification_status,
    priority: row.priority,
    deadline: row.deadline,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    verified_at: row.verified_at,
    proof_url: row.proof_url,
    proof_type: row.proof_type,
    proof_name: row.proof_name,
    proof_mime: row.proof_mime,
    proof_size: row.proof_size,
    remarks: row.remarks,
    planned_minutes: row.planned_minutes || 0,
    actual_minutes: row.actual_minutes || 0,
    kpi_target: row.kpi_target === null || row.kpi_target === undefined ? null : Number(row.kpi_target),
    kpi_status: row.kpi_status || null,
    machine_id: row.machine_id,
    machine_name: row.machine_name,
    location_tag: row.location_tag,
    recurrence_rule: row.recurrence_rule,
    project_no: row.project_no || null,
    project_name: row.project_name || row.project_description || null,
    customer_name: row.customer_name || null,
    project_description: row.project_description || null,
    scope_name: row.scope_name || null,
    quantity_index: row.quantity_index || null,
    instance_count: row.instance_count === null || row.instance_count === undefined
      ? null
      : Number(row.instance_count),
    rework_date: row.rework_date || null,
    dependency_ids: parseJsonArray(row.dependency_ids),
    escalation_level: row.escalation_level || 0,
    next_escalation_at: row.next_escalation_at,
    last_escalated_at: row.last_escalated_at,
    requires_quality_approval: Boolean(row.requires_quality_approval),
    approval_stage: row.approval_stage,
    closed_at: row.closed_at,
    updated_at: row.updated_at,
    workflow_id: row.workflow_id,
    current_stage_id: row.current_stage_id,
    workflow_stage: row.workflow_stage || null,
    lifecycle_status: row.lifecycle_status || null,
    activity_count: Number(row.activity_count || 0),
    assignee: mapUserRow(row, "assignee_"),
    assigner: mapUserRow(row, "assigner_"),
  };
}

function mapAuditLogRow(row) {
  return {
    id: row.id,
    user_id: row.user_employee_id,
    action_type: row.action_type,
    target_type: row.target_type,
    target_id: row.target_id,
    timestamp: row.timestamp,
    metadata: row.metadata || {},
    user: mapUserRow(row, "user_"),
  };
}

module.exports = {
  mapAuditLogRow,
  mapDepartmentRow,
  mapRoleRow,
  mapTaskRow,
  mapUserRow,
  parseJsonArray,
  parsePermissions,
};
