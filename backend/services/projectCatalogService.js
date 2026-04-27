const { TASK_STATUSES } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { normalizeDesignStageName } = require("../lib/designWorkflowStages");
const { instrumentModuleExports } = require("../lib/observability");
const {
  getEffectiveDepartment,
  requireDepartmentContext,
  requireUserDepartment,
} = require("../lib/departmentContext");
const { isDesignDepartment } = require("../lib/designDepartment");
const {
  findDepartmentProjectByIdForDepartment,
  findFixtureByIdForDepartment,
  findProjectByIdForDepartment,
  findScopeByIdForDepartment,
  listDepartmentProjectsByDepartment,
  listFixturesByScopeForDepartment,
  listProjectOptionsByDepartment,
  listScopesByProjectForDepartment,
} = require("../repositories/designProjectCatalogRepository");
const { getConfiguredWorkflowForDepartment } = require("../repositories/fixtureWorkflowRepository");
const { isAdmin } = require("./accessControlService");
const { createTaskForUser } = require("./taskService");
const { getCurrentStage } = require("./fixtureWorkflowService");

function requireDepartment(user) {
  requireUserDepartment(user, "A department is required for project data access");
}

function requireDesignDepartment(user) {
  requireDepartment(user);

  if (!isDesignDepartment(user)) {
    throw new AppError(403, "This flow is only available to the Design department");
  }
}

function resolveAccessibleDepartmentId(user, requestedDepartmentId) {
  const effectiveDepartmentId = getEffectiveDepartment(user, requestedDepartmentId);

  if (isAdmin(user)) {
    return requireDepartmentContext(effectiveDepartmentId);
  }

  const userDepartmentId = requireUserDepartment(user, "A department is required for project data access");

  if (effectiveDepartmentId && effectiveDepartmentId !== userDepartmentId) {
    throw new AppError(403, "You do not have permission to access another department");
  }

  return requireDepartmentContext(effectiveDepartmentId);
}

function validateResolvedDesignTaskContext({ projectId, scopeId, fixtureId, currentStage, currentStageKey, currentWorkflowStage }) {
  if (!projectId) {
    throw new AppError(400, "project_id is required");
  }

  if (!scopeId) {
    throw new AppError(400, "scope_id is required");
  }

  if (!fixtureId) {
    throw new AppError(400, "fixture_id is required");
  }

  if (currentStage !== undefined && (!currentStage || currentStage.is_complete || !currentStage.stage)) {
    throw new AppError(409, "Fixture is fully completed");
  }

  if (currentStage !== undefined && !currentStageKey) {
    throw new AppError(400, `Unable to resolve a valid workflow stage from "${currentStage.stage}"`);
  }

  if (currentStage !== undefined && !currentWorkflowStage?.id) {
    throw new AppError(400, `Unable to resolve the configured workflow stage for "${currentStage.stage}"`);
  }

  if (!Object.values(TASK_STATUSES).includes(TASK_STATUSES.ASSIGNED)) {
    throw new AppError(500, "Invalid task status configuration for design assignment");
  }
}

async function listDepartmentProjectsForUser(user) {
  requireDesignDepartment(user);
  return listDepartmentProjectsByDepartment(requireUserDepartment(user));
}

async function listDesignProjectsForUser(user, requestedDepartmentId) {
  const departmentId = resolveAccessibleDepartmentId(user, requestedDepartmentId);
  const projects = await listProjectOptionsByDepartment(departmentId);

  if (projects.length === 0) {
    throw new AppError(
      404,
      `No projects found for department ${departmentId}. Possible mismatch or data integrity issue.`,
    );
  }

  return projects;
}

