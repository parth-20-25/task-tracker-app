import type { Role, User } from "@/types";

export const PERMISSIONS = {
  ASSIGN_TASK: "can_assign_tasks",
  TRANSFER_TASK: "transfer_task",
  APPROVE_COMPLETED_TASK: "approve_completed_task",
  SELF_APPROVE: "self_approve",
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
  CONTROL_DESIGN_WORKSPACE_VIEW: "control_design.workspace.view",
  CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED: "control_design.projects.view_assigned",
  CONTROL_DESIGN_PROJECTS_VIEW_ALL: "control_design.projects.view_all",
  CONTROL_DESIGN_PROJECTS_CREATE: "control_design.projects.create",
  CONTROL_DESIGN_PROJECTS_EDIT: "control_design.projects.edit",
  CONTROL_DESIGN_PROJECTS_ASSIGN: "control_design.projects.assign",
  CONTROL_DESIGN_PROJECTS_REASSIGN: "control_design.projects.reassign",
  CONTROL_DESIGN_PROJECTS_CANCEL: "control_design.projects.cancel",
  CONTROL_DESIGN_STAGES_START: "control_design.stages.start",
  CONTROL_DESIGN_STAGES_SUBMIT: "control_design.stages.submit",
  CONTROL_DESIGN_PATHS_UPDATE: "control_design.paths.update",
  CONTROL_DESIGN_APPROVALS_REVIEW: "control_design.approvals.review",
  CONTROL_DESIGN_APPROVALS_APPROVE: "control_design.approvals.approve",
  CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES: "control_design.approvals.request_changes",
  CONTROL_DESIGN_PROOFS_VIEW: "control_design.proofs.view",
  CONTROL_DESIGN_PROOFS_UPLOAD: "control_design.proofs.upload",
  CONTROL_DESIGN_REVISIONS_RAISE: "control_design.revisions.raise",
  CONTROL_DESIGN_REVISIONS_EXECUTE: "control_design.revisions.execute",
  CONTROL_DESIGN_REVISIONS_REVIEW: "control_design.revisions.review",
  CONTROL_DESIGN_STAGES_MARK_PRE_COMPLETED: "control_design.stages.mark_pre_completed",
  CONTROL_DESIGN_STAGES_OVERRIDE_UNLOCK: "control_design.stages.override_unlock",
  CONTROL_DESIGN_STAGES_SKIP_OVERRIDE: "control_design.stages.skip_override",
  CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED: "control_design.projects.mark_dispatched",
  CONTROL_DESIGN_PROJECTS_REOPEN_AFTER_DISPATCH: "control_design.projects.reopen_after_dispatch",
  CONTROL_DESIGN_AUDIT_VIEW: "control_design.audit.view",
  CONTROL_DESIGN_REPORTS_VIEW: "control_design.reports.view",
  CONTROL_DESIGN_CREATE_PROJECTS: "control_design.projects.create",
  CONTROL_DESIGN_VIEW_ALL_PROJECTS: "control_design.projects.view_all",
  CONTROL_DESIGN_ASSIGN_PROJECTS: "control_design.projects.assign",
  CONTROL_DESIGN_REASSIGN_PROJECTS: "control_design.projects.reassign",
} as const;

export const PERMISSION_OPTIONS = [...new Set(Object.values(PERMISSIONS))];

