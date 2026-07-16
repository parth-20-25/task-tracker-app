import { apiDownload, apiRequest, getStoredToken } from "@/api/http";
import { API_BASE_URL } from "@/api/config";
import type { ProjectDashboardSummary, User } from "@/types";

export type ControlWorkflowStageStatus =
  | "locked"
  | "available"
  | "in_progress"
  | "pending_approval"
  | "approved"
  | "changes_required"
  | "update_required"
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
  submitted_document_path?: string | null;
  stage_version: number;
  remarks?: string | null;
  status: "pending" | "approved" | "revision_required";
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_remarks?: string | null;
  rejection_reason?: string | null;
  correction_deadline?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ControlWorkflowRevision {
  id: string;
  workflow_stage_id: string;
  workflow_id: string;
  revision_number: number;
  revision_reason: ControlRevisionReason;
  reference_path?: string | null;
  manual_reason?: string | null;
  description: string;
  due_date: string;
  priority?: string | null;
  affected_stage_ids: string[];
  status: "not_started" | "changes_required" | "in_progress" | "submitted_for_approval" | "approved";
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
  revision_number: number;
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
  action_type: "override_unlock" | "skip_by_override";
  reason: string;
  supporting_document_path?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  remarks: string;
  created_at: string;
}
export interface ControlWorkflowEvent {
  id: string;
  workflow_id: string;
  workflow_stage_id: string | null;
  event_type: string;
  actor_id?: string | null;
  actor_name?: string | null;
  details?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}


export interface ControlWorkflowProof {
  id: string;
  workflow_id: string;
  project_id: string;
  workflow_stage_id: string;
  revision_number: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  comment?: string | null;
  open_url: string;
  download_url: string;
}
export interface ControlWorkflowStage {
  id: string;
  workflow_id: string;
  template_stage_id?: string | null;
  stage_name: string;
  sequence_order: number;
  is_required: boolean;
  status: ControlWorkflowStageStatus;
  version: number;
  current_document_path?: string | null;
  path_updated_by?: string | null;
  path_updated_by_name?: string | null;
  path_updated_at?: string | null;
  started_at?: string | null;
  started_by?: string | null;
  started_by_name?: string | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  submitted_by_name?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  rejected_by_name?: string | null;
  rejection_reason?: string | null;
  due_date?: string | null;
  remarks?: string | null;
  revision_count: number;
  created_at: string;
  updated_at: string;
  submissions: ControlWorkflowSubmission[];
  revisions: ControlWorkflowRevision[];
  proofs: ControlWorkflowProof[];
  document_history: ControlDocumentHistory[];
  override_history: ControlOverrideHistory[];
  events?: ControlWorkflowEvent[];
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
  project_root_path?: string | null;
  dispatched_by?: string | null;
  dispatched_by_name?: string | null;
  dispatched_at?: string | null;
  dispatch_remarks?: string | null;
  department_id: string;
  department_name?: string | null;
  sub_department_id: string;
  sub_department_name?: string | null;
  template_id: string;
  template_name?: string | null;
  assigned_user_id: string | null;
  assigned_user_name?: string | null;
  assigned_by?: string | null;
  assigned_by_name?: string | null;
  assigned_at?: string | null;
  current_stage_id?: string | null;
  status: "active" | "completed" | "cancelled";
  started_at?: string | null;
  started_by?: string | null;
  started_by_name?: string | null;
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
  lifecycle_status: string;
  priority?: string | null;
  planned_start_date?: string | null;
  target_completion_date?: string | null;
  project_root_path?: string | null;
  notes?: string | null;
  dispatched_by?: string | null;
  dispatched_at?: string | null;
  dispatch_remarks?: string | null;
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
    | "assigned_at"
    | "current_stage_id"
    | "dispatched_by"
    | "dispatched_by_name"
    | "dispatched_at"
    | "dispatch_remarks"
    | "status"
    | "template_id"
    | "template_name"
    | "created_at"
    | "updated_at"
  > | null;
  lifecycle_summary?: {
    total_stage_count: number;
    approved_stage_count: number;
    lifecycle_started: boolean;
    pending_approval_count: number;
    updates_required_count: number;
    completed: boolean;
  };
}

export interface ControlDesignCapabilities {
  canViewWorkspace: boolean;
  canViewAssignedProjects: boolean;
  canViewAllProjects: boolean;
  canCreateProject: boolean;
  canEditProject: boolean;
  canAssignProject: boolean;
  canReassignProject: boolean;
  canCancelProject: boolean;
  canStartStage: boolean;
  canSubmitStage: boolean;
  canUpdatePath: boolean;
  canViewProof: boolean;
  canUploadProof: boolean;
  canReview: boolean;
  canApprove: boolean;
  canRequestChanges: boolean;
  canRaiseRevision: boolean;
  canExecuteRevision: boolean;
  canReviewRevision: boolean;
  canMarkPreCompleted: boolean;
  canOverrideUnlock: boolean;
  canSkipStage: boolean;
  canMarkDispatched: boolean;
  canReopenAfterDispatch: boolean;
  canViewAudit: boolean;
  canViewReports: boolean;
}

