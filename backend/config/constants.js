const ROLE_LEVELS = {
  r1: 1,
  r2: 2,
  r3: 3,
  r4: 4,
  r5: 4,
  r6: 5,
  r7: 6,
};

const USER_SCOPES = {
  ACCESSIBLE: "accessible",
  ASSIGNABLE: "assignable",
};

const PERMISSIONS = {
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
};

const PERMISSION_ID_ALIASES = {
  can_assign_task: PERMISSIONS.ASSIGN_TASK,
};

const PERMISSION_DEFINITIONS = [
  [PERMISSIONS.ASSIGN_TASK, "Assign Task", "Allows assigning tasks to other users."],
  [PERMISSIONS.VERIFY_TASK, "Verify Task", "Allows reviewing and approving submitted tasks."],
  [PERMISSIONS.APPROVE_QUALITY, "Approve Quality", "Allows performing quality-stage approval."],
  [PERMISSIONS.VIEW_ALL_TASKS, "View Department Tasks", "Allows viewing broader departmental task queues."],
  [PERMISSIONS.CREATE_TASK, "Create Task", "Allows creating new tasks."],
  [PERMISSIONS.EDIT_TASK, "Edit Task", "Allows updating task execution and details."],
  [PERMISSIONS.DELETE_TASK, "Delete Task", "Allows deleting tasks."],
  [PERMISSIONS.UPLOAD_PROOFS, "Upload Proofs", "Allows uploading task proof attachments."],
  [PERMISSIONS.UPLOAD_DATA, "Upload Data", "Allows uploading department-owned master data."],
  [PERMISSIONS.MANAGE_USERS, "Manage Users", "Allows managing user accounts."],
  [PERMISSIONS.CREATE_USER, "Create User", "Allows creating user accounts."],
  [PERMISSIONS.EDIT_USER, "Edit User", "Allows editing user account details."],
  [PERMISSIONS.ACTIVATE_USER, "Activate User", "Allows activating or deactivating user accounts."],
  [PERMISSIONS.MANAGE_ROLES, "Manage Roles", "Allows managing roles and permissions."],
  [PERMISSIONS.MANAGE_WORKFLOWS, "Manage Workflows", "Allows managing workflow configuration."],
  [PERMISSIONS.MANAGE_DEPARTMENTS, "Manage Departments", "Allows managing departments."],
  [PERMISSIONS.MANAGE_SHIFTS, "Manage Shifts", "Allows managing shifts."],
  [PERMISSIONS.MANAGE_MACHINES, "Manage Machines", "Allows managing machines."],
  [PERMISSIONS.MANAGE_KPIS, "Manage KPIs", "Allows managing KPI definitions."],
  [PERMISSIONS.MANAGE_ESCALATION_RULES, "Manage Escalation Rules", "Allows managing escalation rules."],
  [PERMISSIONS.VIEW_REPORTS, "View Reports", "Allows viewing reports."],
  [PERMISSIONS.EXPORT_REPORTS, "Export Reports", "Allows exporting reports."],
];

const ROLE_DEFAULT_PERMISSIONS = {
  r1: Object.values(PERMISSIONS),
  r2: [
    PERMISSIONS.ASSIGN_TASK,
    PERMISSIONS.VERIFY_TASK,
    PERMISSIONS.APPROVE_QUALITY,
    PERMISSIONS.VIEW_ALL_TASKS,
    PERMISSIONS.CREATE_TASK,
    PERMISSIONS.EDIT_TASK,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.CREATE_USER,
    PERMISSIONS.EDIT_USER,
    PERMISSIONS.ACTIVATE_USER,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.MANAGE_WORKFLOWS,
    PERMISSIONS.MANAGE_DEPARTMENTS,
    PERMISSIONS.MANAGE_SHIFTS,
    PERMISSIONS.MANAGE_MACHINES,
    PERMISSIONS.MANAGE_KPIS,
    PERMISSIONS.MANAGE_ESCALATION_RULES,
    PERMISSIONS.UPLOAD_PROOFS,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.EXPORT_REPORTS,
  ],
  r3: [
    PERMISSIONS.ASSIGN_TASK,
    PERMISSIONS.VERIFY_TASK,
    PERMISSIONS.VIEW_ALL_TASKS,
    PERMISSIONS.CREATE_TASK,
    PERMISSIONS.EDIT_TASK,
    PERMISSIONS.UPLOAD_PROOFS,
    PERMISSIONS.VIEW_REPORTS,
  ],
  r4: [
    PERMISSIONS.ASSIGN_TASK,
    PERMISSIONS.VERIFY_TASK,
    PERMISSIONS.VIEW_ALL_TASKS,
    PERMISSIONS.CREATE_TASK,
    PERMISSIONS.EDIT_TASK,
    PERMISSIONS.UPLOAD_PROOFS,
  ],
  r5: [
    PERMISSIONS.VERIFY_TASK,
    PERMISSIONS.APPROVE_QUALITY,
    PERMISSIONS.VIEW_ALL_TASKS,
    PERMISSIONS.VIEW_REPORTS,
  ],
  r6: [
    PERMISSIONS.EDIT_TASK,
    PERMISSIONS.UPLOAD_PROOFS,
  ],
  r7: [
    PERMISSIONS.EDIT_TASK,
    PERMISSIONS.UPLOAD_PROOFS,
  ],
};

const TASK_STATUSES = {
  CREATED: "created",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  ON_HOLD: "on_hold",
  UNDER_REVIEW: "under_review",
  REWORK: "rework",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

const VERIFICATION_STATUSES = {
  PENDING: "pending",
  MANAGER_APPROVED: "manager_approved",
  QUALITY_PENDING: "quality_pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const TASK_TRANSITIONS = {
  [TASK_STATUSES.CREATED]: [TASK_STATUSES.ASSIGNED],
  [TASK_STATUSES.ASSIGNED]: [TASK_STATUSES.IN_PROGRESS],
  [TASK_STATUSES.IN_PROGRESS]: [TASK_STATUSES.UNDER_REVIEW, TASK_STATUSES.ON_HOLD],
  [TASK_STATUSES.ON_HOLD]: [TASK_STATUSES.IN_PROGRESS],
  [TASK_STATUSES.UNDER_REVIEW]: [TASK_STATUSES.REWORK, TASK_STATUSES.CLOSED],
  [TASK_STATUSES.REWORK]: [TASK_STATUSES.IN_PROGRESS],
  [TASK_STATUSES.CLOSED]: [],
  [TASK_STATUSES.CANCELLED]: [],
};

module.exports = {
  PERMISSION_DEFINITIONS,
  PERMISSION_ID_ALIASES,
  PERMISSIONS,
  ROLE_LEVELS,
  ROLE_DEFAULT_PERMISSIONS,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  USER_SCOPES,
  VERIFICATION_STATUSES,
};