export const PERMISSION_LABELS: Partial<Record<(typeof PERMISSION_OPTIONS)[number], string>> = {
  [PERMISSIONS.VIEW_SELF_TASKS]: "View Self Tasks Only",
  [PERMISSIONS.VIEW_ALL_TASKS]: "View All Tasks",
  [PERMISSIONS.SELF_APPROVE]: "Self Approve",
  [PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW]: "View Control Design Workspace",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED]: "View Assigned Control Design Projects",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL]: "View All Control Design Projects",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE]: "Create Control Design Projects",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_EDIT]: "Edit Control Design Projects",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN]: "Assign Control Design Projects",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN]: "Reassign Control Design Projects",
  [PERMISSIONS.CONTROL_DESIGN_STAGES_START]: "Start Control Design Stages",
  [PERMISSIONS.CONTROL_DESIGN_STAGES_SUBMIT]: "Submit Control Design Stages",
  [PERMISSIONS.CONTROL_DESIGN_PATHS_UPDATE]: "Update Control Design Paths",
  [PERMISSIONS.CONTROL_DESIGN_APPROVALS_REVIEW]: "Review Control Design Approvals",
  [PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE]: "Approve Control Design Submissions",
  [PERMISSIONS.CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES]: "Request Control Design Changes",
  [PERMISSIONS.CONTROL_DESIGN_PROOFS_VIEW]: "View Control Design Proofs",
  [PERMISSIONS.CONTROL_DESIGN_PROOFS_UPLOAD]: "Upload Control Design Proofs",
  [PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE]: "Raise Control Design Revisions",
  [PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE]: "Execute Control Design Revisions",
  [PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW]: "Review Control Design Revisions",
  [PERMISSIONS.CONTROL_DESIGN_STAGES_MARK_PRE_COMPLETED]: "Mark Control Design Stages Pre-Completed",
  [PERMISSIONS.CONTROL_DESIGN_STAGES_OVERRIDE_UNLOCK]: "Override Unlock Control Design Stages",
  [PERMISSIONS.CONTROL_DESIGN_STAGES_SKIP_OVERRIDE]: "Skip Control Design Stages By Override",
  [PERMISSIONS.CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED]: "Mark Control Design Projects Dispatched",
  [PERMISSIONS.CONTROL_DESIGN_AUDIT_VIEW]: "View Control Design Audit",
  [PERMISSIONS.CONTROL_DESIGN_REPORTS_VIEW]: "View Control Design Reports",
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
  canSelfApprove: boolean;
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
  canUploadNativeDesignData: boolean;
  canUploadProofs: boolean;
  canViewSelfTasks: boolean;
  canViewAllTasks: boolean;
  canViewAnalytics: boolean;
  canViewReports: boolean;
  canExportReports: boolean;
  canViewTeamTasks: boolean;
  canViewVerifications: boolean;
  canAccessProjectFixtures: boolean;
  canAccessAdminPanel: boolean;
  canViewAuditLogs: boolean;
  canViewDepartmentAnalytics: boolean;
  canViewAllDepartmentsAnalytics: boolean;
  canViewAllUsersAnalytics: boolean;
  canViewControlDesignWorkspace: boolean;
  canViewAssignedControlDesignProjects: boolean;
  canViewAllControlDesignProjects: boolean;
  canCreateControlDesignProjects: boolean;
  canEditControlDesignProjects: boolean;
  canAssignControlDesignProjects: boolean;
  canReassignControlDesignProjects: boolean;
  canStartControlDesignStages: boolean;
  canSubmitControlDesignStages: boolean;
  canUpdateControlDesignPaths: boolean;
  canReviewControlDesignApprovals: boolean;
  canApproveControlDesignSubmissions: boolean;
  canRequestControlDesignChanges: boolean;
  canRaiseControlDesignRevisions: boolean;
  canExecuteControlDesignRevisions: boolean;
  canReviewControlDesignRevisions: boolean;
  canMarkControlDesignPreCompleted: boolean;
  canOverrideUnlockControlDesignStages: boolean;
  canSkipControlDesignStages: boolean;
  canMarkControlDesignDispatched: boolean;
  canViewControlDesignAudit: boolean;
  canViewControlDesignReports: boolean;
}

const LEGACY_PERMISSION_MIGRATIONS: Record<string, string> = {
  "control_design.create_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE,
  "control_design.view_all_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL,
  "control_design.assign_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN,
  "control_design.reassign_projects": PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN,
};

const CONTROL_DEPARTMENT_ID = "control";
const CONTROL_DESIGN_SUBDEPARTMENT_ID = "control_design";

export function normalizePermissionId(permission: string) {
  const trimmed = String(permission || "").trim();
  return LEGACY_PERMISSION_MIGRATIONS[trimmed] || trimmed;
}

