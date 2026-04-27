import type { Role, User } from "@/types";

export const PERMISSION_ALIASES: Record<string, string> = {
  can_assign_task: "can_assign_tasks",
};

export const PERMISSION_OPTIONS = [
  "can_assign_tasks",
  "can_verify_task",
  "can_approve_quality",
  "can_view_all_tasks",
  "can_create_task",
  "can_edit_task",
  "can_delete_task",
  "can_upload_proofs",
  "can_upload_data",
  "can_manage_users",
  "can_create_user",
  "can_edit_user",
  "can_activate_user",
  "can_manage_roles",
  "can_manage_workflows",
  "can_manage_departments",
  "can_manage_shifts",
  "can_manage_machines",
  "can_manage_kpis",
  "can_manage_escalation_rules",
  "can_view_reports",
  "can_export_reports",
  "view_self_user",
  "view_self_department",
  "view_department_comparison",
  "view_user_comparison",
  "scope_department_only",
  "scope_all_departments",
] as const;

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
