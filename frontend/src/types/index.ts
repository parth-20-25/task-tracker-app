export type TaskStatus = 'created' | 'assigned' | 'in_progress' | 'on_hold' | 'under_review' | 'rework' | 'closed' | 'cancelled';
export type VerificationStatus = 'pending' | 'manager_approved' | 'quality_pending' | 'approved' | 'rejected';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type RoleScope = 'global' | 'department' | 'team' | 'self';
export type LifecycleStatus = 'assigned' | 'in_progress' | 'rework' | 'completed' | 'cancelled';
export type TaskType = 'department_workflow' | 'custom';
export type TaskSource = 'admin_manual' | 'workflow_auto' | 'system_generated' | 'excel_import';
export type IssuePriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

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
  internal_identifier?: string;
  task_type: TaskType;
  description: string;
  assigned_to: string;
  assigned_user_id?: string;
  assignee_ids: string[];
  assigned_by: string;
  created_by?: string | null;
  department_id: string;
  workflow_template_id?: string | null;
  workflow_template_name?: string | null;
  status: TaskStatus;
  verification_status: VerificationStatus;
  priority: Priority;
  deadline: string;
  due_date?: string | null;
  sla_due_date?: string | null;
  created_at: string;
  submitted_at?: string | null;
  approved_at?: string | null;
  started_at?: string;
  completed_at?: string;
  verified_at?: string;
  closed_at?: string;
  lifecycle_status?: LifecycleStatus | null;
  proof_url?: string[];
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
  project_id?: string | null;
  scope_id?: string | null;
  fixture_id?: string | null;
  project_no?: string | null;
  fixture_no?: string | null;
  project_code?: string | null;
  project_name?: string | null;
  customer_name?: string | null;
  company_name?: string | null;
  project_description?: string | null;
  scope_name?: string | null;
  quantity_index?: string | null;
  instance_count?: number | null;
  rework_date?: string | null;
  rejection_count?: number;
  recurrence_rule?: string;
  dependency_ids: number[];
  escalation_level: number;
  next_escalation_at?: string | null;
  last_escalated_at?: string | null;
  requires_quality_approval: boolean;
  approval_required: boolean;
  proof_required: boolean;
  approval_stage?: string;
  source?: TaskSource;
  tags?: string[];
  approved_by?: string | null;
  workflow_id?: string;
  current_stage_id?: string;
  workflow_stage?: string | null;
  workflow_status?: string | null;
  activity_count?: number;
  assignee?: User;
  assigner?: User;
}

