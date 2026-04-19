INSERT INTO permissions (id, name, description)
VALUES
  ('can_assign_tasks', 'Assign Task', 'Allows assigning tasks to other users.'),
  ('can_verify_task', 'Verify Task', 'Allows reviewing and approving submitted tasks.'),
  ('can_approve_quality', 'Approve Quality', 'Allows performing quality-stage approval.'),
  ('can_view_all_tasks', 'View Department Tasks', 'Allows viewing broader departmental task queues.'),
  ('can_create_task', 'Create Task', 'Allows creating new tasks.'),
  ('can_edit_task', 'Edit Task', 'Allows updating task execution and details.'),
  ('can_delete_task', 'Delete Task', 'Allows deleting tasks.'),
  ('can_upload_proofs', 'Upload Proofs', 'Allows uploading task proof attachments.'),
  ('can_upload_data', 'Upload Data', 'Allows uploading department-owned master data.'),
  ('can_manage_users', 'Manage Users', 'Allows managing user accounts.'),
  ('can_create_user', 'Create User', 'Allows creating user accounts.'),
  ('can_edit_user', 'Edit User', 'Allows editing user account details.'),
  ('can_activate_user', 'Activate User', 'Allows activating or deactivating user accounts.'),
  ('can_manage_roles', 'Manage Roles', 'Allows managing roles and permissions.'),
  ('can_manage_workflows', 'Manage Workflows', 'Allows managing workflow configuration.'),
  ('can_manage_departments', 'Manage Departments', 'Allows managing departments.'),
  ('can_manage_shifts', 'Manage Shifts', 'Allows managing shifts.'),
  ('can_manage_machines', 'Manage Machines', 'Allows managing machines.'),
  ('can_manage_task_templates', 'Manage Task Templates', 'Allows managing task templates.'),
  ('can_manage_kpis', 'Manage KPIs', 'Allows managing KPI definitions.'),
  ('can_manage_escalation_rules', 'Manage Escalation Rules', 'Allows managing escalation rules.'),
  ('can_view_reports', 'View Reports', 'Allows viewing reports.'),
  ('can_export_reports', 'Export Reports', 'Allows exporting reports.')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = NOW();