export function buildRolePermissionSet(role: Role | null | undefined) {
  const permissionSet = new Set<string>();

  if (!role?.permissions || typeof role.permissions !== "object") {
    return permissionSet;
  }

  if (role.permissions.all === true) {
    PERMISSION_OPTIONS.forEach((permissionId) => {
      if (permissionId !== PERMISSIONS.SELF_APPROVE) {
        permissionSet.add(permissionId);
      }
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
  const roleName = normalizeRoleKey(user?.role?.name);
  const roleId = normalizeRoleKey(user?.role?.id || user?.role_id);
  return roleName === "admin" || roleId === "admin" || roleId === "r1";
}

export function isProjectAuthorityUser(user: User | null | undefined) {
  const roleName = normalizeRoleKey(user?.role?.name);
  const roleId = normalizeRoleKey(user?.role?.id || user?.role_id);

  return ["admin", "ceo", "director", "director_ceo", "ceo_director"].includes(roleName)
    || ["admin", "ceo", "director"].includes(roleId)
    || isAdminUser(user);
}

export function canViewExecutiveDashboard(user: User | null | undefined) {
  return isProjectAuthorityUser(user);
}

export function isExecutiveDashboardUser(user: User | null | undefined) {
  return canViewExecutiveDashboard(user);
}

export function isOperationalControllerUser(user: User | null | undefined) {
  const roleName = normalizeRoleKey(user?.role?.name);
  const roleId = normalizeRoleKey(user?.role?.id || user?.role_id);

  return isProjectAuthorityUser(user)
    || [
      "general_manager",
      "gm",
      "plant_head",
      "team_leader",
      "line_manager",
      "co_leader",
      "team_co_leader",
      "shift_incharge",
    ].includes(roleName)
    || [
      "general_manager",
      "gm",
      "team_leader",
      "co_leader",
      "r1",
      "r2",
      "r3",
      "r4",
    ].includes(roleId);
}

export function isControlDepartmentUser(user: User | null | undefined) {
  return resolveControlDesignIdentity(user).isControlDepartment;
}

export function resolveControlDesignIdentity(user: User | null | undefined) {
  const rawUser = user as (User & Record<string, unknown>) | null | undefined;
  const rawSubdivision = rawUser?.subdivision as Record<string, unknown> | null | undefined;
  const departmentId = normalizeRoleKey(rawUser?.department_id);
  const departmentName = normalizeRoleKey(rawUser?.department?.name);
  const subDepartmentId = normalizeRoleKey(
    rawUser?.subdivision_id
      ?? rawUser?.sub_department_id
      ?? rawUser?.subDepartmentId
      ?? rawSubdivision?.id,
  );
  const subDepartmentName = normalizeRoleKey(
    rawSubdivision?.subdivision_name
      ?? rawSubdivision?.name
      ?? rawUser?.sub_department
      ?? rawUser?.subDepartment
      ?? rawUser?.sub_department_name
      ?? rawUser?.subDepartmentName,
  );
  const canonicalDepartmentId = departmentId === CONTROL_DEPARTMENT_ID || departmentName === CONTROL_DEPARTMENT_ID
    ? CONTROL_DEPARTMENT_ID
    : departmentId || departmentName;
  const canonicalSubDepartmentId = subDepartmentId === CONTROL_DESIGN_SUBDEPARTMENT_ID || subDepartmentName === CONTROL_DESIGN_SUBDEPARTMENT_ID
    ? CONTROL_DESIGN_SUBDEPARTMENT_ID
    : subDepartmentId || subDepartmentName;
  const isControlDepartment = canonicalDepartmentId === CONTROL_DEPARTMENT_ID;

  return {
    canonicalDepartmentId,
    canonicalSubDepartmentId,
    isControlDepartment,
    isControlDesign: isControlDepartment && canonicalSubDepartmentId === CONTROL_DESIGN_SUBDEPARTMENT_ID,
  };
}

export function isControlDesignSubdivisionUser(user: User | null | undefined) {
  return resolveControlDesignIdentity(user).canonicalSubDepartmentId === CONTROL_DESIGN_SUBDEPARTMENT_ID;
}

export function isControlDesignDashboardUser(user: User | null | undefined, _access?: unknown) {
  return resolveControlDesignIdentity(user).isControlDesign;
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
  const operationalController = isOperationalControllerUser(user);
  const canAssignTasks = hasUserPermission(user, PERMISSIONS.ASSIGN_TASK);
  const canTransferTasks = hasUserPermission(user, PERMISSIONS.TRANSFER_TASK);
  const canApproveCompletedTasks = hasUserPermission(user, PERMISSIONS.APPROVE_COMPLETED_TASK);
  const canSelfApprove = hasUserPermission(user, PERMISSIONS.SELF_APPROVE);
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
  const canViewControlDesignWorkspace = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW);
  const canViewAssignedControlDesignProjects = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED);
  const canViewAllControlDesignProjects = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL);
  const canCreateControlDesignProjects = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE);
  const canEditControlDesignProjects = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_EDIT);
  const canAssignControlDesignProjects = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN);
  const canReassignControlDesignProjects = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN);
  const canStartControlDesignStages = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_STAGES_START);
  const canSubmitControlDesignStages = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_STAGES_SUBMIT);
  const canUpdateControlDesignPaths = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PATHS_UPDATE);
  const canReviewControlDesignApprovals = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_APPROVALS_REVIEW);
  const canApproveControlDesignSubmissions = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE);
  const canRequestControlDesignChanges = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES);
  const canRaiseControlDesignRevisions = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE);
  const canExecuteControlDesignRevisions = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE);
  const canReviewControlDesignRevisions = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW);
  const canMarkControlDesignPreCompleted = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_STAGES_MARK_PRE_COMPLETED);
  const canOverrideUnlockControlDesignStages = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_STAGES_OVERRIDE_UNLOCK);
  const canSkipControlDesignStages = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_STAGES_SKIP_OVERRIDE);
  const canMarkControlDesignDispatched = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED);
  const canViewControlDesignAudit = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_AUDIT_VIEW);
  const canViewControlDesignReports = hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_REPORTS_VIEW);

  return {
    canAssignTasks,
    canTransferTasks,
    canApproveCompletedTasks,
    canSelfApprove: operationalController && canSelfApprove,
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
    canUploadNativeDesignData,
    canUploadProofs,
    canViewSelfTasks,
    canViewAllTasks,
    canViewAnalytics,
    canViewReports,
    canExportReports,
    canViewTeamTasks: canViewAllTasks,
    canViewVerifications: operationalController && hasAnyUserPermission(user, [PERMISSIONS.APPROVE_COMPLETED_TASK, PERMISSIONS.APPROVE_QUALITY]),
    canAccessProjectFixtures: operationalController,
    canAccessAdminPanel: isAdminUser(user) || hasAnyUserPermission(user, ADMIN_PANEL_PERMISSIONS),
    canViewAuditLogs: isAdminUser(user),
    canViewDepartmentAnalytics,
    canViewAllDepartmentsAnalytics,
    canViewAllUsersAnalytics,
    canViewControlDesignWorkspace,
    canViewAssignedControlDesignProjects,
    canViewAllControlDesignProjects,
    canCreateControlDesignProjects,
    canEditControlDesignProjects,
    canAssignControlDesignProjects,
    canReassignControlDesignProjects,
    canStartControlDesignStages,
    canSubmitControlDesignStages,
    canUpdateControlDesignPaths,
    canReviewControlDesignApprovals,
    canApproveControlDesignSubmissions,
    canRequestControlDesignChanges,
    canRaiseControlDesignRevisions,
    canExecuteControlDesignRevisions,
    canReviewControlDesignRevisions,
    canMarkControlDesignPreCompleted,
    canOverrideUnlockControlDesignStages,
    canSkipControlDesignStages,
    canMarkControlDesignDispatched,
    canViewControlDesignAudit,
    canViewControlDesignReports,
  };
}