export interface WorkflowTemplate {
  id: string;
  department_id: string;
  department_name?: string | null;
  template_name: string;
  description?: string | null;
  default_priority?: Priority | null;
  default_proof_required: boolean;
  default_approval_required: boolean;
  default_due_days?: number | null;
  escalation_level: number;
  eligible_role_ids: string[];
  is_active: boolean;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
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

export interface UploadBatch {
  id: string;
  batch_id: string;
  project_id: string;
  scope_id: string;
  project_no: string;
  project_name: string;
  customer_name: string;
  department_id: string;
  scope_name: string;
  uploaded_by?: string | null;
  uploaded_at: string;
  created_at: string;
  accepted_rows: number;
  rejected_rows: number;
  total_fixtures: number;
  active_count: number;
  status_summary: string;
  deletion_blocked: boolean;
  delete_blocked_reason?: string | null;
}

export interface IssueComment {
  id: string;
  issue_id: string;
  user_id: string;
  user_name?: string | null;
  message: string;
  created_at: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  created_by: string;
  assigned_to: string;
  department_id?: string | null;
  priority: IssuePriority;
  status: IssueStatus;
  created_at: string;
  creator?: User | null;
  assignee?: User | null;
  department?: Department | null;
  comments?: IssueComment[];
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

export interface PerformanceAnalyticsContext {
  scope: "department_only" | "all_departments";
  default_department_id: string | null;
  minimum_approved_tasks: number;
  department_penalty_factor: number;
  user: {
    employee_id: string;
    name: string;
    department_id: string | null;
    department_name: string | null;
  };
  permissions: {
    view_self_user: boolean;
    view_self_department: boolean;
    view_department_comparison: boolean;
    view_user_comparison: boolean;
  };
  departments: Array<{
    id: string;
    name: string;
  }>;
}

export interface PerformanceOverviewPayload {
  total_tasks: number;
  approved_tasks: number;
  approval_rate: number | null;
  overdue_rate: number | null;
  rework_rate: number | null;
  last_updated: string | null;
  has_data: boolean;
  selected_department_id: string | null;
  selected_department_name: string | null;
}

export interface UserPerformanceRow {
  user_id: string;
  user_name: string;
  department_id: string;
  department_name: string;
  approved_tasks: number;
  on_time_count: number;
  overdue_count: number;
  rework_count: number;
  score: number | null;
  rank: number | null;
  last_updated: string;
}

export interface UserPerformanceListPayload {
  department_id: string;
  department_name: string;
  minimum_approved_tasks: number;
  items: UserPerformanceRow[];
  last_updated: string | null;
}

export interface DepartmentPerformanceRow {
  department_id: string;
  department_name: string;
  total_tasks: number;
  approved_tasks: number;
  completion_rate: number | null;
  rework_rate: number | null;
  overdue_rate: number | null;
  avg_completion_time: number | null;
  score: number | null;
  rank: number | null;
  eligible_users: number;
  last_updated: string;
}

export interface DepartmentPerformanceListPayload {
  items: DepartmentPerformanceRow[];
  last_updated: string | null;
  departments: Array<{
    id: string;
    name: string;
  }>;
}

export interface UserDrilldownTask {
  task_id: number;
  title: string;
  status: string;
  priority: string | null;
  project_name: string | null;
  scope_name: string | null;
  remarks: string | null;
  due_date: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejection_count: number;
  completion_minutes: number | null;
  is_on_time: boolean;
  is_overdue: boolean;
  delay_hours: number | null;
}

export interface UserApprovalTimelineEntry {
  task_id: number;
  title: string;
  approved_at: string | null;
  due_date: string | null;
  outcome: "on_time" | "overdue" | "no_due_date";
  delay_hours: number | null;
}

export interface UserReworkHistoryEntry {
  task_id: number;
  title: string;
  rejection_count: number;
  approved_at: string | null;
  remarks: string | null;
  project_name: string | null;
  scope_name: string | null;
}

export interface DelayPatternBucket {
  label: string;
  count: number;
}

export interface UserPerformanceDrilldownPayload {
  user: {
    employee_id: string;
    name: string;
    department_id: string | null;
    department_name: string | null;
    is_active: boolean;
  };
  performance: UserPerformanceRow | null;
  summary: {
    approved_tasks: number;
    on_time_count: number;
    overdue_count: number;
    rework_count: number;
    score: number | null;
    rank: number | null;
    average_completion_minutes: number | null;
    average_delay_hours: number | null;
    tasks_without_due_date: number;
  };
  tasks: UserDrilldownTask[];
  approval_timeline: UserApprovalTimelineEntry[];
  rework_history: UserReworkHistoryEntry[];
  delay_patterns: {
    overdue_tasks: number;
    on_time_tasks: number;
    tasks_without_due_date: number;
    by_weekday: DelayPatternBucket[];
    by_priority: DelayPatternBucket[];
  };
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
  project_id: string;
  scope_id: string;
  project_code: string;
  project_name: string;
  company_name: string;
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
  project_id: string;
  project_code: string;
  project_name: string;
  company_name: string;
  department_id: string;
}

export interface DesignScopeOption {
  scope_id: string;
  project_id: string;
  scope_name: string;
}

export interface DesignFixtureOption {
  fixture_id: string;
  project_id: string | null;
  batch_id?: string | null;
  scope_id: string;
  fixture_no: string;
  op_no: string;
  part_name: string;
  fixture_type: string;
  remark?: string | null;
  qty: number;
  image_1_url?: string | null;
  image_2_url?: string | null;
  ingestion_source?: string | null;
}

export interface DesignExcelPreviewRow {
  row_number: number;
  excel_row?: number | null;
  row_reference: string;
  row_reference_source?: "business_serial" | "excel_row";
  business_row_reference?: string | null;
  fixture_no: string;
  op_no: string;
  part_name: string;
  fixture_type: string;
  remark?: string | null;
  qty: number;
  image_1_url?: string | null;
  image_2_url?: string | null;
  scope_status?: "PARC" | "CUSTOMER" | "AMBIGUOUS";
  scope_reason?: string | null;
}

export interface DesignExcelRejectedRow {
  row_number: number;
  excel_row?: number | null;
  row_reference: string;
  row_reference_source?: "business_serial" | "excel_row";
  business_row_reference?: string | null;
  error_message: string;
  raw_data: Record<string, any>;
}

export interface DesignExcelSkippedRow extends DesignExcelPreviewRow {
  raw_data: Record<string, any>;
  scope_status: "CUSTOMER";
  skip_reason: string;
}

export interface DesignExcelUploadResponse {
  file_info: {
    project_code: string;
    scope_name_display: string;
    company_name: string;
    metadata_source?: string;
  };
  preview: {
    accepted: Array<{
      type: "NEW" | "UPDATE_QTY";
      incoming: DesignExcelPreviewRow;
      existing?: DesignExcelPreviewRow;
    }>;
    conflicts: Array<{
      type: "CONFLICT_PART_NAME" | "CONFLICT_OTHER" | "CONFLICT_IMAGES";
      incoming: DesignExcelPreviewRow;
      existing: DesignExcelPreviewRow;
    }>;
    rejected: DesignExcelRejectedRow[];
    skipped: DesignExcelSkippedRow[];
  };
}

export interface DesignRejectedRowCorrectionAudit {
  row_reference: string;
  row_number: number;
  excel_row?: number | null;
  correction_reason: string;
  corrected_fields: string[];
  original_row: DesignExcelRejectedRow;
  corrected_row: DesignExcelPreviewRow;
  correction_result: "accepted" | "conflict" | "skipped" | "rejected";
}

export interface ValidateRejectedDesignRowResponse {
  classification: "accepted" | "conflict" | "skipped" | "rejected";
  accepted?: {
    type: "NEW" | "UPDATE_QTY";
    incoming: DesignExcelPreviewRow;
    existing?: DesignExcelPreviewRow;
  };
  conflict?: {
    type: "CONFLICT_PART_NAME" | "CONFLICT_OTHER" | "CONFLICT_IMAGES";
    incoming: DesignExcelPreviewRow;
    existing: DesignExcelPreviewRow;
  };
  skipped?: DesignExcelSkippedRow;
  rejected?: DesignExcelRejectedRow;
  correction_audit: DesignRejectedRowCorrectionAudit;
}

export interface ConfirmDesignUploadPayload {
  file_info: DesignExcelUploadResponse["file_info"];
  resolved_items: Array<{
    data: DesignExcelPreviewRow;
    resolution: "incoming" | "existing";
    scope_decision?: "add_fixture" | "skip_fixture";
  }>;
  rejected_items: DesignExcelUploadResponse["preview"]["rejected"];
  skipped_items: DesignExcelUploadResponse["preview"]["skipped"];
  correction_items?: DesignRejectedRowCorrectionAudit[];
}
