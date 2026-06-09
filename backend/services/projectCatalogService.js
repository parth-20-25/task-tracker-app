const { PROJECT_STATUSES, TASK_STATUSES } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { normalizeDesignStageName } = require("../lib/designWorkflowStages");
const { instrumentModuleExports } = require("../lib/observability");
const { pool } = require("../db");
const {
  resolveAccessibleDepartmentId,
  requireUserDepartment,
} = require("../lib/departmentContext");
const { isDesignDepartment } = require("../lib/designDepartment");
const {
  findFixtureByIdForUser,
  findProjectByIdForUser,
  getProjectModificationContextForUser,
  listDepartmentProjectsForUser: listDepartmentProjectsByUserVisibility,
  listFixturesByProjectForUser,
  listProjectSummariesForUser: listProjectSummariesByUserVisibility,
  listRecentOutsourceSuppliersForUser: listRecentOutsourceSuppliersByUserVisibility,
  touchProject,
  updateFixtureOutsourcingState,
  updateProjectModificationFlag,
  upsertProjectByNumber,
} = require("../repositories/designProjectCatalogRepository");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  getConfiguredWorkflowForDepartment,
  getProgressForFixture,
  startStageAttempt,
  updateProgressRow,
} = require("../repositories/fixtureWorkflowRepository");
const { insertStageContribution, listStageContributions } = require("../repositories/designStageContributionRepository");
const { formatStageRevisionCode, normalizeStageVersion } = require("../lib/workflowStageVersioning");
const { createTaskForUser } = require("./taskService");
const { getCurrentStage } = require("./fixtureWorkflowService");
const {
  DESIGN_2D_SUBDIVISION_NAME,
  is2DLeaderUser,
  isProjectAssignedTo2DLeader,
  projectHasActive2DRouting,
} = require("../repositories/projectSubdivisionRoutingRepository");

function requireDepartment(user) {
  requireUserDepartment(user, "A department is required for project data access");
}

function requireDesignDepartment(user) {
  requireDepartment(user);

  if (!isDesignDepartment(user)) {
    throw new AppError(403, "This flow is only available to the Design department");
  }
}

function normalizeProjectStatus(status) {
  return String(status || "active").trim().toLowerCase();
}

function isTerminalProjectStatus(status) {
  return [PROJECT_STATUSES.COMPLETED, PROJECT_STATUSES.RELEASED].includes(normalizeProjectStatus(status));
}

function shouldHideProjectFromActiveSelection(project) {
  const status = normalizeProjectStatus(project?.project_status);
  if (status !== PROJECT_STATUSES.ACTIVE) {
    return true;
  }

  const completionPercent = Number(project?.completion_percent ?? project?.project_completion_percent);
  if (Number.isFinite(completionPercent) && completionPercent >= 100) {
    return true;
  }

  if (project?.completion_strict_complete === true) {
    return true;
  }

  const totalFixtures = Number(project?.total_fixtures || 0);
  const completedFixtures = Number(project?.completed_tasks ?? project?.completed_fixtures ?? 0);
  return totalFixtures > 0 && completedFixtures >= totalFixtures;
}

function mapProjectSummaryToOption(project) {
  return {
    project_id: project.project_id,
    project_code: project.project_no,
    project_name: project.project_name,
    company_name: project.customer_name,
    department_id: project.department_id,
    project_status: project.project_status,
    is_modified: project.is_modified === true,
  };
}

