const { generateUUID } = require("../lib/uuid");
const { AppError } = require("../lib/AppError");
const { hasPermission } = require("./accessControlService");
const { createAuditLog } = require("../repositories/auditRepository");
const { pool } = require("../db");
const {
  listWorkflows,
  findWorkflowById,
  findWorkflowByIdIncludingInactive,
  findWorkflowByDepartmentId,
  upsertWorkflow,
  deleteWorkflowPermanently,
  replaceWorkflowStages,
  listWorkflowStages,
  findStageById,
  upsertWorkflowStage,
  softDeleteWorkflowStage,
  listWorkflowTransitions,
  findTransitionById,
  upsertWorkflowTransition,
  softDeleteWorkflowTransition,
  checkWorkflowInUse,
  checkStageInUse,
  getWorkflowDependencies,
  getStageDependencies,
} = require("../repositories/workflowAdminRepository");

const MANAGE_WORKFLOWS_PERM = "can_manage_workflows";

function ensureWorkflowManagementPermission(user) {
  if (!hasPermission(user, MANAGE_WORKFLOWS_PERM)) {
    throw new AppError(403, "Permission denied: can_manage_workflows required");
  }
}

function normalizeStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new AppError(400, "At least one stage is required");
  }

  return stages.map((stage, index) => {
    const stageName = String(stage?.stage_name ?? stage?.name ?? "").trim();

    if (!stageName) {
      throw new AppError(400, "Stage names cannot be empty");
    }

    return {
      id: String(stage?.id || generateUUID()),
      stage_name: stageName,
      description: String(stage?.description || "").trim(),
      sequence_order: index + 1,
      is_final: index === stages.length - 1,
    };
  });
}

async function saveWorkflowDefinition(user, workflowId, payload) {
  ensureWorkflowManagementPermission(user);

  const name = String(payload?.name || "").trim();
  const description = String(payload?.description || "").trim();
  const departmentId = String(payload?.department_id || "").trim();
  const stages = normalizeStages(payload?.stages);

  if (!name) {
    throw new AppError(400, "Workflow name is required");
  }

  if (!departmentId) {
    throw new AppError(400, "Department is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingForDepartment = await findWorkflowByDepartmentId(departmentId, client);
    if (existingForDepartment && existingForDepartment.id !== workflowId) {
      throw new AppError(409, "This department already has a workflow");
    }

    const resolvedWorkflowId = workflowId || generateUUID();
    const existingWorkflow = workflowId
      ? await findWorkflowByIdIncludingInactive(workflowId, client)
      : null;

    if (workflowId && !existingWorkflow) {
      throw new AppError(404, "Workflow not found");
    }

    if (workflowId) {
      const workflowInUse = await checkWorkflowInUse(workflowId, client);
      if (workflowInUse) {
        throw new AppError(409, "Cannot modify a workflow while active tasks are using it");
      }
    }

    await upsertWorkflow({
      id: resolvedWorkflowId,
      name,
      description,
      department_id: departmentId,
      initial_stage_id: null,
      is_active: existingWorkflow?.is_active ?? true,
    }, client);

    await replaceWorkflowStages(resolvedWorkflowId, stages, client);

    await upsertWorkflow({
      id: resolvedWorkflowId,
      name,
      description,
      department_id: departmentId,
      initial_stage_id: stages[0].id,
      is_active: existingWorkflow?.is_active ?? true,
    }, client);

    await client.query("COMMIT");

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: workflowId ? "workflow_updated" : "workflow_created",
      targetType: "workflow",
      targetId: resolvedWorkflowId,
      metadata: {
        name,
        description,
        department_id: departmentId,
        stage_count: stages.length,
      },
    });

    return getWorkflow(resolvedWorkflowId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============ WORKFLOW MANAGEMENT ============

async function createWorkflow(user, payload) {
  return saveWorkflowDefinition(user, null, payload);
}

async function updateWorkflow(user, workflowId, payload) {
  return saveWorkflowDefinition(user, workflowId, payload);
}

async function getWorkflow(workflowId) {
  const workflow = await findWorkflowById(workflowId);
  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }

  const stages = await listWorkflowStages(workflowId);
  const transitions = await listWorkflowTransitions(workflowId);

  return {
    ...workflow,
    stages,
    transitions,
  };
}

async function deleteWorkflow(user, workflowId) {
  ensureWorkflowManagementPermission(user);

  const workflow = await findWorkflowById(workflowId);
  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }

  const inUse = await checkWorkflowInUse(workflowId);
  if (inUse) {
    const deps = await getWorkflowDependencies(workflowId);
    throw new AppError(409, `Cannot delete workflow: ${deps.tasks} active task(s) reference it.`);
  }

  const deleted = await deleteWorkflowPermanently(workflowId);

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_deleted",
    targetType: "workflow",
    targetId: workflowId,
    metadata: { workflow },
  });

  return deleted;
}

// ============ WORKFLOW STAGE MANAGEMENT ============

