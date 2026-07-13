const { PERMISSIONS, ROLE_LEVELS, USER_SCOPES } = require("../config/constants");
const { pool } = require("../db");
const {
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  isProjectAuthorityRoleIdentity,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
const { normalizePermissionIds, normalizePermissionId } = require("../repositories/permissionRepository");

const OPERATIONAL_CONTROLLER_ROLE_KEYS = new Set([
  "admin",
  "ceo",
  "director",
  "director_ceo",
  "ceo_director",
  "general_manager",
  "gm",
  "plant_head",
  "team_leader",
  "line_manager",
  "co_leader",
  "team_co_leader",
  "shift_incharge",
]);

const OPERATIONAL_CONTROLLER_ROLE_IDS = new Set([
  "admin",
  "ceo",
  "director",
  "director_ceo",
  "general_manager",
  "gm",
  "team_leader",
  "co_leader",
  "r1",
  "r2",
  "r3",
  "r4",
]);

function normalizeRoleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
  const roleDetails = getRoleDetails(user);

  return isAdmin(user)
    || isProjectAuthorityRoleIdentity(roleDetails?.name)
    || isProjectAuthorityRoleIdentity(getRoleId(user));
}

function isExecutiveDashboardRole(user) {
  return isProjectAuthorityRole(user);
}

function isOperationalControllerRole(user) {
  const roleDetails = getRoleDetails(user);
  const roleNameKey = normalizeRoleKey(roleDetails?.name);
  const roleIdKey = normalizeRoleKey(getRoleId(user));

  return isProjectAuthorityRole(user)
    || OPERATIONAL_CONTROLLER_ROLE_KEYS.has(roleNameKey)
    || OPERATIONAL_CONTROLLER_ROLE_IDS.has(roleIdKey);
}

function isDesign2DSubdivisionUser(user) {
  const departmentIdKey = normalizeRoleKey(user?.department_id);
  const departmentNameKey = normalizeRoleKey(user?.department?.name);
  const subdivisionIdKey = normalizeRoleKey(user?.subdivision_id);
  const subdivisionNameKey = normalizeRoleKey(user?.subdivision?.subdivision_name);

  return (departmentIdKey === "design" || departmentNameKey === "design")
    && (subdivisionIdKey === "2d" || subdivisionNameKey === "2d");
}

function getRolePermissionFlags(user) {
  const roleDetails = getRoleDetails(user);

  if (!roleDetails?.permissions || typeof roleDetails.permissions !== "object") {
    return [];
  }

  const permissionIds = Object.entries(roleDetails.permissions)
    .filter(([, enabled]) => enabled === true)
    .map(([permission]) => permission);

  return normalizePermissionIds(permissionIds);
}

function hasPermission(user, permission) {
  if (!user || !permission) {
    return false;
  }

  const normalizedPermission = normalizePermissionId(permission);

  const grantedPermissions = new Set([
    ...(Array.isArray(user.permissions) ? normalizePermissionIds(user.permissions) : []),
    ...getRolePermissionFlags(user),
  ]);

  if (normalizedPermission === PERMISSIONS.SELF_APPROVE) {
    return grantedPermissions.has(normalizedPermission);
  }

  if (getRoleDetails(user)?.permissions?.all === true) {
    return true;
  }

  return grantedPermissions.has(normalizedPermission);
}

function canViewProjectFixtures(user) {
  return isOperationalControllerRole(user)
    || (
      isDesign2DSubdivisionUser(user)
      && (
        hasPermission(user, PERMISSIONS.VIEW_SELF_TASKS)
        || hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS)
      )
    );
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
  const roleDetails = getRoleDetails(user);
  const roleId = getRoleId(user);
  return isProjectAuthorityRoleIdentity(roleDetails?.name) && String(roleDetails?.name || "").trim().toLowerCase() === "admin"
    || String(roleId || "").trim().toLowerCase() === "r1"
    || String(roleId || "").trim().toLowerCase() === "admin";
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

  if (isAdmin(user) || isProjectAuthorityRole(user)) {
    return true;
  }

  return getVisibleUserIds(user).includes(targetEmployeeId);
}

function canAccessDepartment(user, departmentId) {
  if (isAdmin(user) || isProjectAuthorityRole(user)) {
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
    task.project_created_by_user_id,
  ].filter(Boolean).includes(user.employee_id);
}

function isTaskVisibleThroughProjectHierarchy(user, task) {
  if (!task?.project_id) {
    return true;
  }

  const owner = task.project_created_by_user_id || null;
  if (!owner) {
    return false;
  }

  return getVisibleUserIds(user).includes(owner);
}