function validateResolvedDesignTaskContext({ projectId, fixtureId, currentStage, currentStageKey, currentWorkflowStage }) {
  if (!projectId) {
    throw new AppError(400, "project_id is required");
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
  return listDepartmentProjectsByUserVisibility(user, null);
}

function is2DStage(stageName) {
  return normalizeDesignStageName(stageName) === "2d_finish";
}

async function assertSubdivisionRoutingAssignmentAllowed({
  actor,
  assigneeEmployeeId,
  projectId,
  currentStageName,
  client,
}) {
  if (!is2DStage(currentStageName)) {
    return;
  }

  const has2DRouting = await projectHasActive2DRouting(projectId, client);
  const assignee = await require("../repositories/usersRepository").findUserByEmployeeId(assigneeEmployeeId, client);

  if (has2DRouting) {
    if (!is2DLeaderUser(actor)) {
      const { isAdmin, isProjectAuthorityRole } = require("./accessControlService");
      if (!isAdmin(actor) && !isProjectAuthorityRole(actor)) {
        throw new AppError(403, "Only assigned 2D routing leaders can assign routed 2D-stage fixtures");
      }
    } else if (!(await isProjectAssignedTo2DLeader(projectId, actor.employee_id, client))) {
      throw new AppError(403, "Only assigned 2D routing leaders can assign routed 2D-stage fixtures");
    }

    if (String(assignee?.subdivision?.subdivision_name || "").trim().toLowerCase() !== DESIGN_2D_SUBDIVISION_NAME.toLowerCase()) {
      throw new AppError(400, "Routed 2D-stage fixtures can only be assigned to Design 2D subdivision users");
    }
  }
}

async function listDesignProjectsForUser(user, requestedDepartmentId, options = {}) {
  const requested = String(requestedDepartmentId || "").trim();
  const departmentId = requested
    ? resolveAccessibleDepartmentId(user, requested, "A department is required for project data access")
    : null;

  const summaries = await listProjectSummariesByUserVisibility(user, { departmentId });
  return summaries
    .filter((project) => options.activeOnly !== true || !shouldHideProjectFromActiveSelection(project))
    .map(mapProjectSummaryToOption);
}

async function listDesignFixturesForUser(user, projectId, requestedDepartmentId, options = {}) {
  const normalizedProjectId = String(
    typeof projectId === "object" && projectId !== null ? projectId.project_id : projectId || "",
  ).trim();

  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required");
  }

  const { resolveProjectDepartmentForUser } = require("./visibilityResolutionService");
  const requested = String(requestedDepartmentId || "").trim();
  const requestedDepartmentContext = requested
    ? resolveAccessibleDepartmentId(user, requested, "A department is required for project data access")
    : null;
  const departmentId = await resolveProjectDepartmentForUser(
    user,
    normalizedProjectId,
    requestedDepartmentContext,
  );

  if (!departmentId) {
    throw new AppError(400, "A department is required for project data access");
  }

  const project = await findProjectByIdForUser(
    normalizedProjectId,
    user,
    departmentId,
    { activeOnly: false },
  );

  if (!project) {
    throw new AppError(
      options.activeOnly === true ? 409 : 404,
      options.activeOnly === true
        ? "Project is not active for assignment"
        : "Project not found for the selected department",
    );
  }

  if (options.activeOnly === true) {
    const summaries = await listProjectSummariesByUserVisibility(user, { departmentId });
    const summary = summaries.find((item) => item.project_id === normalizedProjectId) || project;
    if (shouldHideProjectFromActiveSelection(summary)) {
      throw new AppError(409, "Project is not active for assignment");
    }
  }

  return listFixturesByProjectForUser(
    normalizedProjectId,
    user,
    departmentId,
    { activeOnly: options.activeOnly === true },
  );
}

async function listProjectDashboardForUser(user, requestedDepartmentId) {
  const departmentId = requestedDepartmentId
    ? resolveAccessibleDepartmentId(user, requestedDepartmentId, "A department is required for project dashboard access")
    : null;

  return listProjectSummariesByUserVisibility(user, { departmentId });
}