async function listDesignScopesForUser(user, projectId, requestedDepartmentId) {
  const normalizedProjectId = String(projectId || "").trim();

  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required");
  }

  const departmentId = resolveAccessibleDepartmentId(user, requestedDepartmentId);
  const project = await findProjectByIdForDepartment(normalizedProjectId, departmentId);

  if (!project) {
    throw new AppError(404, "Project not found for the selected department");
  }

  const scopes = await listScopesByProjectForDepartment(normalizedProjectId, departmentId);

  if (scopes.length === 0) {
    throw new AppError(
      409,
      `Project ${normalizedProjectId} has no scopes for department ${departmentId}. Possible data integrity issue.`,
    );
  }

  return scopes;
}

async function listDesignFixturesForUser(user, scopeId, requestedDepartmentId) {
  const normalizedScopeId = String(scopeId || "").trim();

  if (!normalizedScopeId) {
    throw new AppError(400, "scope_id is required");
  }

  const departmentId = resolveAccessibleDepartmentId(user, requestedDepartmentId);
  const scope = await findScopeByIdForDepartment(normalizedScopeId, departmentId);

  if (!scope) {
    throw new AppError(404, "Scope not found for the selected department");
  }

  return listFixturesByScopeForDepartment(normalizedScopeId, departmentId);
}

async function createDesignTaskFromProject(user, payload = {}) {
  requireDesignDepartment(user);

  if (Object.prototype.hasOwnProperty.call(payload, "title")) {
    throw new AppError(400, "Task title is generated automatically and cannot be provided manually");
  }

  const projectId = String(payload.project_id || "").trim();
  const scopeId = String(payload.scope_id || "").trim();
  const fixtureId = String(payload.fixture_id || "").trim();
  validateResolvedDesignTaskContext({ projectId, scopeId, fixtureId });

  const departmentId = requireUserDepartment(user, "A department is required to create design tasks");
  const project = await findProjectByIdForDepartment(projectId, departmentId);
  if (!project) {
    throw new AppError(404, "Project not found for your department");
  }

  const fixture = await findFixtureByIdForDepartment(fixtureId, departmentId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  const scopedProject = await findDepartmentProjectByIdForDepartment(scopeId, departmentId);
  if (!scopedProject) {
    throw new AppError(404, "Scope not found for your department");
  }

  if (scopedProject.project_id !== project.project_id) {
    throw new AppError(409, "scope_id does not belong to the selected project_id");
  }

  if (fixture.project_id !== project.project_id || fixture.scope_id !== scopedProject.scope_id) {
    throw new AppError(409, "fixture_id does not belong to the selected project_id and scope_id");
  }

  const currentStage = await getCurrentStage(fixtureId, departmentId);
  const workflow = await getConfiguredWorkflowForDepartment(departmentId);
  const currentStageKey = normalizeDesignStageName(currentStage.stage);
  const currentWorkflowStage = workflow?.stages?.find((stage) => {
    if (!currentStageKey) {
      return String(stage.name || "").trim().toLowerCase() === String(currentStage.stage || "").trim().toLowerCase();
    }

    return normalizeDesignStageName(stage.name) === currentStageKey;
  }) || null;

  validateResolvedDesignTaskContext({
    projectId,
    scopeId,
    fixtureId,
    currentStage,
    currentStageKey,
    currentWorkflowStage,
  });

  if (!workflow?.id) {
    throw new AppError(409, "Current workflow stage could not be resolved for this fixture");
  }

  return createTaskForUser(user, {
    ...payload,
    project_id: project.project_id,
    scope_id: scopedProject.scope_id,
    fixture_id: fixture.fixture_id,
    fixture_no: fixture.fixture_no,
    project_no: project.project_code,
    project_name: project.project_name,
    customer_name: project.company_name,
    project_description: project.project_name,
    scope_name: scopedProject.scope_name,
    quantity_index: fixture.fixture_no,
    instance_count: fixture.qty,
    current_stage_id: currentWorkflowStage.id,
    rework_date: null,
  });
}

module.exports = instrumentModuleExports("service.projectCatalogService", {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignFixturesForUser,
  listDesignProjectsForUser,
  listDesignScopesForUser,
});
