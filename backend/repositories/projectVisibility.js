function buildVisibleUsersCte(rootEmployeeParam = "$1", cteName = "visible_users") {
  return `
    WITH RECURSIVE ${cteName} AS (
      SELECT
        u.id::text AS user_uuid,
        u.employee_id,
        u.department_id,
        COALESCE(r.hierarchy_level, 0) AS hierarchy_level,
        u.employee_id AS root_employee_id,
        u.department_id AS root_department_id,
        COALESCE(r.hierarchy_level, 0) AS root_hierarchy_level,
        ARRAY[u.employee_id]::text[] AS path
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      WHERE u.employee_id = ${rootEmployeeParam}
        AND COALESCE(u.is_active, TRUE) = TRUE

      UNION ALL

      SELECT
        child.id::text AS user_uuid,
        child.employee_id,
        child.department_id,
        COALESCE(child_role.hierarchy_level, 999999) AS hierarchy_level,
        parent_tree.root_employee_id,
        parent_tree.root_department_id,
        parent_tree.root_hierarchy_level,
        parent_tree.path || child.employee_id
      FROM users child
      LEFT JOIN roles child_role ON child_role.id = child.role
      JOIN ${cteName} parent_tree
        ON child.parent_id::text IN (parent_tree.user_uuid, parent_tree.employee_id)
      WHERE COALESCE(child.is_active, TRUE) = TRUE
        AND NOT child.employee_id = ANY(parent_tree.path)
        AND COALESCE(child_role.hierarchy_level, 999999) > parent_tree.hierarchy_level
        AND (
          child.department_id = parent_tree.department_id
          OR (
            parent_tree.department_id IS NULL
            AND parent_tree.root_hierarchy_level = 1
          )
        )
    )
  `;
}

function visibleProjectPredicate(projectAlias = "p", cteName = "visible_users") {
  return `
    COALESCE((
      ${projectAlias}.uploaded_by IN (SELECT employee_id FROM ${cteName})
      OR EXISTS (
        SELECT 1
        FROM design.upload_batches visibility_batch
        WHERE visibility_batch.project_id = ${projectAlias}.id
          AND COALESCE(visibility_batch.uploaded_by_user_id, visibility_batch.uploaded_by) IN (
            SELECT employee_id FROM ${cteName}
          )
      )
    ), FALSE)
  `;
}

function visibleFixturePredicate(fixtureAlias = "f", projectAlias = "p", cteName = "visible_users") {
  return `
    COALESCE((
      EXISTS (
        SELECT 1
        FROM design.upload_batches visibility_batch
        WHERE visibility_batch.id = ${fixtureAlias}.batch_id
          AND COALESCE(visibility_batch.uploaded_by_user_id, visibility_batch.uploaded_by) IN (
            SELECT employee_id FROM ${cteName}
          )
      )
      OR (
        ${fixtureAlias}.batch_id IS NULL
        AND ${projectAlias}.uploaded_by IN (SELECT employee_id FROM ${cteName})
      )
    ), FALSE)
  `;
}

function visibleBatchPredicate(batchAlias = "ub", cteName = "visible_users") {
  return `
    COALESCE((
      COALESCE(${batchAlias}.uploaded_by_user_id, ${batchAlias}.uploaded_by) IN (
      SELECT employee_id FROM ${cteName}
      )
    ), FALSE)
  `;
}

module.exports = {
  buildVisibleUsersCte,
  visibleBatchPredicate,
  visibleFixturePredicate,
  visibleProjectPredicate,
};
