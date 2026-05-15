const { pool } = require("../db");

const DEFAULT_PARENT_ROLE_NAMES = ["admin", "ceo", "director"];

function buildVisibleUsersCte(rootUserParam = "$1", cteName = "visible_users") {
  return `
    WITH RECURSIVE root_user AS (
      SELECT
        u.id::text AS user_uuid,
        u.employee_id,
        u.department_id,
        COALESCE(r.hierarchy_level, 2147483647)::integer AS hierarchy_level,
        LOWER(BTRIM(COALESCE(r.name, u.role, ''))) AS role_name,
        LOWER(BTRIM(COALESCE(u.role, ''))) AS role_id
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
      LEFT JOIN roles child_role
        ON child_role.id = child.role
      WHERE (
          root.role_name = ANY(ARRAY[${DEFAULT_PARENT_ROLE_NAMES.map((roleName) => `'${roleName}'`).join(", ")}]::text[])
          OR root.role_id = ANY(ARRAY[${DEFAULT_PARENT_ROLE_NAMES.map((roleName) => `'${roleName}'`).join(", ")}]::text[])
        )
        AND (
          child.employee_id = root.employee_id
          OR COALESCE(child_role.hierarchy_level, 2147483647) > root.hierarchy_level
        )
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
  buildVisibleUsersCte,
  getAccessibleProjectIds,
  getAccessibleUserIds: GetAccessibleUserIds,
  visibleFixturePredicate,
  visibleProjectPredicate,
};