function canAccessTask(user, task) {
  if (!task) {
    return false;
  }

  if (isAdmin(user) || isProjectAuthorityRole(user)) {
    return true;
  }

  if (
    task.task_type === "additional_design"
    && isOperationalControllerRole(user)
    && hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS)
    && canAccessDepartment(user, task.department_id)
  ) {
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
  if (!isOperationalControllerRole(actor)) {
    return false;
  }

  const requiredPermission = task?.approval_stage === "quality"
    ? PERMISSIONS.APPROVE_QUALITY
    : PERMISSIONS.APPROVE_COMPLETED_TASK;

  if (!hasPermission(actor, requiredPermission)) {
    return false;
  }

  // Approval should be scoped by department (or admin), not by "visible/assignee" access.
  // This prevents approvers (e.g., team leaders) from being blocked when they are not task assignees.
  if (isAdmin(actor) || isProjectAuthorityRole(actor)) {
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

function is2DSubdivisionUserForAccess(user) {
  const { is2DSubdivisionUser } = require("../repositories/projectSubdivisionRoutingRepository");
  return is2DSubdivisionUser(user);
}

function is2DLeaderUserForAccess(user) {
  const { is2DLeaderUser } = require("../repositories/projectSubdivisionRoutingRepository");
  return is2DLeaderUser(user);
}

function build2DCurrentStageTaskPredicate(employeeIdParam, {
  projectAlias = "project",
  fixtureAlias = "fixture",
  requireLeaderAssignment = false,
} = {}) {
  const {
    assignedTo2DLeaderProjectSql,
    current2DWorkflowStageFixtureSql,
  } = require("../repositories/projectSubdivisionRoutingRepository");

  const projectAssignmentPredicate = requireLeaderAssignment
    ? assignedTo2DLeaderProjectSql(projectAlias, employeeIdParam)
    : "TRUE";

  return `
    (
      ${projectAlias}.id IS NOT NULL
      AND ${fixtureAlias}.id IS NOT NULL
      AND ${projectAssignmentPredicate}
      AND ${current2DWorkflowStageFixtureSql(fixtureAlias, projectAlias)}
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
    ownerPredicates.push(`COALESCE(${projectAlias}.created_by_user_id = ${employeeIdParam}, FALSE)`);
    if (user?.id) {
      params.push(String(user.id));
      ownerPredicates.push(`COALESCE(${projectAlias}.created_by_user_id = $${params.length}, FALSE)`);
    }
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

  if (isAdmin(user) || isProjectAuthorityRole(user)) {
    return "1 = 1";
  }

  if (is2DSubdivisionUserForAccess(user)) {
    params.push(user.employee_id);
    const employeeIdParam = `$${params.length}`;
    const is2DLeader = is2DLeaderUserForAccess(user);
    const current2DStagePredicate = build2DCurrentStageTaskPredicate(employeeIdParam, {
      projectAlias,
      fixtureAlias,
      requireLeaderAssignment: is2DLeader,
    });

    if (is2DLeader) {
      params.push(user.department_id || "");
      const departmentParam = `$${params.length}`;
      return `
        (
          ${current2DStagePredicate}
          OR (
            ${taskAlias}.task_type = 'additional_design'
            AND ${taskAlias}.department_id = ${departmentParam}
          )
        )
      `;
    }

    return `
      (
        (
          ${buildTaskAssigneePredicate(employeeIdParam, taskAlias)}
          AND ${current2DStagePredicate}
        )
        OR (
          ${taskAlias}.task_type = 'additional_design'
          AND ${taskAlias}.design_team = '2D'
          AND ${buildTaskAssigneePredicate(employeeIdParam, taskAlias)}
        )
      )
    `;
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
      WHERE ${accessPredicate}
    `,
    params,
  };
}

function filterUsersForScope(currentUser, users, scope = USER_SCOPES.ACCESSIBLE) {
  if (scope === USER_SCOPES.ASSIGNABLE) {
    return users.filter((candidate) => canAssignTo(currentUser, candidate));
  }

  if (isAdmin(currentUser)) {
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
  canViewProjectFixtures,
  canVerifyTask,
  filterUsersForScope,
  getRoleId,
  getRoleLevel,
  getTaskAccess,
  getAccessibleUserIds: GetAccessibleUserIds,
  getTaskAssigneeIds,
  getVisibleUserIds,
  hasPermission,
  isTaskDirectAssignee,
  isTaskOwnedByUser,
  isAdmin,
  isExecutiveDashboardRole,
  isOperationalControllerRole,
  isProjectAuthorityRole,
  isSupervisor,
  isTaskAssignee,
};
