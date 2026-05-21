-- design.projects canonical owner truth
SELECT
  'project_missing_or_invalid_created_by_user_id' AS diagnostic,
  p.id::text AS project_id,
  p.project_no,
  p.created_by_user_id
FROM design.projects p
LEFT JOIN users owner
  ON owner.employee_id = p.created_by_user_id
WHERE NULLIF(BTRIM(COALESCE(p.created_by_user_id, '')), '') IS NULL
   OR owner.employee_id IS NULL;

-- one active operational batch per project
SELECT
  'duplicate_active_batches' AS diagnostic,
  p.id::text AS project_id,
  p.project_no,
  COUNT(*) AS active_batch_count,
  ARRAY_AGG(ub.id::text ORDER BY ub.uploaded_at DESC, ub.id DESC) AS active_batch_ids
FROM design.upload_batches ub
JOIN design.projects p
  ON p.id = ub.project_id
WHERE COALESCE(ub.status, 'active') = 'active'
GROUP BY p.id, p.project_no
HAVING COUNT(*) > 1;

-- stale/legacy permission ids must be absent after migration
WITH stale_permission_ids(permission_id) AS (
  VALUES
    ('can_upload_data'),
    ('can_verify_task'),
    ('can_assign_task'),
    ('tasks_assign')
),
permission_sources AS (
  SELECT 'permissions' AS source, p.id AS permission_id
  FROM permissions p
  JOIN stale_permission_ids stale
    ON stale.permission_id = p.id

  UNION ALL

  SELECT 'role_permissions' AS source, rp.permission_id
  FROM role_permissions rp
  JOIN stale_permission_ids stale
    ON stale.permission_id = rp.permission_id

  UNION ALL

  SELECT 'roles.permissions_json' AS source, role_permission.permission_id
  FROM roles r
  CROSS JOIN LATERAL jsonb_object_keys(COALESCE(r.permissions, '{}'::jsonb)) AS role_permission(permission_id)
  JOIN stale_permission_ids stale
    ON stale.permission_id = role_permission.permission_id

  UNION ALL

  SELECT 'workflow_transitions' AS source, wt.required_permission
  FROM workflow_transitions wt
  JOIN stale_permission_ids stale
    ON stale.permission_id = wt.required_permission
)
SELECT
  'stale_permission_reference' AS diagnostic,
  source,
  permission_id,
  COUNT(*) AS reference_count
FROM permission_sources
GROUP BY source, permission_id
ORDER BY source, permission_id;

-- broken hierarchy chains
SELECT
  'orphan_parent_id' AS diagnostic,
  child.employee_id,
  child.name,
  child.parent_id
FROM users child
WHERE NULLIF(BTRIM(COALESCE(child.parent_id::text, '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM users parent
    WHERE parent.id::text = child.parent_id::text
       OR parent.employee_id = child.parent_id::text
  );

-- cyclic hierarchy paths
WITH RECURSIVE hierarchy_walk AS (
  SELECT
    u.employee_id AS root_employee_id,
    u.id::text AS user_uuid,
    u.employee_id,
    u.parent_id::text AS parent_id,
    ARRAY[u.id::text, u.employee_id]::text[] AS path,
    false AS cycle_detected,
    0 AS depth
  FROM users u
  WHERE COALESCE(u.is_active, TRUE) = TRUE

  UNION ALL

  SELECT
    hierarchy_walk.root_employee_id,
    parent.id::text AS user_uuid,
    parent.employee_id,
    parent.parent_id::text AS parent_id,
    hierarchy_walk.path || parent.id::text || parent.employee_id,
    parent.id::text = ANY(hierarchy_walk.path)
      OR parent.employee_id = ANY(hierarchy_walk.path) AS cycle_detected,
    hierarchy_walk.depth + 1
  FROM hierarchy_walk
  JOIN users parent
    ON parent.id::text = hierarchy_walk.parent_id
    OR parent.employee_id = hierarchy_walk.parent_id
  WHERE hierarchy_walk.depth < 64
    AND hierarchy_walk.cycle_detected = false
)
SELECT
  'cyclic_hierarchy' AS diagnostic,
  root_employee_id,
  employee_id AS repeated_employee_id,
  path
FROM hierarchy_walk
WHERE cycle_detected = true;

-- co-leader parent must be direct Team Leader
WITH user_roles AS (
  SELECT
    u.id::text AS user_uuid,
    u.employee_id,
    u.name,
    u.parent_id::text AS parent_id,
    LOWER(BTRIM(REGEXP_REPLACE(COALESCE(r.name, u.role, ''), '[^[:alnum:]]+', '_', 'g'), '_')) AS role_key
  FROM users u
  LEFT JOIN roles r
    ON r.id = u.role
  WHERE COALESCE(u.is_active, TRUE) = TRUE
),
parent_roles AS (
  SELECT
    child.employee_id,
    child.name,
    child.parent_id,
    child.role_key,
    parent.employee_id AS parent_employee_id,
    parent.name AS parent_name,
    parent.role_key AS parent_role_key
  FROM user_roles child
  LEFT JOIN user_roles parent
    ON parent.employee_id = child.parent_id
    OR parent.user_uuid = child.parent_id
  WHERE child.role_key IN ('co_leader', 'team_co_leader')
)
SELECT
  'invalid_co_leader_parent_role' AS diagnostic,
  employee_id,
  name,
  parent_id,
  parent_employee_id,
  parent_name,
  parent_role_key
FROM parent_roles
WHERE parent_employee_id IS NULL
   OR parent_role_key <> 'team_leader';
