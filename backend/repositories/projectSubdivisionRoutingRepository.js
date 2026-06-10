const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const {
  PROJECT_AUTHORITY_ROLE_KEYS,
  buildVisibleUsersCte,
  identifierInVisibleUsersSql,
  normalizeRoleKey,
} = require("./projectVisibility");
const { userIdentifierMatchSql } = require("./sqlFragments");

const DESIGN_2D_SUBDIVISION_NAME = "2D";
const DESIGN_DEPARTMENT_KEYS = ["design"];
const DESIGN_2D_LEADER_ROLE_KEYS = ["team_leader", "line_manager", "co_leader", "team_co_leader", "shift_incharge"];
const DESIGN_2D_STAGE_KEYS = ["2d", "2d_finish", "two_d", "two_d_finish"];

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

function roleKeySql(expression) {
  return `LOWER(BTRIM(REGEXP_REPLACE(COALESCE(${expression}, ''), '[^[:alnum:]]+', '_', 'g'), '_'))`;
}

function designDepartmentSql(alias = "d") {
  return `(${roleKeySql(`${alias}.id`)} = ANY(${sqlTextArray(DESIGN_DEPARTMENT_KEYS)}) OR ${roleKeySql(`${alias}.name`)} = ANY(${sqlTextArray(DESIGN_DEPARTMENT_KEYS)}))`;
}

function twoDSubdivisionSql(alias = "ds") {
  return `LOWER(BTRIM(COALESCE(${alias}.subdivision_name, ''))) = LOWER(${sqlLiteral(DESIGN_2D_SUBDIVISION_NAME)})`;
}

function twoDStageNameSql(expression) {
  return `${roleKeySql(expression)} = ANY(${sqlTextArray(DESIGN_2D_STAGE_KEYS)})`;
}

function assignedTo2DLeaderProjectSql(projectAlias = "p", employeeIdExpression = "root.employee_id") {
  return `
    EXISTS (
      SELECT 1
      FROM design.project_subdivision_assignments psa_2d
      JOIN department_subdivisions ds_2d
        ON ds_2d.id = psa_2d.subdivision_id
      WHERE psa_2d.project_id = ${projectAlias}.id
        AND psa_2d.assigned_leader_id = ${employeeIdExpression}
        AND psa_2d.is_active = TRUE
        AND ds_2d.is_active = TRUE
        AND ${twoDSubdivisionSql("ds_2d")}
    )
  `;
}

function current2DWorkflowStageFixtureSql(fixtureAlias = "f", projectAlias = "p") {
  return `
    EXISTS (
      SELECT 1
      FROM fixture_workflow_progress current_2d_progress
      WHERE current_2d_progress.fixture_id = ${fixtureAlias}.id
        AND current_2d_progress.department_id = ${projectAlias}.department_id
        AND current_2d_progress.status <> 'APPROVED'
        AND ${twoDStageNameSql("current_2d_progress.stage_name")}
        AND current_2d_progress.stage_order = (
          SELECT MIN(active_progress.stage_order)
          FROM fixture_workflow_progress active_progress
          WHERE active_progress.fixture_id = ${fixtureAlias}.id
            AND active_progress.department_id = ${projectAlias}.department_id
            AND active_progress.status <> 'APPROVED'
        )
    )
  `;
}

function userIs2DSubdivisionSql(userAlias = "root") {
  return `
    EXISTS (
      SELECT 1
      FROM department_subdivisions root_subdivision
      WHERE root_subdivision.id = ${userAlias}.subdivision_id
        AND root_subdivision.is_active = TRUE
        AND ${twoDSubdivisionSql("root_subdivision")}
    )
  `;
}

function userIs2DLeaderSql(userAlias = "root") {
  return `
    (
      ${userIs2DSubdivisionSql(userAlias)}
      AND (
        ${userAlias}.role_key = ANY(${sqlTextArray(DESIGN_2D_LEADER_ROLE_KEYS)})
        OR ${userAlias}.role_id_key = ANY(${sqlTextArray(DESIGN_2D_LEADER_ROLE_KEYS)})
      )
    )
  `;
}

