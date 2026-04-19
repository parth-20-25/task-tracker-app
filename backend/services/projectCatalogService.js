const { PERMISSIONS } = require("../config/constants");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { isDesignDepartment } = require("../lib/designDepartment");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  countInstancesForScope,
  createInstancesForScope,
  createReworksForScopeInstances,
  findDepartmentProjectByIdForDepartment,
  findInstanceByIdForDepartment,
  findProjectByIdForDepartment,
  findExactDepartmentProjectMatch,
  findOrCreateScope,
  findScopeByIdForDepartment,
  listDepartmentProjectsByDepartment,
  listInstancesByScopeForDepartment,
  listProjectOptionsByDepartment,
  listScopesByProjectForDepartment,
  touchProject,
  upsertProjectByNumber,
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

function normalizeProjectField(value, fieldName) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    throw new AppError(400, `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeInstanceCount(value) {
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    throw new AppError(400, "instance_count is required");
  }

  if (!/^\d+$/.test(normalizedValue)) {
    throw new AppError(400, "instance_count must be an integer");
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new AppError(400, "instance_count must be a positive integer");
  }

  return parsedValue;
}

function normalizeReworkDate(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return null;
  }

  const isExactDate = (year, month, day) => {
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);

    if (Number.isNaN(date.getTime())) {
      return false;
    }

    return (
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day)
    );
  };

  const slashMatch = normalizedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const normalizedDay = day.padStart(2, "0");
    const normalizedMonth = month.padStart(2, "0");

    if (isExactDate(year, normalizedMonth, normalizedDay)) {
      return `${year}-${normalizedMonth}-${normalizedDay}`;
    }
  }

  const isoMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;

    if (isExactDate(year, month, day)) {
      return normalizedValue;
    }
  }

  throw new AppError(400, "rework_date must use DD/MM/YYYY");
}

function isBlankProjectRow(payload = {}) {
  const normalizedPayload = payload && typeof payload === "object" ? payload : {};

  return [
    normalizedPayload.project_no,
    normalizedPayload.project_name,
    normalizedPayload.customer_name,
    normalizedPayload.scope_name,
    normalizedPayload.instance_count,
    normalizedPayload.rework_date,
  ].every((value) => !String(value || "").trim());
}

function normalizeProjectPayload(payload = {}, rowNumber = null) {
  const normalizedPayload = payload && typeof payload === "object" ? payload : {};
  const projectName = normalizeProjectField(normalizedPayload.project_name, "project_name");
  const instanceCount = normalizeInstanceCount(normalizedPayload.instance_count);

  return {
    row_number: rowNumber,
    project_no: normalizeProjectField(normalizedPayload.project_no, "project_no"),
    project_name: projectName,
    customer_name: normalizeProjectField(normalizedPayload.customer_name, "customer_name"),
    project_description: projectName,
    scope_name: normalizeProjectField(normalizedPayload.scope_name, "scope_name"),
    quantity_index: String(instanceCount),
    instance_count: instanceCount,
    rework_date: normalizeReworkDate(normalizedPayload.rework_date),
  };
}

function validateProjectUploadRows(payload) {
  const rawRows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [payload];

  const rows = rawRows.filter((row) => !isBlankProjectRow(row));

  if (rows.length === 0) {
    throw new AppError(400, "At least one project row is required");
  }

  return rows.map((row, index) => normalizeProjectPayload(row, index + 1));
}

function buildDuplicateReason(row) {
  return `Duplicate: Project ${row.project_name} - Scope ${row.scope_name}`;
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

async function listDesignInstancesForUser(user, scopeId) {
  requireDesignDepartment(user);

  const normalizedScopeId = String(scopeId || "").trim();

  if (!normalizedScopeId) {
    throw new AppError(400, "scope_id is required");
  }

  const scope = await findScopeByIdForDepartment(normalizedScopeId, user.department_id);

  if (!scope) {
    throw new AppError(404, "Scope not found for your department");
  }

  return listInstancesByScopeForDepartment(normalizedScopeId, user.department_id);
}

async function uploadProjectForUser(user, payload) {
  requireDepartment(user);

  if (!hasPermission(user, PERMISSIONS.UPLOAD_DATA)) {
    throw new AppError(403, "You do not have permission to upload project data");
  }

  if (!isDesignDepartment(user)) {
    throw new AppError(403, "This upload flow is only available to the Design department");
  }

  const normalizedRows = validateProjectUploadRows(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const skippedRows = [];
    let successCount = 0;

    for (const row of normalizedRows) {
      const duplicateMatch = await findExactDepartmentProjectMatch(
        user.department_id,
        row,
        client,
      );

      if (duplicateMatch) {
        skippedRows.push({
          row_number: row.row_number,
          project_no: row.project_no,
          project_name: row.project_name,
          customer_name: row.customer_name,
          scope_name: row.scope_name,
          instance_count: row.instance_count,
          rework_date: row.rework_date,
          reason: buildDuplicateReason(row),
        });
        continue;
      }

      const project = await upsertProjectByNumber({
        project_no: row.project_no,
        project_name: row.project_name,
        customer_name: row.customer_name,
        department_id: user.department_id,
        uploaded_by: user.employee_id,
      }, client);

      const scope = await findOrCreateScope(project.id, row.scope_name, client);
      const existingInstanceCount = await countInstancesForScope(scope.id, client);

      if (row.instance_count > existingInstanceCount) {
        await createInstancesForScope(
          scope.id,
          existingInstanceCount + 1,
          row.instance_count,
          client,
        );
      }

      if (row.rework_date) {
        await createReworksForScopeInstances(scope.id, row.rework_date, client);
      }

      await touchProject(project.id, client);

      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "project_uploaded",
        targetType: "project",
        targetId: project.id,
        metadata: {
          department_id: user.department_id,
          project_no: row.project_no,
          project_name: row.project_name,
          customer_name: row.customer_name,
          scope_name: row.scope_name,
          instance_count: row.instance_count,
          rework_date: row.rework_date,
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
    console.error("PROJECT_UPLOAD_ERROR:", {
      code: error?.code || null,
      detail: error?.detail || null,
      message: error?.message || null,
      department_id: user.department_id || null,
      employee_id: user.employee_id || null,
      row_count: normalizedRows.length,
    });

    if (error?.code === "23505") {
      throw new AppError(
        409,
        "A duplicate project catalog record was detected while processing the upload",
      );
    }

    if (error?.code === "23503") {
      throw new AppError(409, "Project upload references a department or related record that does not exist");
    }

    if (error?.code === "23502" || error?.code === "22P02") {
      throw new AppError(400, "Project upload contains invalid or incomplete data");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function createDesignTaskFromProject(user, payload = {}) {
  requireDesignDepartment(user);

  if (
    Object.prototype.hasOwnProperty.call(payload, "title")
  ) {
    throw new AppError(400, "Task title is generated automatically and cannot be provided manually");
  }

  const projectId = String(payload.project_id || "").trim();
  const scopeId = String(payload.scope_id || "").trim();
  const instanceId = String(payload.instance_id || "").trim();

  if (!projectId) {
    throw new AppError(400, "project_id is required");
  }

  if (!scopeId) {
    throw new AppError(400, "scope_id is required");
  }

  if (!instanceId) {
    throw new AppError(400, "instance_id is required");
  }

  const project = await findProjectByIdForDepartment(projectId, user.department_id);

  if (!project) {
    throw new AppError(404, "Project not found for your department");
  }

  const scope = await findScopeByIdForDepartment(scopeId, user.department_id);

  if (!scope || scope.project_id !== project.id) {
    throw new AppError(404, "Scope not found for the selected project");
  }

  const instance = await findInstanceByIdForDepartment(instanceId, user.department_id);

  if (!instance || instance.scope_id !== scope.id) {
    throw new AppError(404, "Instance not found for the selected scope");
  }

  const activeInstanceTasks = await listTasksForWorkflowInstance({
    departmentId: user.department_id,
    projectNo: project.project_no,
    scopeName: scope.scope_name,
    instanceCode: instance.instance_code,
    instanceIndex: instance.instance_index,
  });

  if (activeInstanceTasks.some((task) => task.status !== "closed")) {
    throw new AppError(409, "An active task already exists for this project, scope, and instance");
  }

  const scopedProject = await findDepartmentProjectByIdForDepartment(scopeId, user.department_id);

  return createTaskForUser(user, {
    ...payload,
    project_no: project.project_no,
    project_name: project.project_name,
    customer_name: project.customer_name,
    project_description: project.project_name,
    scope_name: scope.scope_name,
    quantity_index: instance.instance_code,
    instance_count: instance.instance_index,
    rework_date: scopedProject?.rework_date || null,
  });
}

module.exports = {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignInstancesForUser,
  listDesignProjectsForUser,
  listDesignScopesForUser,
  normalizeProjectPayload,
  uploadProjectForUser,
  validateProjectUploadRows,
};
