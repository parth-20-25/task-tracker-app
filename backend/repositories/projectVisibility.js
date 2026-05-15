const { pool } = require("../db");

function buildVisibleUsersCte(rootUserParam = "$1", cteName = "visible_users") {
  return `
    WITH RECURSIVE ${cteName} AS (
      SELECT
        u.id::text AS user_uuid,
        u.employee_id,
        u.department_id,
        u.employee_id AS root_employee_id,
        ARRAY[u.id::text, u.employee_id]::text[] AS path
      FROM users u
      WHERE (u.id::text = ${rootUserParam} OR u.employee_id = ${rootUserParam})
        AND COALESCE(u.is_active, TRUE) = TRUE

      UNION ALL

      SELECT
        child.id::text AS user_uuid,
        child.employee_id,
        child.department_id,
        parent_tree.root_employee_id,
        parent_tree.path || child.id::text || child.employee_id
      FROM users child
      JOIN ${cteName} parent_tree
        ON child.parent_id::text IN (parent_tree.user_uuid, parent_tree.employee_id)
      WHERE COALESCE(child.is_active, TRUE) = TRUE
        AND NOT child.id::text = ANY(parent_tree.path)
        AND NOT child.employee_id = ANY(parent_tree.path)
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
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  getAccessibleProjectIds,
  getAccessibleUserIds: GetAccessibleUserIds,
  visibleFixturePredicate,
  visibleProjectPredicate,
};
