import type { Role, User } from "@/types";

export const PERMISSIONS = {
  ASSIGN_TASK: "can_assign_tasks",
  VERIFY_TASK: "can_verify_task",
  APPROVE_QUALITY: "can_approve_quality",
  VIEW_ALL_TASKS: "can_view_all_tasks",
  CREATE_TASK: "can_create_task",
  EDIT_TASK: "can_edit_task",
  DELETE_TASK: "can_delete_task",
  UPLOAD_PROOFS: "can_upload_proofs",
  UPLOAD_DATA: "can_upload_data",
  MANAGE_USERS: "can_manage_users",
  CREATE_USER: "can_create_user",
  EDIT_USER: "can_edit_user",
  ACTIVATE_USER: "can_activate_user",
  MANAGE_ROLES: "can_manage_roles",
  MANAGE_WORKFLOWS: "can_manage_workflows",
  MANAGE_DEPARTMENTS: "can_manage_departments",
  MANAGE_SHIFTS: "can_manage_shifts",
  MANAGE_MACHINES: "can_manage_machines",
  MANAGE_KPIS: "can_manage_kpis",
  MANAGE_ESCALATION_RULES: "can_manage_escalation_rules",
  VIEW_REPORTS: "can_view_reports",
  EXPORT_REPORTS: "can_export_reports",
  VIEW_SELF_ANALYTICS: "view_self_analytics",
  VIEW_DEPARTMENT_ANALYTICS: "view_department_analytics",
  VIEW_ALL_DEPARTMENTS_ANALYTICS: "view_all_departments_analytics",
  VIEW_ALL_USERS_ANALYTICS: "view_all_users_analytics",
  VIEW_REWORK_ANALYTICS: "view_rework_analytics",
  VIEW_DEADLINE_ANALYTICS: "view_deadline_analytics",
  VIEW_EFFICIENCY_ANALYTICS: "view_efficiency_analytics",
  VIEW_WORKFLOW_HEALTH: "view_workflow_health",
  VIEW_PREDICTIVE_ANALYTICS: "view_predictive_analytics",
} as const;

export const PERMISSION_ALIASES: Record<string, string> = {
  can_assign_task: PERMISSIONS.ASSIGN_TASK,
  view_self_user: PERMISSIONS.VIEW_SELF_ANALYTICS,
  view_self_department: PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS,
  view_department_comparison: PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS,
  view_user_comparison: PERMISSIONS.VIEW_ALL_USERS_ANALYTICS,
  scope_department_only: PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS,
  scope_all_departments: PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS,
};

export const PERMISSION_OPTIONS = Object.values(PERMISSIONS);

const ANALYTICS_VISIBILITY_PERMISSIONS = [
  PERMISSIONS.VIEW_SELF_ANALYTICS,
  PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS,
  PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS,
  PERMISSIONS.VIEW_ALL_USERS_ANALYTICS,
  PERMISSIONS.VIEW_REWORK_ANALYTICS,
  PERMISSIONS.VIEW_DEADLINE_ANALYTICS,
  PERMISSIONS.VIEW_EFFICIENCY_ANALYTICS,
  PERMISSIONS.VIEW_WORKFLOW_HEALTH,
  PERMISSIONS.VIEW_PREDICTIVE_ANALYTICS,
];

const ADMIN_PANEL_PERMISSIONS = [
  PERMISSIONS.MANAGE_USERS,
  PERMISSIONS.MANAGE_ROLES,
  PERMISSIONS.MANAGE_DEPARTMENTS,
  PERMISSIONS.MANAGE_SHIFTS,
  PERMISSIONS.MANAGE_MACHINES,
  PERMISSIONS.MANAGE_WORKFLOWS,
  PERMISSIONS.MANAGE_KPIS,
  PERMISSIONS.MANAGE_ESCALATION_RULES,
];

export interface UiAccess {
  canAssignTasks: boolean;
  canApproveQuality: boolean;
  canCreateTasks: boolean;
  canEditTasks: boolean;
  canDeleteTasks: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canManageDepartments: boolean;
  canManageShifts: boolean;
  canManageMachines: boolean;
  canManageWorkflows: boolean;
  canUploadData: boolean;
  canUploadProofs: boolean;
  canViewAllTasks: boolean;
  canViewAnalytics: boolean;
  canViewReports: boolean;
  canExportReports: boolean;
  canViewTeamTasks: boolean;
  canViewVerifications: boolean;
  canAccessAdminPanel: boolean;
  canViewAuditLogs: boolean;
  canViewDepartmentAnalytics: boolean;
  canViewAllDepartmentsAnalytics: boolean;
  canViewAllUsersAnalytics: boolean;
}

