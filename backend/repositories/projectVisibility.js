const { pool } = require("../db");

// Absolute authority roles (hard bypass). Only these identities bypass filtering.
const PROJECT_AUTHORITY_ROLE_KEYS = [
  "admin",
  "ceo",
  "director",
  "director_ceo",
];
// Numeric hierarchy threshold for legacy authority checks (kept for compatibility/tests)
const PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL = 2;
const DEFAULT_PARENT_ROLE_NAMES = PROJECT_AUTHORITY_ROLE_KEYS;

function normalizeRoleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isProjectAuthorityRoleIdentity(value) {
  const key = normalizeRoleKey(value);

  // Accept explicit authority role keys (e.g. 'director_ceo')
  if (PROJECT_AUTHORITY_ROLE_KEYS.includes(key)) {
    return true;
  }

  // Also accept legacy role id tokens like 'r2' where the numeric
  // hierarchy level is within the authority threshold.
  const m = String(value || "").trim().toLowerCase().match(/^r(\d+)$/);
  if (m) {
    const level = Number(m[1]);
    return Number.isFinite(level) && level <= PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL;
  }

  return false;
}

function isProjectAuthorityRoleLevel(level) {
  if (level === null || level === undefined || String(level).trim() === "") {
    return false;
  }

  const numericLevel = Number(level);
  return Number.isFinite(numericLevel) && numericLevel <= PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL;
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

function projectAuthoritySqlPredicate(rootAlias = "root") {
  // Absolute identity-based check only (no hierarchy-level dependency).
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
        u.department_id,
        COALESCE(r.hierarchy_level, 2147483647)::integer AS hierarchy_level,
        LOWER(BTRIM(COALESCE(r.name, u.role, ''))) AS role_name,
        LOWER(BTRIM(COALESCE(u.role, ''))) AS role_id,
        ${roleKeySql("COALESCE(r.name, u.role)")} AS role_key,
        ${roleKeySql("u.role")} AS role_id_key
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      WHERE (u.id::text = ${rootUserParam} OR u.employee_id = ${rootUserParam})
        AND COALESCE(u.is_active, TRUE) = TRUE
      LIMIT 1
    ),
    parent_tree AS (
      SELECT
        root.user_uuid AS user_uuid,
        root.employee_id,
        root.department_id,
        root.employee_id AS root_employee_id,
        ARRAY[root.user_uuid, root.employee_id]::text[] AS path
      FROM root_user root

      UNION ALL

      SELECT
        child.id::text AS user_uuid,
        child.employee_id,
        child.department_id,
        parent_tree.root_employee_id,
        parent_tree.path || child.id::text || child.employee_id
      FROM users child
      JOIN parent_tree
        ON child.parent_id::text IN (parent_tree.user_uuid, parent_tree.employee_id)
      WHERE COALESCE(child.is_active, TRUE) = TRUE
        AND NOT child.id::text = ANY(parent_tree.path)
        AND NOT child.employee_id = ANY(parent_tree.path)
    ),
    ${cteName} AS (
      -- visible_users = self + descendants ONLY
      SELECT
        user_uuid,
        employee_id,
        department_id,
        root_employee_id,
        path
      FROM parent_tree
    )
  `;
}

function projectOwnershipInVisibleUsersSql(projectAlias = "p", cteName = "visible_users") {
  // Canonical ownership: project.created_by_user_id only
  return `
    COALESCE(${projectAlias}.created_by_user_id IN (SELECT employee_id FROM ${cteName}), FALSE)
  `;
}

function visibleProjectPredicate(projectAlias = "p", cteName = "visible_users") {
  return `
    (
      EXISTS (
        SELECT 1
        FROM root_user root
        WHERE ${projectAuthoritySqlPredicate("root")}
      )
      OR (${projectOwnershipInVisibleUsersSql(projectAlias, cteName)})
    )
  `;
}

function visibleFixturePredicate(fixtureAlias = "f", projectAlias = "p", cteName = "visible_users") {
  void fixtureAlias;
  return `
    ${visibleProjectPredicate(projectAlias, cteName)}
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
      WHERE (u.id::text = $1 OR u.employee_id = $1)
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
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  normalizeRoleKey,
  projectAuthoritySqlPredicate,
  projectOwnershipInVisibleUsersSql,
  visibleFixturePredicate,
  visibleProjectPredicate,
};
