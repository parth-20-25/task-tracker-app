export type TaskStatus = 'created' | 'assigned' | 'in_progress' | 'on_hold' | 'under_review' | 'rework' | 'closed' | 'cancelled';
export type VerificationStatus = 'pending' | 'manager_approved' | 'quality_pending' | 'approved' | 'rejected';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type RoleScope = 'global' | 'department' | 'team' | 'self';
export type LifecycleStatus = 'assigned' | 'in_progress' | 'rework' | 'completed' | 'cancelled';

export interface Role {
  id: string;
  name: string;
  hierarchy_level: number;
  permissions: Record<string, boolean>;
  scope: RoleScope;
  parent_role?: string;
  is_active?: boolean;
}

export interface Department {
  id: string;
  name: string;
  parent_department?: string;
  is_active?: boolean;
}

export interface User {
  employee_id: string;
  name: string;
  email?: string | null;
  role_id: string;
  permissions?: string[];
  role?: Role;
  department_id: string;
  department?: Department;
  is_active: boolean;
  created_at: string;
  avatar?: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  assigned_to: string;
  assignee_ids: string[];
  assigned_by: string;
  department_id: string;
  status: TaskStatus;
  verification_status: VerificationStatus;
  priority: Priority;
  deadline: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  verified_at?: string;
  closed_at?: string;
  lifecycle_status?: LifecycleStatus | null;
  proof_url?: string;
  proof_type?: string;
  proof_name?: string;
  proof_mime?: string;
  proof_size?: number;
  remarks?: string;
  planned_minutes: number;
  actual_minutes: number;
  kpi_target?: number | null;
  kpi_status?: string | null;
  machine_id?: string;
  machine_name?: string;
  location_tag?: string;
  project_no?: string | null;
  project_name?: string | null;
  customer_name?: string | null;
  project_description?: string | null;
  scope_name?: string | null;
  quantity_index?: string | null;
  instance_count?: number | null;
  rework_date?: string | null;
  recurrence_rule?: string;
  dependency_ids: number[];
  escalation_level: number;
  next_escalation_at?: string | null;
  last_escalated_at?: string | null;
  requires_quality_approval: boolean;
  approval_stage?: string;
  workflow_id?: string;
  current_stage_id?: string;
  workflow_stage?: string | null;
  activity_count?: number;
  assignee?: User;
  assigner?: User;
}

export interface TaskActivity {
  id: string;
  task_id: number;
  user_employee_id: string | null;
  user_name?: string;
  action_type: string;
  notes?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action_type: string;
  target_type: string;
  target_id: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  user?: User;
}

export interface Notification {
  id: string;
  user_employee_id?: string | null;
  department_id?: string | null;
  title: string;
  body: string;
  type: string;
  target_type?: string;
  target_id?: string;
  read_at?: string | null;
  created_at: string;
}

export interface AnalyticsSummary {
  total: number;
  assigned: number;
  in_progress: number;
  under_review: number;
  rework: number;
  closed: number;
  overdue: number;
  on_time_closure_rate: number;
  rework_rate: number;
  average_planned_minutes: number;
  average_actual_minutes: number;
}

export interface AnalyticsPayload {
  summary: AnalyticsSummary;
  department_performance: Array<{
    department: string;
    total: number;
    closed: number;
    overdue: number;
    rework: number;
  }>;
  downtime: Array<{
    machine: string;
    tasks: number;
    downtime_minutes: number;
  }>;
  overdue_tasks: Task[];
}

export interface KpiDefinition {
  id: string;
  name: string;
  description: string;
  target_value?: number;
}

export interface EscalationRule {
  id: string;
  name: string;
  priority: Priority;
  after_minutes: number;
  notify_role?: string;
  department_id?: string | null;
}

export interface WorkflowStage {
  id: string;
  workflow_id: string;
  stage_name?: string;
  name: string;
  description?: string;
  sequence_order?: number | null;
  is_final: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTransition {
  id: string;
  workflow_id: string;
  from_stage_id: string;
  to_stage_id: string;
  action_name: string;
  required_permission?: string | null;
  conditions: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  department_id?: string | null;
  initial_stage_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stages?: WorkflowStage[];
  transitions?: WorkflowTransition[];
}

export interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active?: boolean;
}

export interface Machine {
  id: string;
  name: string;
  department_id?: string | null;
  location?: string | null;
  is_active?: boolean;
}

export interface TaskLog {
  id: string;
  task_id: number;
  step_name: string;
  status: string;
  notes?: string | null;
  updated_by?: string | null;
  updated_by_name?: string;
  action?: string;
  user_employee_id?: string | null;
  user_name?: string;
  timestamp: string;
}

export interface TaskChecklist {
  id: string;
  task_id: number;
  item: string;
  is_completed: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  completed_by_name?: string;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: number;
  file_url: string;
  file_path?: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by?: string | null;
  uploaded_by_name?: string;
  uploaded_at: string;
}

export interface MetricCard {
  label: string;
  value: number | string;
  icon: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export interface DepartmentProject {
  id: string;
  project_no: string;
  project_name: string;
  customer_name: string;
  project_description: string;
  scope_name: string;
  quantity_index: string;
  instance_count: number | null;
  rework_date: string | null;
  department_id: string;
  uploaded_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesignProjectOption {
  id: string;
  project_no: string;
  project_name: string;
}

export interface DesignScopeOption {
  id: string;
  project_id: string;
  scope_name: string;
}

export interface DesignFixtureOption {
  id: string;
  scope_id: string;
  fixture_no: string;
  op_no: string;
  part_name: string;
  fixture_type: string;
  qty: number;
}

export interface DesignExcelPreviewRow {
  row_number: number;
  fixture_no: string;
  op_no: string;
  part_name: string;
  fixture_type: string;
  qty: number;
}

export interface DesignExcelUploadResponse {
  file_info: {
    project_code: string;
    scope_name_display: string;
    company_name: string;
  };
  preview: {
    accepted: Array<{
      type: "NEW" | "UPDATE_QTY";
      incoming: DesignExcelPreviewRow;
      existing?: DesignExcelPreviewRow;
    }>;
    conflicts: Array<{
      type: "CONFLICT_PART_NAME" | "CONFLICT_OTHER";
      incoming: DesignExcelPreviewRow;
      existing: DesignExcelPreviewRow;
    }>;
    rejected: Array<{
      row_number: number;
      error_message: string;
      raw_data: Record<string, any>;
    }>;
  };
}

export interface ConfirmDesignUploadPayload {
  file_info: DesignExcelUploadResponse["file_info"];
  resolved_items: Array<{
    data: DesignExcelPreviewRow;
  }>;
  rejected_items: DesignExcelUploadResponse["preview"]["rejected"];
}
