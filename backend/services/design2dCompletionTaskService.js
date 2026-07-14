const { PERMISSIONS, TASK_TYPES } = require("../config/constants");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { isDesignDepartment } = require("../lib/designDepartment");
const {
  DESIGN_2D_COMPLETION_TASKS,
  FIXTURE_TASK_CODES,
  PROJECT_TASK_CODES,
  buildDesign2DCompletionState,
  getDesign2DCompletionTaskDefinition,
  isActiveCompletionTask,
  isApprovedCompletionTask,
} = require("../lib/design2dCompletionTasks");
const { normalizeSupplierName } = require("../lib/outsourceWorkflow");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  getDesign2DCompletionProjectDepartment,
  getLatestDesign2DCompletionTask,
  listDesign2DCompletionTasks,
  listProjectFixturesWith2DStatus,
  lockDesign2DCompletionProject,
  markCompletionTaskNotRequired,
} = require("../repositories/design2dCompletionTaskRepository");
const {
  findProjectByIdForUser,
  rememberRecentOutsourceSupplier,
} = require("../repositories/designProjectCatalogRepository");
const { appendTaskActivity } = require("../repositories/tasksRepository");
const {
  hasPermission,
  isOperationalControllerRole,
} = require("./accessControlService");
const { listDesignProjectsForUser } = require("./projectCatalogService");
const {
  createTaskForUser,
  getAssignableUsersForTaskContext,
} = require("./taskService");

function taskCatalog(codes) {
  return codes.map((code) => ({ code, ...DESIGN_2D_COMPLETION_TASKS[code] }));
}

async function requireDesignDepartmentProject(projectId, client = pool) {
  const department = await getDesign2DCompletionProjectDepartment(projectId, client);
  if (!department || !isDesignDepartment({ id: department.department_id, name: department.department_name })) {
    throw new AppError(404, "Design project not found");
  }
  return department;
}

async function loadProjectCompletionState(projectId, client = pool) {
  const [fixtures, tasks] = await Promise.all([
    listProjectFixturesWith2DStatus(projectId, client),
    listDesign2DCompletionTasks(projectId, client),
  ]);
  return { fixtures, tasks, ...buildDesign2DCompletionState({ fixtures, tasks }) };
}

function publicCompletionState(project, state) {
  return {
    project,
    fixtures: state.eligibleFixtures,
    tasks: state.tasks,
    fixture_task_types: taskCatalog(FIXTURE_TASK_CODES),
    project_task_types: taskCatalog(PROJECT_TASK_CODES),
    all_fixtures_2d_complete: state.allFixtures2DComplete,
    all_original_workflows_complete: state.allOriginalWorkflowsComplete,
    fixture_requirements_complete: state.fixtureRequirementsComplete,
    project_tasks_unlocked: state.projectTasksUnlocked,
    project_completion_ready: state.projectCompletionReady,
    missing_requirements: state.missingRequirements,
  };
}

async function listEligibleDesign2DCompletionProjectsForUser(user, requestedDepartmentId = null) {
  const projects = await listDesignProjectsForUser(user, requestedDepartmentId, { activeOnly: true });
  const projectContexts = await Promise.all(
    projects.map(async (project) => ({
      department: await getDesign2DCompletionProjectDepartment(project.project_id),
      fixtures: await listProjectFixturesWith2DStatus(project.project_id),
    })),
  );
  return projects.filter((_, index) => (
    isDesignDepartment({
      id: projectContexts[index].department?.department_id,
      name: projectContexts[index].department?.department_name,
    })
    && projectContexts[index].fixtures.some((fixture) => fixture.two_d_complete === true)
  ));
}

async function getDesign2DCompletionProjectForUser(user, projectId, requestedDepartmentId = null) {
  const project = await findProjectByIdForUser(
    String(projectId || "").trim(),
    user,
    requestedDepartmentId || null,
    { activeOnly: true },
  );
  if (!project) {
    throw new AppError(404, "Active project not found or not accessible");
  }
  await requireDesignDepartmentProject(project.project_id);
  const state = await loadProjectCompletionState(project.project_id);
  if (!state.eligibleFixtures.length) {
    throw new AppError(409, "No fixture in this project has completed its original 2D stage");
  }
  return publicCompletionState(project, state);
}

