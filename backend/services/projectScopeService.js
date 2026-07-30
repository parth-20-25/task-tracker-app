const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const {
  PLANNING_STAGES,
  buildScopeRows,
  editableStagesForTeam,
  getPlanningTeam,
  hasMissingEditablePlanningStage,
  isPlanningLeaderRole,
  isScopeExecutiveRole,
  normalizePlannedTimeValue,
} = require("../lib/projectScope");
const { createAuditLog } = require("../repositories/auditRepository");
const projectScopeRepository = require("../repositories/projectScopeRepository");
const { hasPermission, isAdmin } = require("./accessControlService");
const { pool } = require("../db");

function assertProjectScopeAccess(user) {
  if (!isAdmin(user) && (!hasPermission(user, PERMISSIONS.VIEW_PROJECT_SCOPE) || !isScopeExecutiveRole(user))) {
    throw new AppError(403, "Project Scope is limited to Admin, CEO, and Director users");
  }
}

function assertPlanningIdentity(user) {
  const team = getPlanningTeam(user);
  if (!hasPermission(user, PERMISSIONS.EDIT_PROJECT_PLANNED_TIME) || !isPlanningLeaderRole(user) || !team) {
    throw new AppError(403, "Project planned-time permission is required");
  }
  return team;
}

async function resolveProjectPlanningAccess(user, projectId, client = pool) {
  const team = assertPlanningIdentity(user);
  const project = await projectScopeRepository.findActiveProject(projectId, client);
  if (!project) throw new AppError(404, "Active project not found");

  const mapped = team === "3D"
    ? await projectScopeRepository.isOwningThreeDPlanner(user.employee_id, projectId, client)
    : await projectScopeRepository.isAssignedTwoDPlanner(user.employee_id, projectId, client);
  if (!mapped) throw new AppError(403, "You are not an assigned planning Leader or Co-Leader for this project");

  return { project, team, editableStages: editableStagesForTeam(team) };
}

function mapPlanningRows(rows) {
  const stages = Object.fromEntries(PLANNING_STAGES.map((stage) => [stage, {
    entered_value: null,
    entered_unit: "HOURS",
    normalized_hours: null,
    version: 0,
    updated_at: null,
  }]));
  for (const row of rows) {
    stages[row.stage] = {
      entered_value: row.entered_value === null ? null : Number(row.entered_value),
      entered_unit: row.entered_unit,
      normalized_hours: row.normalized_hours === null ? null : Number(row.normalized_hours),
      version: Number(row.version),
      updated_at: row.updated_at,
    };
  }
  return stages;
}

async function listProjectScopeForUser(user) {
  assertProjectScopeAccess(user);
  const fixtureRows = await projectScopeRepository.listActiveProjectFixtureScopeRows();
  const projectIds = [...new Set(fixtureRows.map((row) => row.project_id))];
  const [plannedRows, workingHoursPerDay] = await Promise.all([
    projectScopeRepository.listPlannedTimeRows(projectIds),
    projectScopeRepository.getWorkingHoursPerDay(),
  ]);
  const plannedByProject = new Map();
  for (const row of plannedRows) {
    if (!plannedByProject.has(row.project_id)) plannedByProject.set(row.project_id, {});
    plannedByProject.get(row.project_id)[row.stage] = row.normalized_hours === null ? null : Number(row.normalized_hours);
  }
  return { working_hours_per_day: workingHoursPerDay, projects: buildScopeRows(fixtureRows, plannedByProject, workingHoursPerDay) };
}

async function getProjectPlannedTimeForUser(user, projectId) {
  const access = await resolveProjectPlanningAccess(user, projectId);
  const [rows, workingHoursPerDay] = await Promise.all([
    projectScopeRepository.getProjectPlanningRows(projectId),
    projectScopeRepository.getWorkingHoursPerDay(),
  ]);
  return {
    project: access.project,
    team: access.team,
    editable_stages: access.editableStages,
    working_hours_per_day: workingHoursPerDay,
    stages: mapPlanningRows(rows),
  };
}

