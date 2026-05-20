const { PERMISSIONS, ROLE_LEVELS, USER_SCOPES } = require("../config/constants");
const { pool } = require("../db");
const {
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  isProjectAuthorityRoleIdentity,
  isProjectAuthorityRoleLevel,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
const { normalizePermissionIds } = require("../repositories/permissionRepository");
const { hasOrgWideVisibility } = require("./visibilityResolutionService");

const PERMISSION_ALIASES = {
  can_assign_task: [PERMISSIONS.ASSIGN_TASK],
  [PERMISSIONS.ASSIGN_TASK]: ["can_assign_task"],
  can_verify_task: [PERMISSIONS.APPROVE_COMPLETED_TASK],
  [PERMISSIONS.APPROVE_COMPLETED_TASK]: ["can_verify_task"],
  // Backwards-compatible design upload rollout:
  // - `can_upload_data` historically guarded Design ingestion routes.
  // - During dual rollout, treat it as equivalent to legacy ingestion permission.
  [PERMISSIONS.UPLOAD_DATA]: [PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA],
  [PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA]: [PERMISSIONS.UPLOAD_DATA],
};

function getEquivalentPermissions(permission) {
  return [...new Set([permission, ...(PERMISSION_ALIASES[permission] || [])])];
}

function getRoleDetails(user) {
  if (user?.role && typeof user.role === "object") {
    return user.role;
  }

  if (user?.role_details && typeof user.role_details === "object") {
    return user.role_details;
  }

  return null;
}

function getRoleId(user) {
  if (!user) {
    return null;
  }

  if (typeof user.role === "string") {
    return user.role;
  }

  return user.role?.id || user.role_details?.id || user.role_id || null;
}

function getRoleLevel(user) {
  const roleDetails = getRoleDetails(user);
  const roleId = getRoleId(user);
  return roleDetails?.hierarchy_level ?? ROLE_LEVELS[roleId] ?? null;
}

function isProjectAuthorityRole(user) {
  return hasOrgWideVisibility(user);
}

function getRolePermissionFlags(user) {
  const roleDetails = getRoleDetails(user);

  if (!roleDetails?.permissions || typeof roleDetails.permissions !== "object") {
    return [];
  }

  return Object.entries(roleDetails.permissions)
    .filter(([, enabled]) => enabled === true)
    .flatMap(([permission]) => getEquivalentPermissions(permission));
}

function hasPermission(user, permission) {
  if (!user || !permission) {
    return false;
  }

  if (getRoleDetails(user)?.permissions?.all === true) {
    return true;
  }

  const grantedPermissions = new Set([
    ...(Array.isArray(user.permissions) ? user.permissions : []),
    ...getRolePermissionFlags(user),
  ]);

  return getEquivalentPermissions(permission).some((candidatePermission) => grantedPermissions.has(candidatePermission));
}

async function HasPermission(userOrId, permission, client = pool) {
  if (!permission) {
    return false;
  }

  if (userOrId && typeof userOrId === "object") {
    return hasPermission(userOrId, permission);
  }

  const normalizedUserId = String(userOrId || "").trim();
  if (!normalizedUserId) {
    return false;
  }

  const result = await client.query(
    `
      SELECT
        u.employee_id,
        u.role AS role_id,
        r.permissions AS role_permissions_json,
        COALESCE(
          ARRAY_AGG(rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL),
          ARRAY[]::text[]
        ) AS relational_permissions
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN role_permissions rp ON rp.role_id = u.role
      WHERE (u.id::text = $1 OR u.employee_id = $1 OR u.email = $1)
        AND COALESCE(u.is_active, TRUE) = TRUE
      GROUP BY u.employee_id, u.role, r.permissions
      LIMIT 1
    `,
    [normalizedUserId],
  );

  const row = result.rows[0];
  if (!row) {
    return false;
  }

  return hasPermission({
    employee_id: row.employee_id,
    role: {
      id: row.role_id,
      permissions: row.role_permissions_json || {},
    },
    permissions: normalizePermissionIds(row.relational_permissions || []),
  }, permission);
}

function isAdmin(user) {
  return getRoleLevel(user) === 1;
}

function hasProjectAuthorityOrAdmin(user) {
  return isAdmin(user) || hasOrgWideVisibility(user);
}

function isSupervisor(user) {
  return (getRoleLevel(user) ?? Number.MAX_SAFE_INTEGER) <= 4;
}

function getVisibleUserIds(user) {
  if (!user) {
    return [];
  }

  const visibleUserIds = Array.isArray(user.visible_user_ids)
    ? user.visible_user_ids.filter(Boolean)
    : [];

  if (user.employee_id) {
    visibleUserIds.push(user.employee_id);
  }

  return [...new Set(visibleUserIds)];
}

function canAccessUser(user, target) {
  const targetEmployeeId = typeof target === "string"
    ? target
    : target?.employee_id || null;

  if (!targetEmployeeId) {
    return false;
  }

  if (hasProjectAuthorityOrAdmin(user)) {
    return true;
  }

  return getVisibleUserIds(user).includes(targetEmployeeId);
}

function canAccessDepartment(user, departmentId) {
  if (hasProjectAuthorityOrAdmin(user)) {
    return true;
  }

  if (!user?.department_id || !departmentId) {
    return false;
  }

  return user.department_id === departmentId;
}

function getTaskAssigneeIds(task) {
  return [
    task?.assigned_user_id,
    task?.assigned_to,
    ...(Array.isArray(task?.assignee_ids) ? task.assignee_ids : []),
  ].filter(Boolean);
}

function isTaskDirectAssignee(user, task) {
  if (!user?.employee_id || !task) {
    return false;
  }

  return getTaskAssigneeIds(task).includes(user.employee_id);
}

function isTaskOwnedByUser(user, task) {
  if (!user?.employee_id || !task) {
    return false;
  }

  return [
    task.created_by,
    task.assigned_by,
    task.project_uploaded_by,
    task.fixture_uploaded_by,
  ].filter(Boolean).includes(user.employee_id);
}

function isTaskVisibleThroughProjectHierarchy(user, task) {
  if (!task?.project_id) {
    return true;
  }

  const uploadOwner = task.fixture_uploaded_by || task.project_uploaded_by;
  if (!uploadOwner) {
    return false;
  }

  return getVisibleUserIds(user).includes(uploadOwner);
}

function canAccessTask(user, task) {
  if (!task) {
    return false;
  }

  if (hasProjectAuthorityOrAdmin(user)) {
    return true;
  }

  const selfScoped = isTaskDirectAssignee(user, task) || isTaskOwnedByUser(user, task);

  if (hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS)) {
    return selfScoped || (
      canAccessDepartment(user, task.department_id)
      && isTaskVisibleThroughProjectHierarchy(user, task)
    );
  }

  if (hasPermission(user, PERMISSIONS.VIEW_SELF_TASKS)) {
    return selfScoped;
  }

  return false;
}