function nextRevisionFor(latestTask) {
  if (!latestTask) {
    return 0;
  }
  if (isActiveCompletionTask(latestTask)) {
    throw new AppError(409, "An active unfinished revision already exists for this task type and scope");
  }
  if (latestTask.status !== "cancelled" && !isApprovedCompletionTask(latestTask)) {
    throw new AppError(409, "The previous revision must be approved or cancelled before creating another revision");
  }
  const next = Number(latestTask.completion_task_revision) + 1;
  if (next > 99) {
    throw new AppError(409, "The two-digit revision limit has been reached");
  }
  return next;
}

async function requireShared2DAssignee(user, project, assignedTo) {
  const assignees = await getAssignableUsersForTaskContext(user, {
    taskType: TASK_TYPES.DEPARTMENT_WORKFLOW,
    departmentId: project.department_id,
    projectId: project.project_id,
    stageName: "2D Finish",
  });
  if (!assignees.some((candidate) => candidate.employee_id === assignedTo)) {
    throw new AppError(403, "Assignee is not eligible under the existing Project Fixtures 2D assignment rules");
  }
}

function canMarkMimicNotRequired(user) {
  return isOperationalControllerRole(user)
    && hasPermission(user, PERMISSIONS.ASSIGN_TASK)
    && hasPermission(user, PERMISSIONS.CREATE_TASK)
    && hasPermission(user, PERMISSIONS.APPROVE_COMPLETED_TASK);
}

