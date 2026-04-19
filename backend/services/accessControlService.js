const { PERMISSIONS, ROLE_LEVELS, USER_SCOPES } = require("../config/constants");

const PERMISSION_ALIASES = {
  can_assign_task: [PERMISSIONS.ASSIGN_TASK],
  [PERMISSIONS.ASSIGN_TASK]: ["can_assign_task"],
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

function isAdmin(user) {
  return getRoleLevel(user) === 1;
}

function isSupervisor(user) {
  return (getRoleLevel(user) ?? Number.MAX_SAFE_INTEGER) <= 4;
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

  return canAccessDepartment(user, task.department_id);
}

function canAssignTo(assigner, assignee) {
  const assignerLevel = getRoleLevel(assigner);
  const assigneeLevel = getRoleLevel(assignee);

  if (!assigner || !assignee || !assignerLevel || !assigneeLevel) {
    return false;
  }

  if (!hasPermission(assigner, PERMISSIONS.ASSIGN_TASK)) {
    return false;
  }

  if (!assignee.is_active || assignee.employee_id === assigner.employee_id) {
    return false;
  }

  if (!canAccessDepartment(assigner, assignee.department_id)) {
    return false;
  }

  return assignerLevel < assigneeLevel;
}

function canVerifyTask(actor, task) {
  const requiredPermission = task?.approval_stage === "quality"
    ? PERMISSIONS.APPROVE_QUALITY
    : PERMISSIONS.VERIFY_TASK;

  if (!hasPermission(actor, requiredPermission)) {
    return false;
  }

  const actorLevel = getRoleLevel(actor);
  const assigneeLevel = getRoleLevel(task?.assignee);

  if (!isSupervisor(actor) || !canAccessTask(actor, task) || !actorLevel || !assigneeLevel) {
    return false;
  }

  // Supervisors can only verify tasks at their own level or below.
  return assigneeLevel >= actorLevel;
}

function isTaskAssignee(user, task) {
  if (!user || !task) {
    return false;
  }

  return task.assigned_to === user.employee_id || (task.assignee_ids || []).includes(user.employee_id);
}

function getTaskAccess(user) {
  if (isAdmin(user)) {
    return { clause: "WHERE t.status <> 'cancelled'", params: [] };
  }

  if (!user?.department_id) {
    return { clause: "WHERE 1 = 0", params: [] };
  }

  return {
    clause: "WHERE t.department_id = $1 AND t.status <> 'cancelled'",
    params: [user.department_id],
  };
}

function filterUsersForScope(currentUser, users, scope = USER_SCOPES.ACCESSIBLE) {
  if (scope === USER_SCOPES.ASSIGNABLE) {
    return users.filter((candidate) => canAssignTo(currentUser, candidate));
  }

  if (isAdmin(currentUser)) {
    return users;
  }

  if (isSupervisor(currentUser)) {
    return users.filter((candidate) => candidate.department_id === currentUser.department_id);
  }

  return users.filter((candidate) => candidate.employee_id === currentUser.employee_id);
}

module.exports = {
  canAccessDepartment,
  canAccessTask,
  canAssignTo,
  canVerifyTask,
  filterUsersForScope,
  getRoleId,
  getRoleLevel,
  getTaskAccess,
  hasPermission,
  isAdmin,
  isSupervisor,
  isTaskAssignee,
};