function userIs2DNonLeaderSql(userAlias = "root") {
  return `
    (
      ${userIs2DSubdivisionSql(userAlias)}
      AND NOT (
        ${userAlias}.role_key = ANY(${sqlTextArray(DESIGN_2D_LEADER_ROLE_KEYS)})
        OR ${userAlias}.role_id_key = ANY(${sqlTextArray(DESIGN_2D_LEADER_ROLE_KEYS)})
      )
    )
  `;
}

function is2DLeaderUser(user) {
  const subdivisionName = String(user?.subdivision?.subdivision_name || "").trim().toLowerCase();
  const roleKey = normalizeRoleKey(user?.role?.name || user?.role_id || user?.role);

  return subdivisionName === "2d" && DESIGN_2D_LEADER_ROLE_KEYS.includes(roleKey);
}

function is2DSubdivisionUser(user) {
  return String(user?.subdivision?.subdivision_name || "").trim().toLowerCase() === "2d";
}

function mapAssignmentRow(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    subdivision_id: row.subdivision_id,
    subdivision_name: row.subdivision_name,
    assigned_leader_id: row.assigned_leader_id,
    assigned_leader_name: row.assigned_leader_name || null,
    assigned_by: row.assigned_by || null,
    assigned_by_name: row.assigned_by_name || null,
    created_at: row.created_at,
    is_active: row.is_active !== false,
  };
}

async function findProjectForRouting(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT p.id, p.department_id, p.uploaded_by, p.created_by_user_id
      FROM design.projects p
      WHERE p.id = $1
      LIMIT 1
    `,
    [projectId],
  );

  return result.rows[0] || null;
}

async function canManageProject2DRouting(user, projectId, client = pool) {
  if (!user?.employee_id) {
    return false;
  }

  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT 1
      FROM design.projects p
      WHERE p.id = $2
        AND (
          EXISTS (
            SELECT 1
            FROM root_user root
            WHERE root.role_key = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
               OR root.role_id_key = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
          )
          OR ${identifierInVisibleUsersSql("p.created_by_user_id")}
          OR ${identifierInVisibleUsersSql("p.uploaded_by")}
        )
      LIMIT 1
    `,
    [user.employee_id, projectId],
  );

  return result.rowCount > 0;
}

async function resolve2DSubdivisionForProject(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT ds.id, ds.department_id, ds.subdivision_name
      FROM design.projects p
      JOIN departments d
        ON d.id = p.department_id
      JOIN department_subdivisions ds
        ON ds.department_id = p.department_id
      WHERE p.id = $1
        AND ds.is_active = TRUE
        AND ${designDepartmentSql("d")}
        AND ${twoDSubdivisionSql("ds")}
      LIMIT 1
    `,
    [projectId],
  );

  return result.rows[0] || null;
}

async function list2DLeadersForProject(projectId, client = pool) {
  const project = await findProjectForRouting(projectId, client);
  if (!project) {
    throw new AppError(404, "Project not found");
  }

  const result = await client.query(
    `
      SELECT
        u.employee_id,
        u.name,
        u.department_id,
        u.subdivision_id,
        r.id AS role_id,
        r.name AS role_name,
        ds.subdivision_name
      FROM users u
      JOIN departments d
        ON d.id = u.department_id
      JOIN department_subdivisions ds
        ON ds.id = u.subdivision_id
       AND ds.department_id = u.department_id
      LEFT JOIN roles r
        ON r.id = u.role
      WHERE u.department_id = $1
        AND COALESCE(u.is_active, TRUE) = TRUE
        AND ds.is_active = TRUE
        AND ${designDepartmentSql("d")}
        AND ${twoDSubdivisionSql("ds")}
        AND (
          ${roleKeySql("COALESCE(r.name, u.role)")} = ANY(${sqlTextArray(DESIGN_2D_LEADER_ROLE_KEYS)})
          OR ${roleKeySql("u.role")} = ANY(${sqlTextArray(DESIGN_2D_LEADER_ROLE_KEYS)})
        )
      ORDER BY u.name ASC, u.employee_id ASC
    `,
    [project.department_id],
  );

  return result.rows.map((row) => ({
    employee_id: row.employee_id,
    name: row.name,
    department_id: row.department_id,
    subdivision_id: row.subdivision_id,
    subdivision_name: row.subdivision_name,
    role_id: row.role_id,
    role_name: row.role_name,
  }));
}

async function listProjectSubdivisionAssignments(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT
        psa.id,
        psa.project_id,
        psa.subdivision_id,
        ds.subdivision_name,
        psa.assigned_leader_id,
        assigned_leader.name AS assigned_leader_name,
        psa.assigned_by,
        assigner.name AS assigned_by_name,
        psa.created_at,
        psa.is_active
      FROM design.project_subdivision_assignments psa
      JOIN department_subdivisions ds
        ON ds.id = psa.subdivision_id
      LEFT JOIN users assigned_leader
        ON ${userIdentifierMatchSql("assigned_leader", "psa.assigned_leader_id")}
      LEFT JOIN users assigner
        ON ${userIdentifierMatchSql("assigner", "psa.assigned_by")}
      WHERE psa.project_id = $1
      ORDER BY psa.is_active DESC, psa.created_at DESC
    `,
    [projectId],
  );

  return result.rows.map(mapAssignmentRow);
}