async function assignDesign2DCompletionTaskForUser(user, payload = {}) {
  const projectId = String(payload.project_id || "").trim();
  const code = String(payload.task_code || payload.completion_task_code || "").trim().toUpperCase();
  const definition = getDesign2DCompletionTaskDefinition(code);
  const fixtureId = definition?.scope === "fixture" ? String(payload.fixture_id || "").trim() : null;
  const assignedTo = String(payload.assigned_to || "").trim();
  const deadline = new Date(payload.deadline);
  const supplierName = normalizeSupplierName(payload.supplier_name || payload.outsource_supplier_name);

  if (!projectId || !definition || !assignedTo) {
    throw new AppError(400, "project_id, task_code and assigned_to are required");
  }
  if (definition.scope === "fixture" && !fixtureId) {
    throw new AppError(400, "fixture_id is required for fixture-level tasks");
  }
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
    throw new AppError(400, "Deadline must be in the future");
  }
  if (payload.outsource === true && !supplierName) {
    throw new AppError(400, "Supplier name is required for outsourcing");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await lockDesign2DCompletionProject(projectId, client))) {
      throw new AppError(404, "Project not found");
    }
    const project = await findProjectByIdForUser(
      projectId,
      user,
      payload.department_id || null,
      { activeOnly: true },
      client,
    );
    if (!project) {
      throw new AppError(404, "Active project not found or not accessible");
    }
    await requireDesignDepartmentProject(projectId, client);

    const state = await loadProjectCompletionState(projectId, client);
    if (definition.scope === "fixture") {
      if (!state.eligibleFixtures.some((fixture) => fixture.fixture_id === fixtureId)) {
        throw new AppError(409, "This fixture has not completed its original 2D stage");
      }
    } else if (!state.projectTasksUnlocked) {
      throw new AppError(409, "Project-level tasks are locked until all fixture-level requirements are approved");
    }

    await requireShared2DAssignee(user, project, assignedTo);
    const latest = await getLatestDesign2DCompletionTask(projectId, fixtureId, code, client);
    const revision = nextRevisionFor(latest);
    const task = await createTaskForUser(user, {
      task_type: TASK_TYPES.DESIGN_2D_COMPLETION,
      department_id: project.department_id,
      project_id: projectId,
      fixture_id: fixtureId,
      scope_type: definition.scope,
      completion_task_code: code,
      completion_task_revision: revision,
      completion_task_outsource_supplier: supplierName,
      assigned_to: assignedTo,
      priority: payload.priority,
      deadline: deadline.toISOString(),
      description: String(payload.description || "").trim(),
      approval_required: true,
      proof_required: true,
    }, {
      client,
      allowDesign2DCompletion: true,
      skipAnalyticsRefresh: true,
    });

    if (supplierName) {
      await rememberRecentOutsourceSupplier(supplierName, client);
    }
    await client.query("COMMIT");
    return task;
  } catch (error) {
    await client.query("ROLLBACK");
    if (String(error?.constraint || "").startsWith("uniq_design_2d_completion")) {
      throw new AppError(409, "A conflicting active or duplicate task revision already exists");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function markMimicNotRequiredForUser(user, payload = {}) {
  if (!canMarkMimicNotRequired(user)) {
    throw new AppError(403, "Only an authorized Design leader can mark Mimic as Not Required");
  }
  const projectId = String(payload.project_id || "").trim();
  const reason = String(payload.reason || "").trim();
  if (!projectId || !reason) {
    throw new AppError(400, "project_id and reason are required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await lockDesign2DCompletionProject(projectId, client))) {
      throw new AppError(404, "Project not found");
    }
    const project = await findProjectByIdForUser(
      projectId,
      user,
      payload.department_id || null,
      { activeOnly: true },
      client,
    );
    if (!project) {
      throw new AppError(404, "Active project not found or not accessible");
    }
    await requireDesignDepartmentProject(projectId, client);
    const state = await loadProjectCompletionState(projectId, client);
    if (!state.projectTasksUnlocked) {
      throw new AppError(409, "Mimic cannot be marked Not Required until project-level tasks are unlocked");
    }

    const code = "PROJECT_MIMIC";
    const latest = await getLatestDesign2DCompletionTask(projectId, null, code, client);
    const revision = nextRevisionFor(latest);
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const task = await createTaskForUser(user, {
      task_type: TASK_TYPES.DESIGN_2D_COMPLETION,
      department_id: project.department_id,
      project_id: projectId,
      scope_type: "project",
      completion_task_code: code,
      completion_task_revision: revision,
      assigned_to: user.employee_id,
      priority: "medium",
      deadline,
      description: `Mimic is not required: ${reason}`,
      approval_required: true,
      proof_required: false,
    }, {
      client,
      allowDesign2DCompletion: true,
      skipAnalyticsRefresh: true,
    });

    await markCompletionTaskNotRequired(task.id, user.employee_id, reason, client);
    await appendTaskActivity(task.id, {
      userEmployeeId: user.employee_id,
      actionType: "task_marked_not_required",
      notes: reason,
      metadata: { completion_task_code: code, completion_task_revision: revision },
    }, client);
    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "design_2d_completion_task_not_required",
      targetType: "task",
      targetId: task.id,
      metadata: { project_id: projectId, reason, completion_task_revision: revision },
    }, client);
    const updatedTask = (await listDesign2DCompletionTasks(projectId, client)).find((item) => item.id === task.id);
    await client.query("COMMIT");
    return updatedTask;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertDesign2DCompletionProjectReady(projectId, client = pool) {
  const department = await getDesign2DCompletionProjectDepartment(projectId, client);
  if (!department) {
    throw new AppError(404, "Project not found");
  }
  if (!isDesignDepartment({ id: department.department_id, name: department.department_name })) {
    return true;
  }
  const state = await loadProjectCompletionState(projectId, client);
  if (!state.projectCompletionReady) {
    throw new AppError(
      409,
      `Project cannot be completed: ${state.missingRequirements.join("; ") || "2D completion tasks are incomplete"}`,
    );
  }
  return true;
}

module.exports = {
  assertDesign2DCompletionProjectReady,
  assignDesign2DCompletionTaskForUser,
  canMarkMimicNotRequired,
  getDesign2DCompletionProjectForUser,
  listEligibleDesign2DCompletionProjectsForUser,
  loadProjectCompletionState,
  markMimicNotRequiredForUser,
  nextRevisionFor,
};
