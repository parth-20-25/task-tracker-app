const { pool } = require("../db");
const { PROJECT_STATUSES } = require("../config/constants");
const { DEFAULT_WORKING_HOURS_PER_DAY } = require("../lib/projectScope");
const { buildVisibleUsersCte, owningLeaderPairSql } = require("./projectVisibility");
const { userIdentifierMatchSql } = require("./sqlFragments");

async function getWorkingHoursPerDay(client = pool) {
  const result = await client.query(`
    SELECT setting_value
    FROM design.project_planning_settings
    WHERE setting_key = 'working_hours_per_day'
    LIMIT 1
  `);
  return Number(result.rows[0]?.setting_value || DEFAULT_WORKING_HOURS_PER_DAY);
}

async function listActiveProjectFixtureScopeRows(client = pool) {
  const result = await client.query(`
    SELECT
      project.id AS project_id,
      project.project_no,
      project.project_name,
      project.project_name AS project_description,
      NULL::text AS priority,
      fixture.id AS fixture_id,
      fixture.fixture_no,
      fixture.fixture_type AS fixture_name,
      fixture.part_name AS fixture_description,
      fixture.fixture_type,
      fixture.part_name,
      fixture.remark,
      fixture.qty AS quantity,
      COALESCE(progress.stage_progress, '[]'::jsonb) AS stage_progress
    FROM design.projects project
    LEFT JOIN design.fixtures fixture ON fixture.project_id = project.id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'stage_name', workflow_progress.stage_name,
        'status', workflow_progress.status,
        'assigned_to', workflow_progress.assigned_to,
        'assignee_name', assignee.name
      ) ORDER BY workflow_progress.stage_order) AS stage_progress
      FROM fixture_workflow_progress workflow_progress
      LEFT JOIN users assignee
        ON assignee.employee_id = workflow_progress.assigned_to
        OR assignee.id::text = workflow_progress.assigned_to
      WHERE workflow_progress.fixture_id = fixture.id
    ) progress ON TRUE
    WHERE COALESCE(project.status, $1) = $1
    ORDER BY project.project_no, project.id, fixture.fixture_no
  `, [PROJECT_STATUSES.ACTIVE]);
  return result.rows;
}

async function listPlannedTimeRows(projectIds, client = pool) {
  if (!projectIds.length) return [];
  const result = await client.query(`
    SELECT project_id, stage, normalized_hours, entered_value, entered_unit, version, updated_at
    FROM design.project_planned_time
    WHERE project_id = ANY($1::uuid[])
    ORDER BY project_id, stage
  `, [projectIds]);
  return result.rows;
}

async function findActiveProject(projectId, client = pool) {
  const result = await client.query(`
    SELECT id AS project_id, project_no, project_name, status, created_by_user_id, uploaded_by
    FROM design.projects
    WHERE id = $1::uuid
      AND COALESCE(status, $2) = $2
    LIMIT 1
  `, [projectId, PROJECT_STATUSES.ACTIVE]);
  return result.rows[0] || null;
}

async function isOwningThreeDPlanner(employeeId, projectId, client = pool) {
  const result = await client.query(`
    ${buildVisibleUsersCte("$1")}
    SELECT ${owningLeaderPairSql("project")} AS allowed
    FROM design.projects project
    WHERE project.id = $2::uuid
    LIMIT 1
  `, [employeeId, projectId]);
  return result.rows[0]?.allowed === true;
}

function linkedTwoDPlannerPredicate(plannerAlias = "planner", assignmentAlias = "assignment") {
  return `(
    ${assignmentAlias}.assigned_leader_id = ${plannerAlias}.employee_id
    OR EXISTS (
      SELECT 1
      FROM users assigned_planner
      WHERE ${userIdentifierMatchSql("assigned_planner", `${assignmentAlias}.assigned_leader_id`)}
        AND (
          ${plannerAlias}.parent_id::text IN (assigned_planner.id::text, assigned_planner.employee_id)
          OR assigned_planner.parent_id::text IN (${plannerAlias}.id::text, ${plannerAlias}.employee_id)
        )
    )
  )`;
}

