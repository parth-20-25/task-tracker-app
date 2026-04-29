const bcrypt = require("bcrypt");
const { AppError } = require("../lib/AppError");
const { createAuditLog } = require("../repositories/auditRepository");
const { USER_SCOPES } = require("../config/constants");
const { listAuditLogs } = require("../repositories/auditRepository");
const {
  deleteDepartment: deleteDepartmentRecord,
  listAllDepartments,
  upsertDepartment,
} = require("../repositories/departmentsRepository");
const {
  deleteRole: deleteRoleRecord,
  listRoles,
  upsertRole,
} = require("../repositories/rolesRepository");
const {
  listEscalationRules,
  listKpiDefinitions,
  upsertEscalationRule,
  upsertKpiDefinition,
  deleteEscalationRule: deleteEscalationRuleRecord,
} = require("../repositories/referenceRepository");
const { syncTaskEscalationSchedule } = require("../repositories/bootstrapRepository");
const {
  createUser,
  deleteUser: deleteUserRecord,
  findUserByIdOrEmployeeId,
  findUserByEmployeeId,
  listUsers,
  setUserActiveStatus,
  updateUser,
} = require("../repositories/usersRepository");
const { filterUsersForScope } = require("./accessControlService");
const {
  deleteShift: deleteShiftRecord,
  listShifts,
  upsertShift,
} = require("../repositories/shiftsRepository");
const {
  deleteMachine: deleteMachineRecord,
  listMachines,
  upsertMachine,
} = require("../repositories/machinesRepository");
const {
  deleteWorkflowTemplate: deleteWorkflowTemplateRecord,
  upsertWorkflowTemplate,
} = require("../repositories/workflowTemplatesRepository");
const { pool } = require("../db");

async function listUsersForScope(user, scope = USER_SCOPES.ACCESSIBLE) {
  const users = await listUsers();
  return filterUsersForScope(user, users, scope);
}

async function getAdminReferenceData() {
  const [roles, departments, auditLogs, kpiDefinitions, escalationRules] = await Promise.all([
    listRoles(),
    listAllDepartments(),
    listAuditLogs(),
    listKpiDefinitions(),
    listEscalationRules(),
  ]);

  return {
    roles,
    departments,
    auditLogs,
    kpiDefinitions,
    escalationRules,
  };
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");

  if (missing.length > 0) {
    throw new AppError(400, `Missing required fields: ${missing.join(", ")}`);
  }
}

async function resolveParentId(parentIdentifier, { currentEmployeeId, currentUserId } = {}) {
  if (parentIdentifier === undefined) {
    return undefined;
  }

  if (parentIdentifier === null) {
    return null;
  }

  const normalizedParentIdentifier = String(parentIdentifier).trim();

  if (!normalizedParentIdentifier) {
    return null;
  }

  const parentUser = await findUserByIdOrEmployeeId(normalizedParentIdentifier);

  if (!parentUser) {
    throw new AppError(400, "Parent user not found");
  }

  if (
    parentUser.employee_id === currentEmployeeId
    || (currentUserId && parentUser.id === currentUserId)
  ) {
    throw new AppError(400, "User cannot be their own parent");
  }

  return parentUser.id;
}

