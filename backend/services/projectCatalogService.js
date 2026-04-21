const { PERMISSIONS } = require("../config/constants");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { isDesignDepartment } = require("../lib/designDepartment");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  findDepartmentProjectByIdForDepartment,
  findFixtureByIdForDepartment,
  findProjectByIdForDepartment,
  findProjectByNumberForDepartment,
  listDepartmentProjectsByDepartment,
  listFixturesByScopeForDepartment,
  listProjectOptionsByDepartment,
  listScopesByProjectForDepartment,
} = require("../repositories/designProjectCatalogRepository");
const { hasPermission } = require("./accessControlService");
const { createTaskForUser } = require("./taskService");
const { listTasksForWorkflowInstance } = require("../repositories/tasksRepository");

function requireDepartment(user) {
  if (!user?.department_id) {
    throw new AppError(403, "A department is required for project data access");
  }
}

function requireDesignDepartment(user) {
  requireDepartment(user);

  if (!isDesignDepartment(user)) {
    throw new AppError(403, "This flow is only available to the Design department");
  }
}

async function listDepartmentProjectsForUser(user) {
  requireDesignDepartment(user);
  return listDepartmentProjectsByDepartment(user.department_id);
}

async function listDesignProjectsForUser(user) {
  requireDesignDepartment(user);
  return listProjectOptionsByDepartment(user.department_id);
}

async function listDesignScopesForUser(user, projectId) {
  requireDesignDepartment(user);

  const normalizedProjectId = String(projectId || "").trim();

  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required");
  }

  const project = await findProjectByIdForDepartment(normalizedProjectId, user.department_id);

  if (!project) {
    throw new AppError(404, "Project not found for your department");
  }

  return listScopesByProjectForDepartment(normalizedProjectId, user.department_id);
}

async function listDesignFixturesForUser(user, scopeId) {
  requireDesignDepartment(user);

  const normalizedScopeId = String(scopeId || "").trim();

  if (!normalizedScopeId) {
    throw new AppError(400, "scope_id is required");
  }

  return listFixturesByScopeForDepartment(normalizedScopeId, user.department_id);
}


async function createDesignTaskFromProject(user, payload = {}) {
  requireDesignDepartment(user);

  if (Object.prototype.hasOwnProperty.call(payload, "title")) {
    throw new AppError(400, "Task title is generated automatically and cannot be provided manually");
  }

  const projectId = String(payload.project_id || "").trim();
  const scopeId = String(payload.scope_id || "").trim();
  const fixtureId = String(payload.fixture_id || "").trim();

  if (!projectId) {
    throw new AppError(400, "project_id is required");
  }

  if (!scopeId) {
    throw new AppError(400, "scope_id is required");
  }

  if (!fixtureId) {
    throw new AppError(400, "fixture_id is required");
  }

  const project = await findProjectByIdForDepartment(projectId, user.department_id);
  if (!project) {
    throw new AppError(404, "Project not found for your department");
  }

  const fixture = await findFixtureByIdForDepartment(fixtureId, user.department_id);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  const scopedProject = await findDepartmentProjectByIdForDepartment(scopeId, user.department_id);

  const activeTasks = await listTasksForWorkflowInstance({
    departmentId: user.department_id,
    projectNo: project.project_no,
    scopeName: scopedProject.scope_name,
    instanceCode: fixture.fixture_no,
    instanceIndex: 0,
  });

  if (activeTasks.some((task) => task.status !== "closed")) {
    throw new AppError(409, "An active task already exists for this fixture");
  }

  return createTaskForUser(user, {
    ...payload,
    project_no: project.project_no,
    project_name: project.project_name,
    customer_name: project.customer_name,
    project_description: project.project_name,
    scope_name: scopedProject.scope_name,
    quantity_index: fixture.fixture_no,
    instance_count: fixture.qty,
    rework_date: null,
  });
}

module.exports = {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignFixturesForUser,
  listDesignProjectsForUser,
  listDesignScopesForUser
};
