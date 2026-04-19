import { AuditLog, Department, Role, Task, User } from '@/types';

export const roles: Role[] = [
  { id: 'r1', name: 'Admin', hierarchy_level: 1, permissions: { all: true }, scope: 'global' },
  {
    id: 'r2',
    name: 'Plant Head',
    hierarchy_level: 2,
    permissions: {
      can_assign_tasks: true,
      can_verify_task: true,
      can_approve_quality: true,
      can_view_all_tasks: true,
      can_create_task: true,
      can_edit_task: true,
      can_manage_users: true,
      can_create_user: true,
      can_edit_user: true,
      can_activate_user: true,
      can_manage_roles: true,
      can_manage_workflows: true,
      can_manage_departments: true,
      can_manage_shifts: true,
      can_manage_machines: true,
      can_manage_kpis: true,
      can_manage_escalation_rules: true,
      can_upload_proofs: true,
      can_view_reports: true,
      can_export_reports: true,
    },
    scope: 'department',
    parent_role: 'r1',
  },
  {
    id: 'r3',
    name: 'Line Manager',
    hierarchy_level: 3,
    permissions: {
      can_assign_tasks: true,
      can_verify_task: true,
      can_view_all_tasks: true,
      can_create_task: true,
      can_edit_task: true,
      can_upload_proofs: true,
      can_view_reports: true,
    },
    scope: 'team',
    parent_role: 'r2',
  },
  {
    id: 'r4',
    name: 'Shift Incharge',
    hierarchy_level: 4,
    permissions: {
      can_assign_tasks: true,
      can_verify_task: true,
      can_view_all_tasks: true,
      can_create_task: true,
      can_edit_task: true,
      can_upload_proofs: true,
    },
    scope: 'team',
    parent_role: 'r3',
  },
  {
    id: 'r5',
    name: 'Quality Inspector',
    hierarchy_level: 4,
    permissions: {
      can_verify_task: true,
      can_approve_quality: true,
      can_view_all_tasks: true,
      can_view_reports: true,
    },
    scope: 'department',
    parent_role: 'r3',
  },
  {
    id: 'r6',
    name: 'Maintenance Engineer',
    hierarchy_level: 5,
    permissions: {
      can_edit_task: true,
      can_upload_proofs: true,
    },
    scope: 'self',
    parent_role: 'r4',
  },
  {
    id: 'r7',
    name: 'Operator',
    hierarchy_level: 6,
    permissions: {
      can_edit_task: true,
      can_upload_proofs: true,
    },
    scope: 'self',
    parent_role: 'r4',
  },
];

export const departments: Department[] = [
  { id: 'd1', name: 'Production' },
  { id: 'd2', name: 'Quality Assurance' },
  { id: 'd3', name: 'Maintenance' },
];

export const users: User[] = [
  { employee_id: 'EMP001', name: 'Admin User', role_id: 'r1', department_id: '', is_active: true, created_at: '2024-01-01', role: roles[0] },
  { employee_id: 'EMP002', name: 'Plant Head', role_id: 'r2', department_id: 'd1', is_active: true, created_at: '2024-01-05', role: roles[1], department: departments[0] },
  { employee_id: 'EMP003', name: 'Line Manager D1', role_id: 'r3', department_id: 'd1', is_active: true, created_at: '2024-01-10', role: roles[2], department: departments[0] },
  { employee_id: 'EMP004', name: 'Line Manager D2', role_id: 'r3', department_id: 'd2', is_active: true, created_at: '2024-01-15', role: roles[2], department: departments[1] },
  { employee_id: 'EMP005', name: 'Shift Incharge D1', role_id: 'r4', department_id: 'd1', is_active: true, created_at: '2024-02-01', role: roles[3], department: departments[0] },
  { employee_id: 'EMP006', name: 'Shift Incharge D2', role_id: 'r4', department_id: 'd2', is_active: true, created_at: '2024-02-05', role: roles[3], department: departments[1] },
  { employee_id: 'EMP007', name: 'Quality Inspector', role_id: 'r5', department_id: 'd2', is_active: true, created_at: '2024-02-10', role: roles[4], department: departments[1] },
  { employee_id: 'EMP008', name: 'Maintenance Engineer', role_id: 'r6', department_id: 'd3', is_active: true, created_at: '2024-03-01', role: roles[5], department: departments[2] },
  { employee_id: 'EMP009', name: 'Operator D1', role_id: 'r7', department_id: 'd1', is_active: true, created_at: '2024-03-10', role: roles[6], department: departments[0] },
  { employee_id: 'EMP010', name: 'Operator D2', role_id: 'r7', department_id: 'd2', is_active: true, created_at: '2024-03-15', role: roles[6], department: departments[1] },
];

export const tasks: Task[] = [];
export const auditLogs: AuditLog[] = [];

export function getUser(employeeId: string): User | undefined {
  return users.find((user) => user.employee_id === employeeId);
}

export function getTasksWithUsers(taskList: Task[] = tasks): Task[] {
  return taskList.map((task) => ({
    ...task,
    assignee: getUser(task.assigned_to),
    assigner: getUser(task.assigned_by),
  }));
}