function canAssignTo(assigner, assignee) {
  if (!assigner || !assignee) {
    return false;
  }

  if (!hasPermission(assigner, PERMISSIONS.ASSIGN_TASK)) {
    return false;
  }

  if (!assignee.is_active) {
    return false;
  }

  if (!isProjectAuthorityRole(assigner) && assigner.department_id !== assignee.department_id) {
    return false;
  }

  return assignee.employee_id === assigner.employee_id || canAccessUser(assigner, assignee);
}

function canVerifyTask(actor, task) {
  const requiredPermission = task?.approval_stage === "quality"
    ? PERMISSIONS.APPROVE_QUALITY
    : PERMISSIONS.APPROVE_COMPLETED_TASK;

  if (!hasPermission(actor, requiredPermission)) {
    return false;
  }

  // Approval should be scoped by department (or admin), not by "visible/assignee" access.
  // This prevents approvers (e.g., team leaders) from being blocked when they are not task assignees.
  if (hasProjectAuthorityOrAdmin(actor)) {
    return true;
  }

  return canAccessDepartment(actor, task?.department_id || null);
}

function isTaskAssignee(user, task) {
  return isTaskDirectAssignee(user, task);
}

function buildTaskAssigneePredicate(employeeIdParam, taskAlias = "t") {
  return `
    (
      COALESCE(${taskAlias}.assigned_user_id, ${taskAlias}.assigned_to) = ${employeeIdParam}
      OR ${taskAlias}.assigned_to = ${employeeIdParam}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(${taskAlias}.assignee_ids, '[]'::jsonb)) AS task_assignee(employee_id)
        WHERE task_assignee.employee_id = ${employeeIdParam}
      )
    )
  `;
}