function normalizeProjectUploadRow(row = {}) {
  return {
    project_no: String(row.project_no || "").trim(),
    project_name: String(row.project_name || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
    instance_count: Number(row.instance_count),
    rework_date: row.rework_date || null,
  };
}

function validateProjectUploadRow(row) {
  if (!row.project_no || !row.project_name || !row.customer_name) {
    return "project_no, project_name, and customer_name are required";
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
        created_by_user_id: user.employee_id,
      }, client);

      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "DESIGN_PROJECT_IMPORTED",
        targetType: "design_project",
        targetId: project.project_id || normalizedRow.project_no,
        metadata: {
          project_id: project.project_id,
          project_code: normalizedRow.project_no,
          project_name: normalizedRow.project_name,
          customer_name: normalizedRow.customer_name,
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
  const fixtureId = String(payload.fixture_id || "").trim();
  validateResolvedDesignTaskContext({ projectId, fixtureId });

  const departmentId = resolveAccessibleDepartmentId(
    user,
    payload.department_id,
    "A department is required to create workflow tasks",
  );
  const project = await findProjectByIdForUser(projectId, user, departmentId, { activeOnly: true });
  if (!project) {
    throw new AppError(409, "Project is not active for assignment");
  }

  const summaries = await listProjectSummariesByUserVisibility(user, { departmentId });
  const projectSummary = summaries.find((item) => item.project_id === project.project_id);
  if (projectSummary && shouldHideProjectFromActiveSelection(projectSummary)) {
    throw new AppError(409, "Project is not active for assignment");
  }

  const fixture = await findFixtureByIdForUser(fixtureId, user, departmentId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  if (fixture.project_id !== project.project_id) {
    throw new AppError(409, "fixture_id does not belong to the selected project");
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

  if (currentStageKey === "release") {
    throw new AppError(400, "Release is not a task assignment stage. Use the workflow release action.");
  }

  validateResolvedDesignTaskContext({
    projectId,
    fixtureId,
    currentStage,
    currentStageKey,
    currentWorkflowStage,
  });

  if (!workflow?.id) {
    throw new AppError(409, "Current workflow stage could not be resolved for this fixture");
  }

  const client = await pool.connect();
  let task = null;

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT id FROM fixture_workflow_progress WHERE fixture_id = $1::uuid AND department_id = $2 FOR UPDATE",
      [fixture.fixture_id, departmentId],
    );

    const lockedProgress = await getProgressForFixture(fixture.fixture_id, departmentId, client);
    const lockedCurrentStage = lockedProgress.find((stage) => stage.status !== "APPROVED") || null;
    if (!lockedCurrentStage) {
      throw new AppError(409, "Fixture is fully completed");
    }

    if (!["PENDING", "REJECTED"].includes(lockedCurrentStage.status)) {
      throw new AppError(409, `Stage is not assignable in status ${lockedCurrentStage.status}`);
    }

    const assignedTo = String(payload.assigned_to || "").trim();
    await assertSubdivisionRoutingAssignmentAllowed({
      actor: user,
      assigneeEmployeeId: assignedTo,
      projectId: project.project_id,
      currentStageName: lockedCurrentStage.stage_name,
      client,
    });

    const timestamp = new Date();
    await updateProgressRow(fixture.fixture_id, lockedCurrentStage.stage_name, {
      status: "IN_PROGRESS",
      assigned_to: assignedTo,
      assigned_at: timestamp,
      started_at: timestamp,
      completed_at: null,
      duration_minutes: null,
    }, client);
    await startStageAttempt(fixture.fixture_id, departmentId, lockedCurrentStage.stage_name, assignedTo, timestamp, client);

    const revisionNo = normalizeStageVersion(lockedCurrentStage.stage_version);
    const revisionCode = formatStageRevisionCode(lockedCurrentStage.stage_name, revisionNo);
    const contributions = await listStageContributions(fixture.fixture_id, lockedCurrentStage.stage_name, revisionCode, client);
    if (contributions.length === 0) {
      await insertStageContribution({
        fixture_id: fixture.fixture_id,
        department_id: departmentId,
        stage_name: lockedCurrentStage.stage_name,
        revision_code: revisionCode,
        stage_revision_no: revisionNo,
        employee_id: assignedTo,
        contribution_percent: 100,
        contribution_kind: "REMAINING",
        changed_by: user.employee_id,
        previous_stage: lockedCurrentStage.stage_name,
        metadata: { source: "assignment_transaction" },
      }, client);
    }

    task = await createTaskForUser(user, {
      ...payload,
      project_id: project.project_id,
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
      project_no: project.project_code,
      project_name: project.project_name,
      customer_name: project.company_name,
      project_description: project.project_name,
      quantity_index: fixture.fixture_no,
      instance_count: fixture.qty,
      current_stage_id: currentWorkflowStage.id,
      rework_date: null,
    }, { client, skipAnalyticsRefresh: true });

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "design_fixture_assigned_transaction",
      targetType: "design_fixture",
      targetId: fixture.fixture_id,
      metadata: {
        task_id: task.id,
        assigned_to: assignedTo,
        stage_name: lockedCurrentStage.stage_name,
        workflow_status: "IN_PROGRESS",
      },
    }, client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return task;
}

async function updateProjectModificationForUser(user, projectId, payload = {}) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required");
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "is_modified")) {
    throw new AppError(400, "is_modified is required");
  }

  const context = await getProjectModificationContextForUser(normalizedProjectId, user);
  if (!context) {
    throw new AppError(404, "Project not found");
  }

  if (isTerminalProjectStatus(context.project_status)) {
    throw new AppError(409, "Released or completed projects cannot be modified");
  }

  if (context.can_toggle_modification !== true) {
    throw new AppError(403, "You do not have permission to toggle project modification status");
  }

  const project = await updateProjectModificationFlag(normalizedProjectId, payload.is_modified === true);

  await createAuditLog({
    userEmployeeId: user.employee_id,
    actionType: project.is_modified ? "PROJECT_MARKED_MODIFIED" : "PROJECT_MARKED_UNMODIFIED",
    targetType: "design_project",
    targetId: normalizedProjectId,
    metadata: {
      project_no: context.project_no,
      previous_is_modified: context.is_modified === true,
      next_is_modified: project.is_modified === true,
    },
  });

  return project;
}