async function isAssignedTwoDPlanner(employeeId, projectId, client = pool) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM users planner
      JOIN department_subdivisions planner_subdivision ON planner_subdivision.id = planner.subdivision_id
      JOIN design.project_subdivision_assignments assignment ON assignment.project_id = $2::uuid AND assignment.is_active = TRUE
      JOIN department_subdivisions assignment_subdivision ON assignment_subdivision.id = assignment.subdivision_id
      WHERE ${userIdentifierMatchSql("planner", "$1")}
        AND COALESCE(planner.is_active, TRUE) = TRUE
        AND LOWER(BTRIM(planner_subdivision.subdivision_name)) = '2d'
        AND LOWER(BTRIM(assignment_subdivision.subdivision_name)) = '2d'
        AND ${linkedTwoDPlannerPredicate()}
    ) AS allowed
  `, [employeeId, projectId]);
  return result.rows[0]?.allowed === true;
}

async function listPlannerProjectRows(user, team, client = pool) {
  const employeeId = user.employee_id;
  const accessJoin = team === "3D"
    ? `${buildVisibleUsersCte("$1")}
       SELECT project.id AS project_id, project.project_no, project.project_name,
              planned.stage, planned.normalized_hours, planned.entered_value, planned.entered_unit, planned.version, planned.updated_at
       FROM design.projects project
       LEFT JOIN design.project_planned_time planned ON planned.project_id = project.id
       WHERE COALESCE(project.status, $2) = $2
         AND ${owningLeaderPairSql("project")}`
    : `SELECT DISTINCT project.id AS project_id, project.project_no, project.project_name,
              planned.stage, planned.normalized_hours, planned.entered_value, planned.entered_unit, planned.version, planned.updated_at
       FROM users planner
       JOIN department_subdivisions planner_subdivision ON planner_subdivision.id = planner.subdivision_id
       JOIN design.project_subdivision_assignments assignment ON assignment.is_active = TRUE
       JOIN department_subdivisions assignment_subdivision ON assignment_subdivision.id = assignment.subdivision_id
       JOIN design.projects project ON project.id = assignment.project_id
       LEFT JOIN design.project_planned_time planned ON planned.project_id = project.id
       WHERE ${userIdentifierMatchSql("planner", "$1")}
         AND COALESCE(planner.is_active, TRUE) = TRUE
         AND LOWER(BTRIM(planner_subdivision.subdivision_name)) = '2d'
         AND LOWER(BTRIM(assignment_subdivision.subdivision_name)) = '2d'
         AND COALESCE(project.status, $2) = $2
         AND ${linkedTwoDPlannerPredicate()}`;

  const result = await client.query(`${accessJoin} ORDER BY project.project_no, planned.stage`, [employeeId, PROJECT_STATUSES.ACTIVE]);
  return result.rows;
}

async function getProjectPlanningRows(projectId, client = pool) {
  const result = await client.query(`
    SELECT stage, entered_value, entered_unit, normalized_hours, version, updated_at
    FROM design.project_planned_time
    WHERE project_id = $1::uuid
    ORDER BY stage
  `, [projectId]);
  return result.rows;
}

async function insertProjectPlanningStage(values, client) {
  return client.query(`
    INSERT INTO design.project_planned_time (
      project_id, stage, entered_value, entered_unit, normalized_hours, updated_by, version, updated_at
    )
    VALUES ($1::uuid, $2, $3, $4, $5, $6, 1, NOW())
    ON CONFLICT (project_id, stage) DO NOTHING
    RETURNING *
  `, [values.projectId, values.stage, values.enteredValue, values.unit, values.normalizedHours, values.updatedBy]);
}

async function updateProjectPlanningStage(values, client) {
  return client.query(`
    UPDATE design.project_planned_time
    SET entered_value = $3,
        entered_unit = $4,
        normalized_hours = $5,
        updated_by = $6,
        updated_at = NOW(),
        version = version + 1
    WHERE project_id = $1::uuid
      AND stage = $2
      AND version = $7
    RETURNING *
  `, [values.projectId, values.stage, values.enteredValue, values.unit, values.normalizedHours, values.updatedBy, values.expectedVersion]);
}

module.exports = {
  findActiveProject,
  getProjectPlanningRows,
  getWorkingHoursPerDay,
  insertProjectPlanningStage,
  isAssignedTwoDPlanner,
  isOwningThreeDPlanner,
  listActiveProjectFixtureScopeRows,
  listPlannedTimeRows,
  listPlannerProjectRows,
  updateProjectPlanningStage,
};