function buildTaskSelfScopePredicate(params, user, {
  taskAlias = "t",
  projectAlias = "project",
} = {}) {
  params.push(user?.employee_id || "");
  const employeeIdParam = `$${params.length}`;
  const ownerPredicates = [
    `${taskAlias}.created_by = ${employeeIdParam}`,
    `${taskAlias}.assigned_by = ${employeeIdParam}`,
  ];

  if (projectAlias) {
    ownerPredicates.push(`COALESCE(${projectAlias}.uploaded_by = ${employeeIdParam}, FALSE)`);
  }

  return `
    (
      ${buildTaskAssigneePredicate(employeeIdParam, taskAlias)}
      OR ${ownerPredicates.join("\n      OR ")}
    )
  `;
}

function buildTaskProjectVisibilityPredicate(params, user, {
  projectAlias = "project",
  fixtureAlias = "fixture",
} = {}) {
  params.push(user?.employee_id || "");
  const rootParam = `$${params.length}`;

  return `
    (
      ${projectAlias}.id IS NULL
      OR EXISTS (
        ${buildVisibleUsersCte(rootParam)}
        SELECT 1
        WHERE ${visibleProjectPredicate(projectAlias)}
          AND (
            ${fixtureAlias}.id IS NULL
            OR ${visibleFixturePredicate(fixtureAlias, projectAlias)}
          )
      )
    )
  `;
}

function buildTaskAccessPredicate(user, params, options = {}) {
  const {
    taskAlias = "t",
    projectAlias = "project",
    fixtureAlias = "fixture",
  } = options;

  if (!user?.employee_id) {
    return "1 = 0";
  }

  if (hasProjectAuthorityOrAdmin(user)) {
    return "1 = 1";
  }

  const selfScopePredicate = buildTaskSelfScopePredicate(params, user, { taskAlias, projectAlias });

  if (hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS) && user?.department_id) {
    params.push(user.department_id);
    const departmentParam = `$${params.length}`;
    const projectVisibilityPredicate = buildTaskProjectVisibilityPredicate(params, user, {
      projectAlias,
      fixtureAlias,
    });

    return `
      (
        (
          ${taskAlias}.department_id = ${departmentParam}
          AND ${projectVisibilityPredicate}
        )
        OR ${selfScopePredicate}
      )
    `;
  }

  if (hasPermission(user, PERMISSIONS.VIEW_SELF_TASKS)) {
    return selfScopePredicate;
  }

  return "1 = 0";
}

function getTaskAccess(user) {
  const params = [];
  const accessPredicate = buildTaskAccessPredicate(user, params);

  return {
    clause: `
      WHERE t.status <> 'cancelled'
        AND ${accessPredicate}
    `,
    params,
  };
}

function filterUsersForScope(currentUser, users, scope = USER_SCOPES.ACCESSIBLE) {
  if (scope === USER_SCOPES.ASSIGNABLE) {
    return users.filter((candidate) => canAssignTo(currentUser, candidate));
  }

  if (isAdmin(currentUser) || hasOrgWideVisibility(currentUser)) {
    return users;
  }

  return users.filter((candidate) => canAccessUser(currentUser, candidate));
}

module.exports = {
  GetAccessibleUserIds,
  HasPermission,
  buildTaskAccessPredicate,
  canAccessUser,
  canAccessDepartment,
  canAccessTask,
  canAssignTo,
  canVerifyTask,
  filterUsersForScope,
  getRoleId,
  getRoleLevel,
  getTaskAccess,
  getAccessibleUserIds: GetAccessibleUserIds,
  getTaskAssigneeIds,
  getVisibleUserIds,
  hasOrgWideVisibility,
  hasPermission,
  isTaskDirectAssignee,
  isTaskOwnedByUser,
  isAdmin,
  isProjectAuthorityRole,
  isSupervisor,
  isTaskAssignee,
};