export function normalizePermissionId(permission: string) {
  return PERMISSION_ALIASES[permission] || permission;
}

export function buildRolePermissionSet(role: Role | null | undefined) {
  const permissionSet = new Set<string>();

  if (!role?.permissions || typeof role.permissions !== "object") {
    return permissionSet;
  }

  if (role.permissions.all === true) {
    PERMISSION_OPTIONS.forEach((permissionId) => {
      permissionSet.add(permissionId);
    });
    return permissionSet;
  }

  Object.entries(role.permissions).forEach(([permissionId, enabled]) => {
    if (enabled === true) {
      permissionSet.add(normalizePermissionId(permissionId));
    }
  });

  return permissionSet;
}

export function hasUserPermission(user: User | null | undefined, permission: string) {
  if (!user || !permission) {
    return false;
  }

  const normalizedPermission = normalizePermissionId(permission);
  const rolePermissionSet = buildRolePermissionSet(user.role);

  if (rolePermissionSet.has(normalizedPermission)) {
    return true;
  }

  return (user.permissions || []).some(
    (grantedPermission) => normalizePermissionId(grantedPermission) === normalizedPermission,
  );
}

export function hasAnyUserPermission(user: User | null | undefined, permissions: readonly string[]) {
  return permissions.some((permission) => hasUserPermission(user, permission));
}

function isAdminUser(user: User | null | undefined) {
  return user?.role?.hierarchy_level === 1 || user?.role?.id === "r1" || user?.role_id === "r1";
}

export function buildUiAccess(user: User | null | undefined): UiAccess {
  const canAssignTasks = hasUserPermission(user, PERMISSIONS.ASSIGN_TASK);
  const canApproveQuality = hasUserPermission(user, PERMISSIONS.APPROVE_QUALITY);
  const canCreateTasks = hasUserPermission(user, PERMISSIONS.CREATE_TASK);
  const canEditTasks = hasUserPermission(user, PERMISSIONS.EDIT_TASK);
  const canDeleteTasks = hasUserPermission(user, PERMISSIONS.DELETE_TASK);
  const canManageUsers = hasUserPermission(user, PERMISSIONS.MANAGE_USERS);
  const canManageRoles = hasUserPermission(user, PERMISSIONS.MANAGE_ROLES);
  const canManageDepartments = hasUserPermission(user, PERMISSIONS.MANAGE_DEPARTMENTS);
  const canManageShifts = hasUserPermission(user, PERMISSIONS.MANAGE_SHIFTS);
  const canManageMachines = hasUserPermission(user, PERMISSIONS.MANAGE_MACHINES);
  const canManageWorkflows = hasUserPermission(user, PERMISSIONS.MANAGE_WORKFLOWS);
  const canUploadData = hasUserPermission(user, PERMISSIONS.UPLOAD_DATA);
  const canUploadProofs = hasUserPermission(user, PERMISSIONS.UPLOAD_PROOFS);
  const canViewAllTasks = hasUserPermission(user, PERMISSIONS.VIEW_ALL_TASKS);
  const canViewReports = hasUserPermission(user, PERMISSIONS.VIEW_REPORTS);
  const canExportReports = hasUserPermission(user, PERMISSIONS.EXPORT_REPORTS);
  const canViewDepartmentAnalytics = hasUserPermission(user, PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS);
  const canViewAllDepartmentsAnalytics = hasUserPermission(user, PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS);
  const canViewAllUsersAnalytics = hasUserPermission(user, PERMISSIONS.VIEW_ALL_USERS_ANALYTICS);
  const canViewAnalytics = hasAnyUserPermission(user, ANALYTICS_VISIBILITY_PERMISSIONS);

  return {
    canAssignTasks,
    canApproveQuality,
    canCreateTasks,
    canEditTasks,
    canDeleteTasks,
    canManageUsers,
    canManageRoles,
    canManageDepartments,
    canManageShifts,
    canManageMachines,
    canManageWorkflows,
    canUploadData,
    canUploadProofs,
    canViewAllTasks,
    canViewAnalytics,
    canViewReports,
    canExportReports,
    canViewTeamTasks: canViewAllTasks,
    canViewVerifications: hasAnyUserPermission(user, [PERMISSIONS.VERIFY_TASK, PERMISSIONS.APPROVE_QUALITY]),
    canAccessAdminPanel: isAdminUser(user) || hasAnyUserPermission(user, ADMIN_PANEL_PERMISSIONS),
    canViewAuditLogs: isAdminUser(user),
    canViewDepartmentAnalytics,
    canViewAllDepartmentsAnalytics,
    canViewAllUsersAnalytics,
  };
}
