const { pool } = require("../db");

const PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL = 2;
const PROJECT_AUTHORITY_ROLE_KEYS = [
  "admin",
  "ceo",
  "director",
  "director_ceo",
  "ceo_director",
  "plant_head",
  "r1",
  "r2",
];
const DEFAULT_PARENT_ROLE_NAMES = PROJECT_AUTHORITY_ROLE_KEYS;

function normalizeRoleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isProjectAuthorityRoleIdentity(value) {
  return PROJECT_AUTHORITY_ROLE_KEYS.includes(normalizeRoleKey(value));
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
  return `(
          ${rootAlias}.hierarchy_level <= ${PROJECT_AUTHORITY_MAX_HIERARCHY_LEVEL}
          OR ${rootAlias}.role_key = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
          OR ${rootAlias}.role_id_key = ANY(${sqlTextArray(PROJECT_AUTHORITY_ROLE_KEYS)})
        )`;
}

function buildVisibleUsersCte(rootUserParam = "$1", cteName = "visible_users") {
  return `
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
        u.id::text AS user_uuid,
        u.employee_id,
        u.department_id,
        u.employee_id AS root_employee_id,
        ARRAY[u.id::text, u.employee_id]::text[] AS path
      FROM users u
      JOIN root_user root ON root.employee_id = u.employee_id

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
      SELECT
        user_uuid,
        employee_id,
        department_id,
        root_employee_id,
        path
      FROM parent_tree

      UNION

      SELECT
        child.id::text AS user_uuid,
        child.employee_id,
        child.department_id,
        root.employee_id AS root_employee_id,
        ARRAY[root.user_uuid, root.employee_id, child.id::text, child.employee_id]::text[] AS path
      FROM root_user root
      JOIN users child
        ON COALESCE(child.is_active, TRUE) = TRUE
      WHERE ${projectAuthoritySqlPredicate("root")}
    )
  `;
}

function visibleProjectPredicate(projectAlias = "p", cteName = "visible_users") {
  return `
    COALESCE(${projectAlias}.uploaded_by IN (SELECT employee_id FROM ${cteName}), FALSE)
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

  return result.rows.map((row) => row.employee_id).filter(Boolean);
}

async function getAccessibleProjectIds(currentUserId, departmentId = null, client = pool) {
  const normalizedUserId = String(currentUserId || "").trim();

  if (!normalizedUserId) {
    return [];
  }

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
  visibleFixturePredicate,
  visibleProjectPredicate,
};