async function updateFixtureOutsourcingForUser(user, fixtureId, payload = {}) {
  const normalizedFixtureId = String(fixtureId || "").trim();
  if (!normalizedFixtureId) {
    throw new AppError(400, "fixture_id is required");
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "is_outsourced")) {
    throw new AppError(400, "is_outsourced is required");
  }

  const requestedDepartmentId = String(payload.department_id || "").trim();
  const departmentId = requestedDepartmentId
    ? resolveAccessibleDepartmentId(user, requestedDepartmentId, "Invalid department context")
    : null;
  const nextIsOutsourced = payload.is_outsourced === true;
  const vendorName = String(payload.vendor_name || "").trim();

  if (nextIsOutsourced && !vendorName) {
    throw new AppError(400, "Supplier Name is required when outsourcing a fixture");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const fixture = await findFixtureByIdForUser(normalizedFixtureId, user, departmentId, client);
    if (!fixture) {
      throw new AppError(404, "Fixture not found");
    }

    const updatedFixture = await updateFixtureOutsourcingState({
      fixtureId: fixture.fixture_id,
      isOutsourced: nextIsOutsourced,
      vendorName: nextIsOutsourced ? vendorName : null,
      changedBy: user.employee_id,
    }, client);

    await touchProject(updatedFixture.project_id, client);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: nextIsOutsourced ? "DESIGN_FIXTURE_OUTSOURCED" : "DESIGN_FIXTURE_BROUGHT_IN_HOUSE",
      targetType: "design_fixture",
      targetId: updatedFixture.fixture_id,
      metadata: {
        project_id: updatedFixture.project_id,
        fixture_no: updatedFixture.fixture_no,
        previous_is_outsourced: fixture.is_outsourced === true,
        next_is_outsourced: updatedFixture.is_outsourced === true,
        previous_vendor_name: fixture.vendor_name || null,
        next_vendor_name: updatedFixture.vendor_name || null,
      },
    }, client);

    await client.query("COMMIT");
    return updatedFixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listRecentOutsourceSuppliersForUser(user, requestedDepartmentId = null) {
  const requested = String(requestedDepartmentId || "").trim();
  const departmentId = requested
    ? resolveAccessibleDepartmentId(user, requested, "Invalid department context")
    : null;

  return listRecentOutsourceSuppliersByUserVisibility(user, departmentId, 6);
}

module.exports = instrumentModuleExports("service.projectCatalogService", {
  createDesignTaskFromProject,
  listDepartmentProjectsForUser,
  listDesignFixturesForUser,
  listDesignProjectsForUser,
  listProjectDashboardForUser,
  listRecentOutsourceSuppliersForUser,
  updateFixtureOutsourcingForUser,
  updateProjectModificationForUser,
  uploadDepartmentProjectsForUser,
});
