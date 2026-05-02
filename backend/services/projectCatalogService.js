const { TASK_STATUSES } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { normalizeDesignStageName } = require("../lib/designWorkflowStages");
const { instrumentModuleExports } = require("../lib/observability");
const { pool } = require("../db");
const {
  requireDepartmentContext,
  resolveAccessibleDepartmentId,
  requireUserDepartment,
} = require("../lib/departmentContext");
const { isDesignDepartment } = require("../lib/designDepartment");
const {
  findDepartmentProjectByIdForDepartment,
  findFixtureByIdForDepartment,
  findOrCreateScope,
  findProjectByIdForDepartment,
  findScopeByIdForDepartment,
  listDepartmentProjectsByDepartment,
  listFixturesByScopeForDepartment,
  listProjectOptionsByDepartment,
  listScopesByProjectForDepartment,
  upsertProjectByNumber,
} = require("../repositories/designProjectCatalogRepository");
const { createAuditLog } = require("../repositories/auditRepository");
const { getConfiguredWorkflowForDepartment } = require("../repositories/fixtureWorkflowRepository");
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
  const departmentId = resolveAccessibleDepartmentId(user, requestedDepartmentId, "A department is required for project data access");
  return listProjectOptionsByDepartment(departmentId);
}

async function listDesignScopesForUser(user, projectId, requestedDepartmentId) {
  const normalizedProjectId = String(projectId || "").trim();

  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required");
  }

  const departmentId = resolveAccessibleDepartmentId(user, requestedDepartmentId, "A department is required for project data access");
  const project = await findProjectByIdForDepartment(normalizedProjectId, departmentId);

  if (!project) {
    throw new AppError(404, "Project not found for the selected department");
  }

  const scopes = await listScopesByProjectForDepartment(normalizedProjectId, departmentId);
  return scopes;
}

async function listDesignFixturesForUser(user, scopeId, requestedDepartmentId) {
  const normalizedScopeId = String(scopeId || "").trim();

  if (!normalizedScopeId) {
    throw new AppError(400, "scope_id is required");
  }

  const departmentId = resolveAccessibleDepartmentId(user, requestedDepartmentId, "A department is required for project data access");
  const scope = await findScopeByIdForDepartment(normalizedScopeId, departmentId);

  if (!scope) {
    throw new AppError(404, "Scope not found for the selected department");
  }

  return listFixturesByScopeForDepartment(normalizedScopeId, departmentId);
}

function normalizeProjectUploadRow(row = {}) {
  return {
    project_no: String(row.project_no || "").trim(),
    project_name: String(row.project_name || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
    scope_name: String(row.scope_name || "").trim(),
    instance_count: Number(row.instance_count),
    rework_date: row.rework_date || null,
  };
}

function validateProjectUploadRow(row) {
  if (!row.project_no || !row.project_name || !row.customer_name || !row.scope_name) {
    return "project_no, project_name, customer_name, and scope_name are required";
  }

  if (!Number.isInteger(row.instance_count) || row.instance_count <= 0) {
    return "instance_count must be a positive integer";
  }

  return null;
}

async function uploadDepartmentProjectsForUser(user, payload = {}) {
  requireDesignDepartment(user);

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length === 0) {
    throw new AppError(400, "rows is required");
  }

  const departmentId = requireUserDepartment(user);
  const skippedRows = [];
  let successCount = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let index = 0; index < rows.length; index += 1) {
      const normalizedRow = normalizeProjectUploadRow(rows[index]);
      const validationError = validateProjectUploadRow(normalizedRow);

      if (validationError) {
        skippedRows.push({
          row_number: index + 1,
          ...normalizedRow,
          reason: validationError,
        });
        continue;
      }

      const project = await upsertProjectByNumber({
        project_no: normalizedRow.project_no,
        project_name: normalizedRow.project_name,
        customer_name: normalizedRow.customer_name,
        department_id: departmentId,
        uploaded_by: user.employee_id,
      }, client);

      const scope = await findOrCreateScope(project.project_id, normalizedRow.scope_name, client);

      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "DESIGN_PROJECT_SCOPE_IMPORTED",
        targetType: "design_project",
        targetId: scope.scope_id || project.project_id || normalizedRow.project_no,
        metadata: {
          project_id: project.project_id,
          scope_id: scope.scope_id,
          project_code: normalizedRow.project_no,
          project_name: normalizedRow.project_name,
          customer_name: normalizedRow.customer_name,
          scope_name: normalizedRow.scope_name,
          instance_count: normalizedRow.instance_count,
          rework_date: normalizedRow.rework_date,
          department_id: departmentId,
        },
      }, client);

      successCount += 1;
    }

    await client.query("COMMIT");
    return {
      success_count: successCount,
      skipped_rows: skippedRows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createDesignTaskFromProject(user, payload = {}) {
  if (Object.prototype.hasOwnProperty.call(payload, "title")) {
    throw new AppError(400, "Task title is generated automatically and cannot be provided manually");
  }

  const projectId = String(payload.project_id || "").trim();
  const scopeId = String(payload.scope_id || "").trim();
  const fixtureId = String(payload.fixture_id || "").trim();
  validateResolvedDesignTaskContext({ projectId, scopeId, fixtureId });

  const departmentId = resolveAccessibleDepartmentId(
    user,
    payload.department_id,
    "A department is required to create workflow tasks",
  );
  const project = await findProjectByIdForDepartment(projectId, departmentId);
  if (!project) {
    throw new AppError(404, "Project not found for the selected department");
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
  uploadDepartmentProjectsForUser,
});