export interface ControlDesignSummary {
  total: number;
  active: number;
  pending: number;
  updates: number;
  completed: number;
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

export function fetchControlDesignSummary() {
  return apiRequest<ControlDesignSummary>("/control/design/summary");
}

export function fetchControlDesignCapabilities() {
  return apiRequest<ControlDesignCapabilities>("/control/design/capabilities");
}

export function fetchControlDesignAssignableUsers() {
  return apiRequest<User[]>("/control/design/assignees");
}

export function createControlDesignProject(payload: {
  projectId: string;
  projectName: string;
  customer: string;
  budget: string;
  assignedUserId: string;
  priority?: string;
  plannedStartDate?: string;
  targetCompletionDate?: string;
  projectRootPath?: string;
  notes?: string;
}) {
  return apiRequest<ControlDesignProject>("/control/design/projects", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
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

export function assignControlDesignProjectOwner(projectId: string, assignedUserId: string, reason?: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/design/projects/${encodeURIComponent(projectId)}/assign`, {
    method: "POST",
    body: JSON.stringify(stripUndefined({ assigned_user_id: assignedUserId, reason })),
  });
}

export function fetchControlWorkflowTemplate(subDepartmentId: string) {
  return apiRequest<ControlWorkflowTemplate>(`/control/workflow-templates/by-sub-department/${encodeURIComponent(subDepartmentId)}`);
}

export function fetchControlProjectWorkflow(projectId: string, subDepartmentId: string, templateId?: string | null) {
  const params = new URLSearchParams({ sub_department_id: subDepartmentId });
  if (templateId) params.set("template_id", templateId);
  return apiRequest<ControlProjectWorkflow | null>(`/control/workflows/project/${encodeURIComponent(projectId)}?${params.toString()}`);
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

export function reassignControlProjectWorkflowOwner(workflowId: string, assignedUserId: string, reason?: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflows/${encodeURIComponent(workflowId)}/owner`, {
    method: "PATCH",
    body: JSON.stringify(stripUndefined({ assigned_user_id: assignedUserId, reason })),
  });
}

export function startControlWorkflowStage(stageId: string, version?: number) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/start`, {
    method: "POST",
    body: JSON.stringify(stripUndefined({ version })),
  });
}

export function submitControlWorkflowStage(stageId: string, payload: { submitted_document_path?: string; remarks?: string; version?: number }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/submit`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function approveControlWorkflowStage(stageId: string, payload: { review_remarks?: string; version?: number } = {}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/approve`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function markControlWorkflowStageRevisionRequired(stageId: string, payload: {
  reason: string;
  detailed_instruction: string;
  correction_deadline?: string;
  version?: number;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/changes-required`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function raiseControlWorkflowRevision(stageId: string, payload: {
  revision_reason: ControlRevisionReason;
  reference_path?: string;
  manual_reason?: string;
  description: string;
  due_date: string;
  priority?: string;
  remarks?: string;
  affected_stage_ids?: string[];
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/revisions`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function updateControlWorkflowDocumentPath(stageId: string, payload: { document_path: string; remarks?: string; version?: number }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/document-path`, {
    method: "PATCH",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function uploadControlWorkflowProof(
  stageId: string,
  file: File,
  comment = "",
  onProgress?: (percent: number) => void,
) {
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("Work-proof file must be 10 MB or smaller"));
  return new Promise<ControlWorkflowProof>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE_URL}/control/workflow-stages/${encodeURIComponent(stageId)}/proofs`);
    const token = getStoredToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Work-proof upload failed"));
    request.onload = () => {
      let payload: { success?: boolean; data?: ControlWorkflowProof; message?: string; error?: string } | null = null;
      try { payload = request.responseText ? JSON.parse(request.responseText) : null; } catch { payload = null; }
      if (request.status >= 200 && request.status < 300) {
        const proof = payload?.success ? payload.data : payload as ControlWorkflowProof | null;
        if (proof) resolve(proof); else reject(new Error("Work-proof upload returned no file metadata"));
        return;
      }
      reject(new Error(payload?.message || payload?.error || "Work-proof upload failed"));
    };
    const body = new FormData();
    body.append("file", file);
    if (comment.trim()) body.append("comment", comment.trim());
    request.send(body);
  });
}

export function removeControlWorkflowProof(proofId: string) {
  return apiRequest<{ id: string }>(`/control/workflow-proofs/${encodeURIComponent(proofId)}`, { method: "DELETE" });
}

export async function fetchControlWorkflowProofBlob(url: string) {
  const headers = new Headers();
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${url}`, { headers });
  if (!response.ok) {
    let message = "Could not open work proof";
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message || payload.error || message;
    } catch { /* response was not JSON */ }
    throw new Error(message);
  }
  return response.blob();
}

export async function openControlWorkflowProof(proof: ControlWorkflowProof) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  try {
    const url = URL.createObjectURL(await fetchControlWorkflowProofBlob(proof.open_url));
    if (popup) popup.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

export function downloadControlWorkflowProof(proof: ControlWorkflowProof) {
  return apiDownload(proof.download_url, { filename: proof.original_filename });
}

export function addControlWorkflowStageComment(stageId: string, comment: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ comment }),
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

export function overrideUnlockControlWorkflowStage(stageId: string, payload: { reason: string; remarks: string; confirm_history_record: boolean }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/override-unlock`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function skipControlWorkflowStageByOverride(stageId: string, payload: {
  reason: string;
  supporting_document_path: string;
  approved_by: string;
  remarks: string;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-stages/${encodeURIComponent(stageId)}/skip-by-override`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function markControlWorkflowDispatched(workflowId: string, payload: { dispatch_date: string; remarks: string }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflows/${encodeURIComponent(workflowId)}/dispatch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startControlWorkflowRevision(revisionId: string) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/start`, { method: "POST" });
}

export function submitControlWorkflowRevision(revisionId: string, payload: { submitted_document_path?: string; remarks?: string; version?: number }) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/submit`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function approveControlWorkflowRevision(revisionId: string, payload: { review_remarks?: string; version?: number } = {}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/approve`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function markControlWorkflowRevisionChangesRequired(revisionId: string, payload: {
  reason: string;
  detailed_instruction: string;
  correction_deadline?: string;
  version?: number;
}) {
  return apiRequest<ControlProjectWorkflow>(`/control/workflow-revisions/${encodeURIComponent(revisionId)}/changes-required`, {
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
