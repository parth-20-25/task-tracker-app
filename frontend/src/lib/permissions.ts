import type { Role, User } from "@/types";

export const PERMISSIONS = {
  ASSIGN_TASK: "can_assign_tasks",
  TRANSFER_TASK: "transfer_task",
  APPROVE_COMPLETED_TASK: "approve_completed_task",
  APPROVE_QUALITY: "can_approve_quality",
  CHANGE_FIXTURE_STAGE: "change_fixture_stage",
  DELETE_WBS_BATCH: "delete_wbs_batch",
  REOPEN_FIXTURE_STAGE: "reopen_fixture_stage",
  MANIPULATE_FIXTURE_STAGE: "manipulate_fixture_stage",
  VIEW_SELF_TASKS: "can_view_self_tasks",
  VIEW_ALL_TASKS: "can_view_all_tasks",
  CREATE_TASK: "can_create_task",
  EDIT_TASK: "can_edit_task",
  DELETE_TASK: "can_delete_task",
  UPLOAD_PROOFS: "can_upload_proofs",
  UPLOAD_DATA: "can_upload_data",
  UPLOAD_LEGACY_DESIGN_DATA: "upload_legacy_design_data",
  UPLOAD_NATIVE_DESIGN_DATA: "upload_native_design_data",
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
  can_verify_task: PERMISSIONS.APPROVE_COMPLETED_TASK,
  view_self_user: PERMISSIONS.VIEW_SELF_ANALYTICS,
  view_self_department: PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS,
  view_department_comparison: PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS,
  view_user_comparison: PERMISSIONS.VIEW_ALL_USERS_ANALYTICS,
  scope_department_only: PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS,
  scope_all_departments: PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS,
};

export const PERMISSION_OPTIONS = Object.values(PERMISSIONS);

export const PERMISSION_LABELS: Partial<Record<(typeof PERMISSION_OPTIONS)[number], string>> = {
  [PERMISSIONS.VIEW_SELF_TASKS]: "View Self Tasks Only",
  [PERMISSIONS.VIEW_ALL_TASKS]: "View All Tasks",
};

export function getPermissionLabel(permission: string) {
  return PERMISSION_LABELS[permission as (typeof PERMISSION_OPTIONS)[number]] || permission;
}

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
  canTransferTasks: boolean;
  canApproveCompletedTasks: boolean;
  canApproveQuality: boolean;
  canChangeFixtureStage: boolean;
  canDeleteWbsBatch: boolean;
  canReopenFixtureStage: boolean;
  canManipulateFixtureStage: boolean;
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
  canUploadLegacyDesignData: boolean;
  canUploadNativeDesignData: boolean;
  canUploadProofs: boolean;
  canViewSelfTasks: boolean;
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

export function getResolvedUserPermissionIds(user: User | null | undefined) {
  if (!user) {
    return [];
  }

  const permissionSet = buildRolePermissionSet(user.role);

  (user.permissions || []).forEach((permissionId) => {
    permissionSet.add(normalizePermissionId(permissionId));
  });

  return [...permissionSet].sort();
}

export function hasAnyUserPermission(user: User | null | undefined, permissions: readonly string[]) {
  return permissions.some((permission) => hasUserPermission(user, permission));
}

export function isAdminUser(user: User | null | undefined) {
  return user?.role?.hierarchy_level === 1 || user?.role?.id === "r1" || user?.role_id === "r1";
}

export function isProjectAuthorityUser(user: User | null | undefined) {
  const roleName = normalizeRoleKey(user?.role?.name);
  const roleId = normalizeRoleKey(user?.role?.id || user?.role_id);
  const hierarchyLevel = Number(user?.role?.hierarchy_level);

  return (Number.isFinite(hierarchyLevel) && hierarchyLevel <= 2)
    || ["admin", "ceo", "director", "director_ceo", "ceo_director", "plant_head", "r1", "r2"].includes(roleName)
    || ["admin", "ceo", "director", "director_ceo", "ceo_director", "plant_head", "r1", "r2"].includes(roleId)
    || isAdminUser(user);
}

function normalizeRoleKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildUiAccess(user: User | null | undefined): UiAccess {
  const projectAuthority = isProjectAuthorityUser(user);
  const canAssignTasks = hasUserPermission(user, PERMISSIONS.ASSIGN_TASK);
  const canTransferTasks = hasUserPermission(user, PERMISSIONS.TRANSFER_TASK);
  const canApproveCompletedTasks = hasUserPermission(user, PERMISSIONS.APPROVE_COMPLETED_TASK);
  const canApproveQuality = hasUserPermission(user, PERMISSIONS.APPROVE_QUALITY);
  const canChangeFixtureStage = hasUserPermission(user, PERMISSIONS.CHANGE_FIXTURE_STAGE);
  const canDeleteWbsBatch = hasUserPermission(user, PERMISSIONS.DELETE_WBS_BATCH);
  const canReopenFixtureStage = hasUserPermission(user, PERMISSIONS.REOPEN_FIXTURE_STAGE);
  const canManipulateFixtureStage = hasUserPermission(user, PERMISSIONS.MANIPULATE_FIXTURE_STAGE);
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
  const canUploadLegacyDesignData = hasUserPermission(user, PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA) || canUploadData;
  const canUploadNativeDesignData = hasUserPermission(user, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA);
  const canUploadProofs = hasUserPermission(user, PERMISSIONS.UPLOAD_PROOFS);
  const canViewSelfTasks = hasUserPermission(user, PERMISSIONS.VIEW_SELF_TASKS);
  const canViewAllTasks = projectAuthority || hasUserPermission(user, PERMISSIONS.VIEW_ALL_TASKS);
  const canViewReports = projectAuthority || hasUserPermission(user, PERMISSIONS.VIEW_REPORTS);
  const canExportReports = projectAuthority || hasUserPermission(user, PERMISSIONS.EXPORT_REPORTS);
  const canViewDepartmentAnalytics = hasUserPermission(user, PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS);
  const canViewAllDepartmentsAnalytics = hasUserPermission(user, PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS);
  const canViewAllUsersAnalytics = hasUserPermission(user, PERMISSIONS.VIEW_ALL_USERS_ANALYTICS);
  const canViewAnalytics = hasAnyUserPermission(user, ANALYTICS_VISIBILITY_PERMISSIONS);

  return {
    canAssignTasks,
    canTransferTasks,
    canApproveCompletedTasks,
    canApproveQuality,
    canChangeFixtureStage,
    canDeleteWbsBatch,
    canReopenFixtureStage,
    canManipulateFixtureStage,
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
    canUploadLegacyDesignData,
    canUploadNativeDesignData,
    canUploadProofs,
    canViewSelfTasks,
    canViewAllTasks,
    canViewAnalytics,
    canViewReports,
    canExportReports,
    canViewTeamTasks: canViewAllTasks,
    canViewVerifications: hasAnyUserPermission(user, [PERMISSIONS.APPROVE_COMPLETED_TASK, PERMISSIONS.APPROVE_QUALITY]),
    canAccessAdminPanel: isAdminUser(user) || hasAnyUserPermission(user, ADMIN_PANEL_PERMISSIONS),
    canViewAuditLogs: isAdminUser(user),
    canViewDepartmentAnalytics,
    canViewAllDepartmentsAnalytics,
    canViewAllUsersAnalytics,
  };
}