async function saveUser(actor, payload) {
  const hasParentId = Object.prototype.hasOwnProperty.call(payload || {}, "parent_id");
  const normalizedPayload = {
    employee_id: payload.employee_id?.trim(),
    name: payload.name?.trim(),
    role: (payload.role ?? payload.role_id)?.trim(),
    parent_id: hasParentId ? (payload.parent_id?.trim() || null) : undefined,
    department_id: payload.department_id?.trim() || null,
    password: payload.password?.trim(),
    is_active: payload.is_active !== false,
  };

  requireFields(normalizedPayload, ["employee_id", "name", "role"]);
  const existing = await findUserByEmployeeId(normalizedPayload.employee_id);
  const resolvedParentId = hasParentId
    ? await resolveParentId(normalizedPayload.parent_id, {
      currentEmployeeId: normalizedPayload.employee_id,
      currentUserId: existing?.id || null,
    })
    : undefined;

  let user;

  if (!existing) {
    requireFields(normalizedPayload, ["password"]);

    user = await createUser({
      employee_id: normalizedPayload.employee_id,
      name: normalizedPayload.name,
      role: normalizedPayload.role,
      parent_id: resolvedParentId ?? null,
      department_id: normalizedPayload.department_id,
      password_hash: await bcrypt.hash(normalizedPayload.password, 10),
      is_active: normalizedPayload.is_active,
    });
  } else {
    if (normalizedPayload.password) {
      throw new AppError(409, "Employee ID already exists");
    }

    user = await updateUser(normalizedPayload.employee_id, {
      name: normalizedPayload.name,
      role: normalizedPayload.role,
      ...(hasParentId ? { parent_id: resolvedParentId } : {}),
      department_id: normalizedPayload.department_id,
      is_active: normalizedPayload.is_active,
    });
  }

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: existing ? "user_updated" : "user_created",
    targetType: "user",
    targetId: normalizedPayload.employee_id,
    metadata: {
      role: normalizedPayload.role,
      ...(hasParentId ? { parent_id: resolvedParentId } : {}),
      department_id: normalizedPayload.department_id,
      is_active: normalizedPayload.is_active,
    },
  });

  return user;
}

async function updateUserStatus(actor, employeeId, isActive) {
  const existing = await findUserByEmployeeId(employeeId);

  if (!existing) {
    throw new AppError(404, "User not found");
  }

  const user = await setUserActiveStatus(employeeId, isActive);

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: isActive ? "user_activated" : "user_deactivated",
    targetType: "user",
    targetId: employeeId,
    metadata: { is_active: isActive },
  });

  return user;
}

async function saveRole(actor, payload) {
  requireFields(payload, ["id", "name", "hierarchy_level", "scope"]);
  const client = await pool.connect();
  let roles;

  try {
    await client.query("BEGIN");
    roles = await upsertRole({
      ...payload,
      auditActorEmployeeId: actor.employee_id,
      autoCreateMissingPermissions: payload.autoCreateMissingPermissions ?? payload.auto_create_permissions,
      is_active: payload.is_active !== false,
      permissions: payload.permissions || {},
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "role_saved",
    targetType: "role",
    targetId: payload.id,
    metadata: {
      ...payload,
      is_active: payload.is_active !== false,
    },
  });
  return roles;
}

async function saveDepartment(actor, payload) {
  requireFields(payload, ["id", "name"]);
  const departments = await upsertDepartment({
    ...payload,
    is_active: payload.is_active !== false,
  });
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "department_saved",
    targetType: "department",
    targetId: payload.id,
    metadata: {
      ...payload,
      is_active: payload.is_active !== false,
    },
  });
  return departments;
}

async function saveWorkflowTemplate(actor, payload) {
  requireFields(payload, ["department_id", "template_name"]);

  const template = await upsertWorkflowTemplate({
    ...payload,
    created_by: payload.created_by || actor.employee_id,
    default_priority: payload.default_priority || null,
    default_proof_required: payload.default_proof_required === true,
    default_approval_required: payload.default_approval_required !== false,
    eligible_role_ids: Array.isArray(payload.eligible_role_ids) ? payload.eligible_role_ids : [],
    is_active: payload.is_active !== false,
  });

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "workflow_template_saved",
    targetType: "workflow_template",
    targetId: template.id,
    metadata: {
      department_id: template.department_id,
      template_name: template.template_name,
      default_priority: template.default_priority,
      default_proof_required: template.default_proof_required,
      default_approval_required: template.default_approval_required,
      default_due_days: template.default_due_days,
      escalation_level: template.escalation_level,
      eligible_role_ids: template.eligible_role_ids,
      is_active: template.is_active,
    },
  });

  return template;
}