async function projectHasActive2DRouting(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT 1
      FROM design.project_subdivision_assignments psa
      JOIN department_subdivisions ds ON ds.id = psa.subdivision_id
      WHERE psa.project_id = $1
        AND psa.is_active = TRUE
        AND ds.is_active = TRUE
        AND ${twoDSubdivisionSql("ds")}
      LIMIT 1
    `,
    [projectId],
  );

  return result.rowCount > 0;
}

async function isProjectAssignedTo2DLeader(projectId, employeeId, client = pool) {
  const result = await client.query(
    `
      SELECT 1
      FROM design.project_subdivision_assignments psa
      JOIN department_subdivisions ds ON ds.id = psa.subdivision_id
      WHERE psa.project_id = $1
        AND psa.assigned_leader_id = $2
        AND psa.is_active = TRUE
        AND ds.is_active = TRUE
        AND ${twoDSubdivisionSql("ds")}
      LIMIT 1
    `,
    [projectId, employeeId],
  );

  return result.rowCount > 0;
}

async function assignProjectTo2DLeader({ projectId, assignedLeaderId, assignedBy }, client = pool) {
  const subdivision = await resolve2DSubdivisionForProject(projectId, client);
  if (!subdivision) {
    throw new AppError(409, "Active Design 2D subdivision is not configured for this project");
  }

  const eligibleLeaders = await list2DLeadersForProject(projectId, client);
  const selectedLeader = eligibleLeaders.find((leader) => leader.employee_id === assignedLeaderId);
  if (!selectedLeader) {
    throw new AppError(400, "Assigned leader must be an active Design 2D Team Leader or Co-Leader");
  }

  const result = await client.query(
    `
      INSERT INTO design.project_subdivision_assignments (
        project_id,
        subdivision_id,
        assigned_leader_id,
        assigned_by,
        created_at,
        is_active
      )
      VALUES ($1, $2, $3, $4, NOW(), TRUE)
      RETURNING id
    `,
    [projectId, subdivision.id, assignedLeaderId, assignedBy || null],
  );

  return (await listProjectSubdivisionAssignments(projectId, client))
    .find((assignment) => assignment.id === result.rows[0]?.id) || null;
}

async function setProjectSubdivisionAssignmentActive(assignmentId, isActive, client = pool) {
  const result = await client.query(
    `
      UPDATE design.project_subdivision_assignments
      SET is_active = $2
      WHERE id = $1
      RETURNING project_id
    `,
    [assignmentId, isActive === true],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, "Project subdivision assignment not found");
  }

  return result.rows[0].project_id;
}

module.exports = {
  DESIGN_2D_LEADER_ROLE_KEYS,
  DESIGN_2D_STAGE_KEYS,
  DESIGN_2D_SUBDIVISION_NAME,
  assignedTo2DLeaderProjectSql,
  assignProjectTo2DLeader,
  canManageProject2DRouting,
  current2DWorkflowStageFixtureSql,
  is2DLeaderUser,
  is2DSubdivisionUser,
  isProjectAssignedTo2DLeader,
  list2DLeadersForProject,
  listProjectSubdivisionAssignments,
  projectHasActive2DRouting,
  setProjectSubdivisionAssignmentActive,
  twoDSubdivisionSql,
  twoDStageNameSql,
  userIs2DLeaderSql,
  userIs2DNonLeaderSql,
  userIs2DSubdivisionSql,
};
