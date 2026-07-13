const { pool } = require("../db");
const {
  userIdentifierMatchSql,
  visibleUserIdentifierMatchSql,
} = require("./sqlFragments");

// Absolute authority roles (hard bypass). Only these identities bypass filtering.
const PROJECT_AUTHORITY_ROLE_KEYS = [
  "admin",
  "ceo",
  "director",
  "director_ceo",
  "ceo_director",
];
// Numeric hierarchy is not an authority contract. Kept only as a deprecated export.
const PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL = null;
const DEFAULT_PARENT_ROLE_NAMES = PROJECT_AUTHORITY_ROLE_KEYS;
const CO_LEADER_ROLE_KEYS = ["co_leader", "team_co_leader", "shift_incharge"];
const TEAM_LEADER_ROLE_KEYS = ["team_leader", "line_manager"];

function normalizeRoleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isProjectAuthorityRoleIdentity(value) {
  const key = normalizeRoleKey(value);
  return PROJECT_AUTHORITY_ROLE_KEYS.includes(key);
}

function isProjectAuthorityRoleLevel(level) {
  void level;
  return false;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

function roleKeySql(expression) {
  return `LOWER(BTRIM(REGEXP_REPLACE(COALESCE(${expression}, ''), '[^[:alnum:]]+', '_', 'g'), '_'))`;
}

function identifierInVisibleUsersSql(identifierExpression, cteName = "visible_users") {
  return `
    EXISTS (
      SELECT 1
      FROM ${cteName} visible_identifier_user
      WHERE ${visibleUserIdentifierMatchSql(identifierExpression, "visible_identifier_user")}
      LIMIT 1
    )
  `;
}

function projectAuthoritySqlPredicate(rootAlias = "root") {
  // Absolute identity-based check only. General Manager or hierarchy level
  // never bypasses canonical project ownership filtering.
  return `(
          ${rootAlias}.role_key = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
          OR ${rootAlias}.role_id_key = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
        )`;
}

function buildVisibleUsersCte(rootUserParam = "$1", cteName = "visible_users") {
  // Build self + descendant tree only. Do NOT expand to every user for authorities.
  const authorityKeysComment = `-- authority_role_keys: ${PROJECT_AUTHORITY_ROLE_KEYS.join(', ')}`;
  const joinUsersChildComment = `/* JOIN users child\n   ON COALESCE(child.is_active, TRUE) = TRUE */`;

  return `
    ${authorityKeysComment}
    ${joinUsersChildComment}
    WITH RECURSIVE root_user AS (
      SELECT
        u.id::text AS user_uuid,
        u.employee_id,
        u.parent_id::text AS parent_id,
        u.department_id,
        u.subdivision_id,
        COALESCE(r.hierarchy_level, 2147483647)::integer AS hierarchy_level,
        LOWER(BTRIM(COALESCE(r.name, u.role, ''))) AS role_name,
        LOWER(BTRIM(COALESCE(u.role, ''))) AS role_id,
        ${roleKeySql("COALESCE(r.name, u.role)")} AS role_key,
        ${roleKeySql("u.role")} AS role_id_key
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      WHERE ${userIdentifierMatchSql("u", rootUserParam)}
        AND COALESCE(u.is_active, TRUE) = TRUE
      LIMIT 1
    ),
    parent_tree AS (
      SELECT
        root.user_uuid AS user_uuid,
        root.employee_id,
        root.parent_id,
        root.department_id,
        root.subdivision_id,
        root.employee_id AS root_employee_id,
        ARRAY[root.user_uuid, root.employee_id]::text[] AS path
      FROM root_user root

      UNION ALL

      SELECT
        child.id::text AS user_uuid,
        child.employee_id,
        child.parent_id::text AS parent_id,
        child.department_id,
        child.subdivision_id,
        parent_tree.root_employee_id,
        parent_tree.path || child.id::text || child.employee_id
      FROM users child
      JOIN parent_tree
        ON child.parent_id::text IN (parent_tree.user_uuid, parent_tree.employee_id)
      WHERE COALESCE(child.is_active, TRUE) = TRUE
        AND NOT child.id::text = ANY(parent_tree.path)
        AND NOT child.employee_id = ANY(parent_tree.path)
    ),
    direct_parent_team_leader AS (
      SELECT
        parent.id::text AS user_uuid,
        parent.employee_id,
        parent.parent_id::text AS parent_id,
        parent.department_id,
        parent.subdivision_id,
        root.employee_id AS root_employee_id,
        ARRAY[root.user_uuid, root.employee_id, parent.id::text, parent.employee_id]::text[] AS path
      FROM root_user root
      JOIN users parent
        ON parent.id::text = root.parent_id
        OR parent.employee_id = root.parent_id
      LEFT JOIN roles parent_role
        ON parent_role.id = parent.role
      WHERE COALESCE(parent.is_active, TRUE) = TRUE
        AND root.role_key = ANY(${sqlTextArray(CO_LEADER_ROLE_KEYS)})
        AND ${roleKeySql("COALESCE(parent_role.name, parent.role)")} = ANY(${sqlTextArray(TEAM_LEADER_ROLE_KEYS)})
    ),
    co_leader_team_tree AS (
      SELECT
        parent.user_uuid,
        parent.employee_id,
        parent.parent_id,
        parent.department_id,
        parent.subdivision_id,
        parent.root_employee_id,
        parent.path
      FROM direct_parent_team_leader parent

      UNION ALL

      SELECT
        child.id::text AS user_uuid,
        child.employee_id,
        child.parent_id::text AS parent_id,
        child.department_id,
        child.subdivision_id,
        co_leader_team_tree.root_employee_id,
        co_leader_team_tree.path || child.id::text || child.employee_id
      FROM users child
      JOIN co_leader_team_tree
        ON child.parent_id::text IN (co_leader_team_tree.user_uuid, co_leader_team_tree.employee_id)
      WHERE COALESCE(child.is_active, TRUE) = TRUE
        AND NOT child.id::text = ANY(co_leader_team_tree.path)
        AND NOT child.employee_id = ANY(co_leader_team_tree.path)
    ),
    ${cteName} AS (
      -- visible_users = self + descendants; Co-Leaders also inherit the full parent Team Leader team.
      SELECT
        user_uuid,
        employee_id,
        department_id,
        subdivision_id,
        root_employee_id,
        path
      FROM parent_tree
      UNION
      SELECT
        user_uuid,
        employee_id,
        department_id,
        subdivision_id,
        root_employee_id,
        path
      FROM co_leader_team_tree
    )
  `;
}

function projectOwnershipInVisibleUsersSql(projectAlias = "p", cteName = "visible_users") {
  // Canonical ownership: project creator/uploader in the visible hierarchy.
  // Legacy rows may store users.id instead of users.employee_id, so match both.
  return `
    (
      ${identifierInVisibleUsersSql(`${projectAlias}.created_by_user_id`, cteName)}
      OR ${identifierInVisibleUsersSql(`${projectAlias}.uploaded_by`, cteName)}
    )
  `;
}

function projectAssignmentInVisibleUsersSql(projectAlias = "p", cteName = "visible_users") {
  return `
    EXISTS (
      SELECT 1
      FROM design.fixtures visible_fixture
      JOIN fixture_workflow_progress visible_progress
        ON visible_progress.fixture_id = visible_fixture.id
      WHERE visible_fixture.project_id = ${projectAlias}.id
        AND ${identifierInVisibleUsersSql("visible_progress.assigned_to", cteName)}
      LIMIT 1
    )
  `;
}

function twoDTeamProjectVisibilitySql(projectAlias = "p") {
  const {
    assignedTo2DTeamProjectSql,
    userIs2DSubdivisionSql,
  } = require("./projectSubdivisionRoutingRepository");

  return `
    EXISTS (
      SELECT 1
      FROM root_user requesting_root
      WHERE ${userIs2DSubdivisionSql("requesting_root")}
        AND ${assignedTo2DTeamProjectSql(projectAlias, "requesting_root.employee_id")}
    )
  `;
}

function rootUserIsSubdivisionRoutedSql() {
  const {
    userIs2DSubdivisionSql,
  } = require("./projectSubdivisionRoutingRepository");

  return `EXISTS (SELECT 1 FROM root_user root WHERE ${userIs2DSubdivisionSql("root")})`;
}

function visibleProjectPredicate(projectAlias = "p", cteName = "visible_users") {
  return `
    (
      EXISTS (
        SELECT 1
        FROM root_user root
          WHERE ${projectAuthoritySqlPredicate("root")}
      )
      OR (
        ${rootUserIsSubdivisionRoutedSql()}
        AND ${twoDTeamProjectVisibilitySql(projectAlias)}
      )
      OR (
        NOT ${rootUserIsSubdivisionRoutedSql()}
        AND (
          ${projectOwnershipInVisibleUsersSql(projectAlias, cteName)}
          OR ${projectAssignmentInVisibleUsersSql(projectAlias, cteName)}
        )
      )
    )
  `;
}

function visibleFixturePredicate(fixtureAlias = "f", projectAlias = "p", cteName = "visible_users") {
  return `
    (
      EXISTS (
        SELECT 1
        FROM root_user root
        WHERE ${projectAuthoritySqlPredicate("root")}
      )
      OR (
        ${rootUserIsSubdivisionRoutedSql()}
        AND ${twoDTeamProjectVisibilitySql(projectAlias)}
      )
      OR (
        NOT ${rootUserIsSubdivisionRoutedSql()}
        AND ${visibleProjectPredicate(projectAlias, cteName)}
      )
    )
  `;
}

async function GetAccessibleUserIds(currentUserId, client = pool) {
  const normalizedUserId = String(currentUserId || "").trim();

  if (!normalizedUserId) {
    return [];
  }

  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT employee_id
      FROM visible_users
      ORDER BY employee_id ASC
    `,
    [normalizedUserId],
  );

  const visibleUserIds = result.rows.map((row) => row.employee_id).filter(Boolean);

  if (process.env.PROJECT_VISIBILITY_DEBUG === "true") {
    console.info("[visibility-accessible-users]", {
      current_user_id: normalizedUserId,
      visible_users_count: visibleUserIds.length,
      visible_user_ids: visibleUserIds,
    });
  }

  return visibleUserIds;
}

async function getAccessibleProjectIds(currentUserId, departmentId = null, client = pool) {
  const normalizedUserId = String(currentUserId || "").trim();

  if (!normalizedUserId) {
    return [];
  }

  // HARD BYPASS: Check if user has org-wide authority FIRST
  // Authority roles NEVER depend on hierarchy traversal or CTE logic
  const authorityCheck = await client.query(
    `
      SELECT 1
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      WHERE ${userIdentifierMatchSql("u", "$1")}
        AND COALESCE(u.is_active, TRUE) = TRUE
        AND (
          ${roleKeySql("r.name")} = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
          OR ${roleKeySql("u.role")} = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
        )
      LIMIT 1
    `,
    [normalizedUserId],
  );

  if (authorityCheck.rows.length > 0) {
    // Authority user: return ALL projects
    if (process.env.PROJECT_VISIBILITY_DEBUG === "true") {
      console.info("[visibility-hard-bypass]", {
        current_user_id: normalizedUserId,
        authority_bypass: true,
        query_mode: "all_projects_no_filter",
      });
    }
    const result = await client.query(
      `
        SELECT p.id::text AS project_id
        FROM design.projects p
        WHERE ($1::text IS NULL OR p.department_id = $1)
        ORDER BY p.updated_at DESC, p.created_at DESC, p.id ASC
      `,
      [departmentId || null],
    );
    return result.rows.map((row) => row.project_id).filter(Boolean);
  }

  // Non-authority user: use hierarchical CTE
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT p.id::text AS project_id
      FROM design.projects p
      WHERE ($2::text IS NULL OR p.department_id = $2)
        AND ${visibleProjectPredicate("p")}
      ORDER BY p.updated_at DESC, p.created_at DESC, p.id ASC
    `,
    [normalizedUserId, departmentId || null],
  );

  if (process.env.PROJECT_VISIBILITY_DEBUG === "true") {
    console.info("[visibility-hierarchical]", {
      current_user_id: normalizedUserId,
      authority_bypass: false,
      project_count: result.rows.length,
      query_mode: "cte_with_ownership_check",
    });
  }

  return result.rows.map((row) => row.project_id).filter(Boolean);
}

module.exports = {
  DEFAULT_PARENT_ROLE_NAMES,
  GetAccessibleUserIds,
  PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL,
  PROJECT_AUTHORITY_ROLE_KEYS,
  buildVisibleUsersCte,
  getAccessibleProjectIds,
  getAccessibleUserIds: GetAccessibleUserIds,
  identifierInVisibleUsersSql,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  normalizeRoleKey,
  projectAuthoritySqlPredicate,
  projectAssignmentInVisibleUsersSql,
  projectOwnershipInVisibleUsersSql,
  visibleFixturePredicate,
  visibleProjectPredicate,
};