async function saveKpiDefinition(actor, payload) {
  requireFields(payload, ["id", "name"]);
  const kpis = await upsertKpiDefinition(payload);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "kpi_definition_saved",
    targetType: "kpi_definition",
    targetId: payload.id,
    metadata: payload,
  });
  return kpis;
}

async function saveEscalationRule(actor, payload) {
  requireFields(payload, ["id", "name", "priority", "after_minutes"]);
  const client = await pool.connect();
  let rules;

  try {
    await client.query("BEGIN");
    rules = await upsertEscalationRule(payload, client);
    await syncTaskEscalationSchedule(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "escalation_rule_saved",
    targetType: "escalation_rule",
    targetId: payload.id,
    metadata: payload,
  });
  return rules;
}

async function deleteDepartment(actor, departmentId) {
  await deleteDepartmentRecord(departmentId);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "department_deleted",
    targetType: "department",
    targetId: departmentId,
    metadata: {},
  });
  return true;
}

async function deleteRole(actor, roleId) {
  await deleteRoleRecord(roleId);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "role_deleted",
    targetType: "role",
    targetId: roleId,
    metadata: {},
  });
  return true;
}

async function saveShift(actor, payload) {
  requireFields(payload, ["id", "name", "start_time", "end_time"]);
  const shifts = await upsertShift(payload);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "shift_saved",
    targetType: "shift",
    targetId: payload.id,
    metadata: payload,
  });
  return shifts;
}

async function deleteShift(actor, shiftId) {
  await deleteShiftRecord(shiftId);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "shift_deleted",
    targetType: "shift",
    targetId: shiftId,
    metadata: {},
  });
  return true;
}

async function saveMachine(actor, payload) {
  requireFields(payload, ["id", "name"]);
  const machines = await upsertMachine(payload);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "machine_saved",
    targetType: "machine",
    targetId: payload.id,
    metadata: payload,
  });
  return machines;
}

async function deleteMachine(actor, machineId) {
  await deleteMachineRecord(machineId);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "machine_deleted",
    targetType: "machine",
    targetId: machineId,
    metadata: {},
  });
  return true;
}

async function deleteWorkflowTemplate(actor, templateId) {
  const deleted = await deleteWorkflowTemplateRecord(templateId);

  if (!deleted) {
    throw new AppError(404, "Workflow template not found");
  }

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "workflow_template_deleted",
    targetType: "workflow_template",
    targetId: templateId,
    metadata: {},
  });

  return true;
}

async function deleteUser(actor, employeeId) {
  await deleteUserRecord(employeeId);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "user_deleted",
    targetType: "user",
    targetId: employeeId,
    metadata: {},
  });
  return true;
}

async function toggleEscalationRule(actor, ruleId, isActive) {
  const client = await pool.connect();
  let rules;

  try {
    await client.query("BEGIN");
    // Update is_active
    await client.query(`UPDATE escalation_rules SET is_active = $1 WHERE id = $2`, [isActive, ruleId]);
    rules = await listEscalationRules(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "escalation_rule_toggled",
    targetType: "escalation_rule",
    targetId: ruleId,
    metadata: { is_active: isActive },
  });
  return rules;
}

async function deleteEscalationRule(actor, ruleId) {
  await deleteEscalationRuleRecord(ruleId);
  await createAuditLog({
    userEmployeeId: actor.employee_id,
    actionType: "escalation_rule_deleted",
    targetType: "escalation_rule",
    targetId: ruleId,
    metadata: {},
  });
  return true;
}

module.exports = {
  deleteDepartment,
  deleteEscalationRule,
  deleteMachine,
  deleteRole,
  deleteShift,
  deleteUser,
  deleteWorkflowTemplate,
  getAdminReferenceData,
  listUsersForScope,
  saveDepartment,
  saveEscalationRule,
  saveKpiDefinition,
  saveMachine,
  saveRole,
  saveShift,
  saveUser,
  saveWorkflowTemplate,
  toggleEscalationRule,
  updateUserStatus,
};