async function listPendingProjectPlanningForUser(user) {
  const team = assertPlanningIdentity(user);
  const [rows, workingHoursPerDay] = await Promise.all([
    projectScopeRepository.listPlannerProjectRows(user, team),
    projectScopeRepository.getWorkingHoursPerDay(),
  ]);
  const projects = new Map();
  for (const row of rows) {
    if (!projects.has(row.project_id)) {
      projects.set(row.project_id, {
        project: { project_id: row.project_id, project_no: row.project_no, project_name: row.project_name },
        rows: [],
      });
    }
    if (row.stage) projects.get(row.project_id).rows.push(row);
  }
  const editableStages = editableStagesForTeam(team);
  return {
    team,
    editable_stages: editableStages,
    working_hours_per_day: workingHoursPerDay,
    projects: [...projects.values()]
      .map(({ project, rows: plannedRows }) => ({ ...project, stages: mapPlanningRows(plannedRows) }))
      .filter((project) => hasMissingEditablePlanningStage(project.stages, editableStages)),
  };
}

async function saveProjectPlannedTimeForUser(user, projectId, payload = {}) {
  const access = await resolveProjectPlanningAccess(user, projectId);
  const unit = String(payload.unit || "").trim().toUpperCase();
  if (!['HOURS', 'DAYS'].includes(unit)) throw new AppError(400, "unit must be HOURS or DAYS");
  const updates = payload.stages && typeof payload.stages === "object" ? payload.stages : {};
  const requestedStages = Object.keys(updates);
  if (!requestedStages.length) throw new AppError(400, "At least one planned stage value is required");
  if (requestedStages.some((stage) => !PLANNING_STAGES.includes(stage))) throw new AppError(400, "Unsupported planned-time stage");
  if (requestedStages.some((stage) => !access.editableStages.includes(stage))) throw new AppError(403, "You cannot edit one or more requested planning stages");

  const workingHoursPerDay = await projectScopeRepository.getWorkingHoursPerDay();
  const existingRows = await projectScopeRepository.getProjectPlanningRows(projectId);
  const existingByStage = new Map(existingRows.map((row) => [row.stage, row]));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stage of requestedStages) {
      const update = updates[stage] || {};
      const expectedVersion = Number(update.version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new AppError(400, `A valid version is required for ${stage}`);
      let normalized;
      try {
        normalized = normalizePlannedTimeValue(update.value, unit, workingHoursPerDay);
      } catch (error) {
        throw new AppError(400, error.message);
      }
      const values = {
        projectId,
        stage,
        enteredValue: normalized.enteredValue,
        normalizedHours: normalized.normalizedHours,
        unit,
        updatedBy: user.employee_id,
        expectedVersion,
      };
      const result = expectedVersion === 0
        ? await projectScopeRepository.insertProjectPlanningStage(values, client)
        : await projectScopeRepository.updateProjectPlanningStage(values, client);
      if (result.rowCount !== 1) throw new AppError(409, `Planned time for ${stage} was updated by another user. Reload and try again.`);
      const previous = existingByStage.get(stage) || null;
      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "project_planned_time_updated",
        targetType: "design_project",
        targetId: projectId,
        metadata: {
          project_id: projectId,
          stage,
          previous_value: previous?.entered_value === null || previous?.entered_value === undefined ? null : Number(previous.entered_value),
          new_value: normalized.enteredValue,
          entered_unit: unit,
          normalized_hours: normalized.normalizedHours,
          previous_version: previous ? Number(previous.version) : 0,
          new_version: Number(result.rows[0].version),
          updated_by: user.employee_id,
          updated_at: result.rows[0].updated_at,
        },
      }, client);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getProjectPlannedTimeForUser(user, projectId);
}

module.exports = {
  assertPlanningIdentity,
  assertProjectScopeAccess,
  getProjectPlannedTimeForUser,
  listPendingProjectPlanningForUser,
  listProjectScopeForUser,
  mapPlanningRows,
  resolveProjectPlanningAccess,
  saveProjectPlannedTimeForUser,
};