async function createWorkflowStage(user, payload) {
  ensureWorkflowManagementPermission(user);

  const { id, workflow_id, name, description, sequence_order, is_final } = payload;

  if (!id || !workflow_id || !name) {
    throw new AppError(400, "Stage id, workflow_id, and name are required");
  }

  const workflow = await findWorkflowById(workflow_id);
  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }

  const stage = await upsertWorkflowStage({
    id,
    workflow_id,
    name,
    description: description || "",
    sequence_order: sequence_order === undefined || sequence_order === null ? null : Number(sequence_order),
    is_final: is_final || false,
    is_active: true,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_stage_created",
    targetType: "workflow_stage",
    targetId: id,
    metadata: { workflow_id, name, is_final },
  });

  return stage;
}

async function updateWorkflowStage(user, stageId, payload) {
  ensureWorkflowManagementPermission(user);

  const existing = await findStageById(stageId);
  if (!existing) {
    throw new AppError(404, "Workflow stage not found");
  }

  const { name, description, sequence_order, is_final } = payload;

  const stage = await upsertWorkflowStage({
    id: stageId,
    workflow_id: existing.workflow_id,
    name: name || existing.name,
    description: description !== undefined ? description : existing.description,
    sequence_order: sequence_order !== undefined ? Number(sequence_order) : existing.sequence_order,
    is_final: is_final !== undefined ? is_final : existing.is_final,
    is_active: existing.is_active,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_stage_updated",
    targetType: "workflow_stage",
    targetId: stageId,
    metadata: payload,
  });

  return stage;
}

async function deleteWorkflowStage(user, stageId) {
  ensureWorkflowManagementPermission(user);

  const stage = await findStageById(stageId);
  if (!stage) {
    throw new AppError(404, "Workflow stage not found");
  }

  const inUse = await checkStageInUse(stageId);
  if (inUse) {
    const deps = await getStageDependencies(stageId);
    throw new AppError(409, `Cannot delete stage: ${deps.tasks} active task(s) in this stage, ${deps.outgoingTransitions} outgoing transitions, ${deps.incomingTransitions} incoming transitions. Use soft delete instead.`);
  }

  const deleted = await softDeleteWorkflowStage(stageId);

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_stage_deleted",
    targetType: "workflow_stage",
    targetId: stageId,
    metadata: { workflow_id: stage.workflow_id },
  });

  return deleted;
}

// ============ WORKFLOW TRANSITION MANAGEMENT ============

async function createWorkflowTransition(user, payload) {
  ensureWorkflowManagementPermission(user);

  const { workflow_id, from_stage_id, to_stage_id, action_name, required_permission, conditions } = payload;

  if (!workflow_id || !from_stage_id || !to_stage_id || !action_name) {
    throw new AppError(400, "workflow_id, from_stage_id, to_stage_id, and action_name are required");
  }

  const workflow = await findWorkflowById(workflow_id);
  if (!workflow) {
    throw new AppError(404, "Workflow not found");
  }

  const fromStage = await findStageById(from_stage_id);
  const toStage = await findStageById(to_stage_id);

  if (!fromStage || !toStage) {
    throw new AppError(404, "Source or target stage not found");
  }

  const transition = await upsertWorkflowTransition({
    id: null,
    workflow_id,
    from_stage_id,
    to_stage_id,
    action_name,
    required_permission: required_permission || null,
    conditions: conditions || {},
    is_active: true,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_transition_created",
    targetType: "workflow_transition",
    targetId: transition.id,
    metadata: { workflow_id, from_stage_id, to_stage_id, action_name },
  });

  return transition;
}

async function updateWorkflowTransition(user, transitionId, payload) {
  ensureWorkflowManagementPermission(user);

  const existing = await findTransitionById(transitionId);
  if (!existing) {
    throw new AppError(404, "Workflow transition not found");
  }

  const { from_stage_id, to_stage_id, action_name, required_permission, conditions } = payload;

  const transition = await upsertWorkflowTransition({
    id: transitionId,
    workflow_id: existing.workflow_id,
    from_stage_id: from_stage_id || existing.from_stage_id,
    to_stage_id: to_stage_id || existing.to_stage_id,
    action_name: action_name || existing.action_name,
    required_permission: required_permission !== undefined ? required_permission : existing.required_permission,
    conditions: conditions !== undefined ? conditions : existing.conditions,
    is_active: existing.is_active,
  });

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_transition_updated",
    targetType: "workflow_transition",
    targetId: transitionId,
    metadata: payload,
  });

  return transition;
}

async function deleteWorkflowTransition(user, transitionId) {
  ensureWorkflowManagementPermission(user);

  const transition = await findTransitionById(transitionId);
  if (!transition) {
    throw new AppError(404, "Workflow transition not found");
  }

  const deleted = await softDeleteWorkflowTransition(transitionId);

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: "workflow_transition_deleted",
    targetType: "workflow_transition",
    targetId: transitionId,
    metadata: { workflow_id: transition.workflow_id },
  });

  return deleted;
}

module.exports = {
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  deleteWorkflow,
  createWorkflowStage,
  updateWorkflowStage,
  deleteWorkflowStage,
  createWorkflowTransition,
  updateWorkflowTransition,
  deleteWorkflowTransition,
};
