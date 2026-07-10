import { apiRequest } from "@/api/http";

export type ControlWorkflowStageStatus =
  | "locked"
  | "not_started"
  | "in_progress"
  | "submitted_for_approval"
  | "revision_required"
  | "approved"
  | "blocked"
  | "pre_completed"
  | "skipped_by_override";

export type ControlRevisionReason =
  | "ECN"
  | "Customer Change"
  | "Mechanical Design Change"
  | "Internal Correction"
  | "Scope Addition"
  | "Scope Deletion"
  | "Standardization Change"
  | "Drawing Error Correction"
  | "Vendor/Availability Issue"
  | "Material Substitution"
  | "Trial/Commissioning Feedback"
  | "Site Feedback"
  | "Other";

export interface ControlSubDepartment {
  id: string;
  department_id: string;
  subdivision_name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ControlWorkflowTemplateStage {
  id: string;
  template_id: string;
  stage_name: string;
  sequence_order: number;
  is_required: boolean;
}

export interface ControlWorkflowTemplate {
  id: string;
  department_id: string;
  department_name?: string | null;
  sub_department_id: string;
  sub_department_name?: string | null;
  name: string;
  template_name: string;
  is_active: boolean;
  stages: ControlWorkflowTemplateStage[];
}

export interface ControlWorkflowSubmission {
  id: string;
  workflow_stage_id: string;
  workflow_id: string;
  revision_id?: string | null;
  submitted_by: string;
  submitted_by_name?: string | null;
  submitted_document_path: string;
  remarks?: string | null;
  status: "pending" | "approved" | "revision_required";
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_remarks?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ControlWorkflowRevision {
  id: string;
  workflow_stage_id: string;
  workflow_id: string;
  revision_reason: ControlRevisionReason;
  manual_reason?: string | null;
  description: string;
  due_date: string;
  priority?: string | null;
  status: "not_started" | "in_progress" | "submitted_for_approval" | "approved";
  raised_by: string;
  raised_by_name?: string | null;
  assigned_to: string;
  assigned_to_name?: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  remarks?: string | null;
  created_at: string;
  updated_at: string;
  stage_name?: string;
  project_no?: string;
  project_name?: string;
  sub_department_name?: string;
}

export interface ControlDocumentHistory {
  id: string;
  workflow_stage_id: string;
  old_path?: string | null;
  new_path: string;
  changed_by: string;
  changed_by_name?: string | null;
  change_remarks?: string | null;
  created_at: string;
}

export interface ControlOverrideHistory {
  id: string;
  workflow_stage_id: string;
  workflow_id: string;
  unlocked_by: string;
  unlocked_by_name?: string | null;
  reason: string;
  remarks: string;
  created_at: string;
}

export interface ControlWorkflowStage {
  id: string;
  workflow_id: string;
  template_stage_id?: string | null;
  stage_name: string;
  sequence_order: number;
  is_required: boolean;
  status: ControlWorkflowStageStatus;
  current_document_path?: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  due_date?: string | null;
  remarks?: string | null;
  revision_count: number;
  created_at: string;
  updated_at: string;
  submissions: ControlWorkflowSubmission[];
  revisions: ControlWorkflowRevision[];
  document_history: ControlDocumentHistory[];
  override_history: ControlOverrideHistory[];
}

export interface ControlWorkflowProgress {
  approved_or_pre_completed_stages: number;
  skipped_by_override_stages: number;
  total_required_stages: number;
  percent: number;
}

export interface ControlProjectWorkflow {
  id: string;
  project_id: string;
  project_no?: string | null;
  project_name?: string | null;
  customer_name?: string | null;
  project_status?: string | null;
  dispatch_status?: string | null;
  department_id: string;
  department_name?: string | null;
  sub_department_id: string;
  sub_department_name?: string | null;
  template_id: string;
  template_name?: string | null;
  assigned_user_id: string;
  assigned_user_name?: string | null;
  assigned_by?: string | null;
  assigned_by_name?: string | null;
  current_stage_id?: string | null;
  status: "active" | "completed" | "cancelled";
  started_at?: string | null;
  completed_at?: string | null;
  stages: ControlWorkflowStage[];
  progress: ControlWorkflowProgress;
  current_stage?: ControlWorkflowStage | null;
  created_at: string;
  updated_at: string;
}
export interface ControlDesignCoRecord {
  id: string;
  project_id: string;
  sub_department_id: string;
  budget_amount: number | null;
  budget_currency: string;
  status: "active" | "cancelled";
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ControlDesignProject extends ProjectDashboardSummary {
  control_record?: ControlDesignCoRecord | null;
  workflow?: Pick<
    ControlProjectWorkflow,
    | "id"
    | "project_id"
    | "sub_department_id"
    | "assigned_user_id"
    | "assigned_user_name"
    | "assigned_by"
    | "assigned_by_name"
    | "current_stage_id"
    | "status"
    | "template_id"
    | "template_name"
    | "created_at"
    | "updated_at"
  > | null;
}

export interface ControlApprovalQueueItem extends ControlWorkflowSubmission {
  stage_name: string;
  due_date?: string | null;
  assigned_user_id: string;
  project_no: string;
  project_name: string;
  customer_name?: string | null;
  sub_department_name: string;
}

function stripUndefined<T extends Record<string, unknown>>(payload: T): T {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as T;
}

export function fetchControlSubDepartments() {
  return apiRequest<ControlSubDepartment[]>("/control/sub-departments");
}
export function fetchControlDesignProjects() {
  return apiRequest<ControlDesignProject[]>("/control/design/projects");
}

export function fetchControlDesignAssignableUsers() {
  return apiRequest<User[]>("/control/design/assignees");
}

export function createControlDesignCo(payload: {
  project_id: string;
  budget_amount: number | string;
  budget_currency?: string;
}) {
  return apiRequest<ControlDesignCoRecord>("/control/design/co", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function assignControlDesignProjectOwner(projectId: string, assignedUserId: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/design/projects/${encodeURIComponent(projectId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ assigned_user_id: assignedUserId }),
  });
}

export function fetchControlWorkflowTemplate(subDepartmentId: string) {
  return apiRequest<ControlWorkflowTemplate>(
    `/control/workflow-templates/by-sub-department/${encodeURIComponent(subDepartmentId)}`,
  );
}

export function fetchControlProjectWorkflow(projectId: string, subDepartmentId: string, templateId?: string | null) {
  const params = new URLSearchParams();
  params.set("sub_department_id", subDepartmentId);
  if (templateId) {
    params.set("template_id", templateId);
  }

  return apiRequest<ControlProjectWorkflow | null>(
    `/control/workflows/project/${encodeURIComponent(projectId)}?${params.toString()}`,
  );
}

export function createControlProjectWorkflow(payload: {
  project_id: string;
  sub_department_id: string;
  template_id?: string;
  assigned_user_id: string;
}) {
  return apiRequest<ControlProjectWorkflow>("/control/workflows", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function reassignControlProjectWorkflowOwner(workflowId: string, assignedUserId: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflows/${encodeURIComponent(workflowId)}/owner`, {
    method: "PATCH",
    body: JSON.stringify({ assigned_user_id: assignedUserId }),
  });
}

export function startControlWorkflowStage(stageId: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/start`, { method: "POST" });
}

export function submitControlWorkflowStage(stageId: string, payload: { submitted_document_path: string; remarks?: string }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/submit`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function approveControlWorkflowStage(stageId: string, payload: { review_remarks?: string } = {}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/approve`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function markControlWorkflowStageRevisionRequired(stageId: string, payload: {
  review_remarks: string;
  revision_reason?: ControlRevisionReason;
  manual_reason?: string;
  description?: string;
  due_date?: string;
  priority?: string;
  remarks?: string;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/revision-required`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function raiseControlWorkflowRevision(stageId: string, payload: {
  revision_reason: ControlRevisionReason;
  manual_reason?: string;
  description: string;
  due_date: string;
  priority?: string;
  remarks?: string;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/revisions`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function updateControlWorkflowDocumentPath(stageId: string, payload: { document_path: string; remarks?: string }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/document-path`, {
    method: "PATCH",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function markControlWorkflowStagePreCompleted(stageId: string, payload: {
  completion_date: string;
  document_path: string;
  approved_by: string;
  remarks?: string;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/pre-completed`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function overrideUnlockControlWorkflowStage(stageId: string, payload: {
  reason: string;
  remarks: string;
  confirm_history_record: boolean;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/override-unlock`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startControlWorkflowRevision(revisionId: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/start`, { method: "POST" });
}

export function submitControlWorkflowRevision(revisionId: string, payload: { submitted_document_path: string; remarks?: string }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/submit`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function approveControlWorkflowRevision(revisionId: string, payload: { review_remarks?: string } = {}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/approve`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function fetchControlPendingApprovals() {
  return apiRequest<ControlApprovalQueueItem[]>("/control/workflows/approvals/pending");
}

export function fetchControlRevisionQueue() {
  return apiRequest<ControlWorkflowRevision[]>("/control/workflows/revisions/required");
}
