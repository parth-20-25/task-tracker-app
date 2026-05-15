const { PERMISSIONS, ROLE_LEVELS, USER_SCOPES } = require("../config/constants");
const { pool } = require("../db");
const {
  GetAccessibleUserIds,
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
const { normalizePermissionIds } = require("../repositories/permissionRepository");

const PERMISSION_ALIASES = {
  can_assign_task: [PERMISSIONS.ASSIGN_TASK],
  [PERMISSIONS.ASSIGN_TASK]: ["can_assign_task"],
  can_verify_task: [PERMISSIONS.APPROVE_COMPLETED_TASK],
  [PERMISSIONS.APPROVE_COMPLETED_TASK]: ["can_verify_task"],
};

const PROJECT_AUTHORITY_ROLE_NAMES = new Set(["admin", "ceo", "director"]);

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

function normalizeRoleName(value) {
  return String(value || "").trim().toLowerCase();
}

function isProjectAuthorityRole(user) {
  const roleDetails = getRoleDetails(user);
  const roleName = normalizeRoleName(roleDetails?.name);
  const roleId = normalizeRoleName(getRoleId(user));

  return PROJECT_AUTHORITY_ROLE_NAMES.has(roleName) || PROJECT_AUTHORITY_ROLE_NAMES.has(roleId);
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

  if (isAdmin(user)) {
    return true;
  }

  return getVisibleUserIds(user).includes(targetEmployeeId);
}

function canAccessDepartment(user, departmentId) {
  if (isAdmin(user)) {
    return true;
  }

  if (!user?.department_id || !departmentId) {
    return false;
  }

  return user.department_id === departmentId;
}

function canAccessTask(user, task) {
  if (!task) {
    return false;
  }

  const visibleUserIds = getVisibleUserIds(user);
  if (task.project_id && !task.fixture_uploaded_by && !task.project_uploaded_by) {
    return false;
  }

  if (task.project_id && task.fixture_uploaded_by && !visibleUserIds.includes(task.fixture_uploaded_by)) {
    return false;
  }

  if (task.project_id && !task.fixture_uploaded_by && task.project_uploaded_by && !visibleUserIds.includes(task.project_uploaded_by)) {
    return false;
  }

  if (isAdmin(user)) {
    return true;
  }

  if (hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS) && canAccessDepartment(user, task.department_id)) {
    return true;
  }

  const taskAssigneeIds = [
    task.assigned_user_id,
    task.assigned_to,
    ...(Array.isArray(task.assignee_ids) ? task.assignee_ids : []),
  ].filter(Boolean);

  return taskAssigneeIds.some((employeeId) => visibleUserIds.includes(employeeId));
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

  if (!isAdmin(assigner) && assigner.department_id !== assignee.department_id) {
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
  if (isAdmin(actor)) {
    return true;
  }

  return canAccessDepartment(actor, task?.department_id || null);
}

function isTaskAssignee(user, task) {
  if (!user || !task) {
    return false;
  }

  return task.assigned_to === user.employee_id || (task.assignee_ids || []).includes(user.employee_id);
}

function getTaskAccess(user) {
  const projectVisibilityPredicate = (params) => {
    params.push(user?.employee_id || "");
    const rootParam = `$${params.length}`;
    return `
      (
        project.id IS NULL
        OR EXISTS (
          ${buildVisibleUsersCte(rootParam)}
          SELECT 1
          WHERE ${visibleProjectPredicate("project")}
            AND (
              fixture.id IS NULL
              OR ${visibleFixturePredicate("fixture", "project")}
            )
        )
      )
    `;
  };

  if (isAdmin(user)) {
    const params = [];
    return {
      clause: `WHERE t.status <> 'cancelled' AND ${projectVisibilityPredicate(params)}`,
      params,
    };
  }

  if (hasPermission(user, PERMISSIONS.VIEW_ALL_TASKS) && user?.department_id) {
    const params = [user.department_id];
    return {
      clause: `WHERE t.status <> 'cancelled' AND t.department_id = $1 AND ${projectVisibilityPredicate(params)}`,
      params,
    };
  }

  const visibleUserIds = getVisibleUserIds(user);

  if (visibleUserIds.length === 0) {
    return { clause: "WHERE 1 = 0", params: [] };
  }

  const params = [visibleUserIds];
  return {
    clause: `
      WHERE t.status <> 'cancelled'
        AND (
          COALESCE(t.assigned_user_id, t.assigned_to) = ANY($1::text[])
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(t.assignee_ids, '[]'::jsonb)) AS task_assignee(employee_id)
            WHERE task_assignee.employee_id = ANY($1::text[])
          )
        )
        AND ${projectVisibilityPredicate(params)}
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
  getVisibleUserIds,
  hasPermission,
  isAdmin,
  isProjectAuthorityRole,
  isSupervisor,
  isTaskAssignee,
};
