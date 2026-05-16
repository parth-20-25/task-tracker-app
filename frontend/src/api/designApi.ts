import { apiRequest } from "@/api/http";
import {
  ConfirmDesignUploadPayload,
  DepartmentProject,
  DesignExcelPreviewRow,
  DesignExcelRejectedRow,
  DesignExcelUploadResponse,
  DesignFixtureOption,
  DesignProjectOption,
  ProjectDashboardSummary,
  Task,
  ValidateRejectedDesignRowResponse,
} from "@/types";

// ── Fixture Workflow Types ────────────────────────────────────────────────────

export type FixtureStageStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "REJECTED";

export interface FixtureCurrentStage {
  stage: string | null;
  stage_label?: string | null;
  stage_version?: number;
  status: FixtureStageStatus | "APPROVED";
  stage_order: number | null;
  is_complete: boolean;
}

export interface FixtureProgressStage {
  stage_name: string;
  stage_label?: string | null;
  stage_version?: number;
  stage_order: number;
  status: FixtureStageStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  updated_at: string;
}

export type FixtureRevisionType =
  | "CUSTOMER_CHANGE"
  | "INTERNAL_DESIGN_CHANGE"
  | "MANUFACTURING_ISSUE"
  | "QUALITY_CORRECTION"
  | "COST_OPTIMIZATION"
  | "APPROVAL_REJECTION"
  | "PROCUREMENT_CONSTRAINT"
  | "MANUAL_OVERRIDE"
  | "OTHER";

export interface FixtureRevisionTimelineEntry {
  id: string;
  fixture_id: string;
  department_id: string;
  revision_no: number;
  revision_type: FixtureRevisionType;
  revision_reason: string;
  revision_remarks?: string | null;
  reverted_from_stage: string;
  reverted_to_stage: string;
  requested_by: string;
  requested_by_name?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  changed_by: string;
  changed_by_name?: string | null;
  changed_at: string;
  metadata: Record<string, unknown>;
}

export interface FixtureFullProgress {
  workflow_name: string;
  revision_no: number;
  is_legacy_workflow: boolean;
  stages: FixtureProgressStage[];
  revisions: FixtureRevisionTimelineEntry[];
}

export interface WorkflowDefinition {
  stages: string[];
}

export interface AssignmentValidation {
  canAssign: boolean;
  reason: string | null;
  currentStage: FixtureProgressStage | null;
}


export interface DepartmentWorkflowPreview {
  id: string;
  name: string;
  first_stage_id: string;
  first_stage_name: string;
}

export interface DepartmentProjectPayload {
  project_no: string;
  project_name: string;
  customer_name: string;
  instance_count: number;
  rework_date?: string | null;
}

export interface CreateDesignTaskPayload {
  department_id?: string;
  project_id: string;
  fixture_id?: string;
  description: string;
  assigned_to: string;
  assignee_ids?: string[];
  priority: Task["priority"];
  deadline: string;
  planned_minutes?: number;
  [key: string]: unknown;
}

export interface UploadDepartmentProjectsResponse {
  success_count: number;
  skipped_rows: Array<{
    row_number: number | null;
    project_no: string;
    project_name: string;
    customer_name: string;
    instance_count: number;
    rework_date?: string | null;
    reason: string;
  }>;
}

function stripUndefined<T extends Record<string, unknown>>(payload: T): T {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as T;
}

export function fetchDepartmentProjects() {
  return apiRequest<DepartmentProject[]>("/department-projects");
}

export function fetchDesignProjects(departmentId?: string, options: { activeOnly?: boolean } = {}) {
  const params = new URLSearchParams();

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  if (options.activeOnly) {
    params.set("active_only", "true");
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<DesignProjectOption[]>(`/design/projects${suffix}`);
}

export function fetchDesignFixtures(projectId: string, departmentId?: string, options: { activeOnly?: boolean } = {}) {
  const params = new URLSearchParams();
  params.set("project_id", projectId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  if (options.activeOnly) {
    params.set("active_only", "true");
  }

  return apiRequest<DesignFixtureOption[]>(`/design/fixtures?${params.toString()}`);
}

export function fetchProjectDashboardSummary(departmentId?: string) {
  const params = new URLSearchParams();

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<ProjectDashboardSummary[]>(`/projects/summary${params.toString() ? `?${params.toString()}` : ""}`);
}

export function fetchDepartmentWorkflowPreview(projectId?: string) {
  const url = projectId ? `/design/workflow-preview?project_id=${encodeURIComponent(projectId)}` : "/design/workflow-preview";
  return apiRequest<DepartmentWorkflowPreview>(url);
}

export function uploadDepartmentProject(payload: DepartmentProjectPayload) {
  return apiRequest<UploadDepartmentProjectsResponse>("/department-projects", {
    method: "POST",
    body: JSON.stringify({ rows: [payload] }),
  });
}

export function uploadDepartmentProjects(payload: DepartmentProjectPayload[]) {
  return apiRequest<UploadDepartmentProjectsResponse>("/department-projects", {
    method: "POST",
    body: JSON.stringify({ rows: payload }),
  });
}

export function createDesignTask(payload: CreateDesignTaskPayload) {
  return apiRequest<Task>("/design/tasks", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function uploadDesignExcel(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return apiRequest<DesignExcelUploadResponse>("/upload/design-excel", {
    method: "POST",
    body: formData,
  });
}

export function confirmDesignUpload(payload: ConfirmDesignUploadPayload) {
  return apiRequest<{ success: boolean; batch_id: string; accepted_count: number }>("/upload/design-excel/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function pastePasteFixtureData(text: string) {
  return apiRequest<DesignExcelUploadResponse>("/design/upload", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function confirmPasteFixtureData(payload: ConfirmDesignUploadPayload) {
  return apiRequest<{ success: boolean; batch_id: string; accepted_count: number }>("/design/upload/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function validateRejectedDesignRow(payload: {
  file_info: DesignExcelUploadResponse["file_info"];
  original_row: DesignExcelRejectedRow;
  corrected_row: Record<string, unknown>;
  reserved_fixture_numbers: string[];
}) {
  return apiRequest<ValidateRejectedDesignRowResponse>("/design/upload/rejected-row/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listFixturesByUploadBatch(batchId: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }
  
  return apiRequest<Array<{
    fixture_id: string;
    fixture_no: string;
    image_1_url: string | null;
    image_2_url: string | null;
    ingestion_source: string | null;
  }>>(`/design/upload-batches/${encodeURIComponent(batchId)}/fixtures${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
  });
}

export function uploadFixtureReferenceImage(
  fixtureId: string,
  imageType: "part" | "fixture",
  file: File,
  departmentId?: string,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("image_type", imageType);

  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<{
    fixture_no: string;
    previous_image_url: string | null;
    new_image_url: string;
  }>(`/design/fixtures/${encodeURIComponent(fixtureId)}/reference-image${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "POST",
    body: formData,
  });
}

// ── Fixture Workflow Engine API ───────────────────────────────────────────────

export function fetchWorkflowByDepartment() {
  return apiRequest<WorkflowDefinition>("/workflows/by-department");
}

export function fetchFixtureCurrentStage(fixtureId: string, departmentId?: string) {
  const params = new URLSearchParams();
  params.set("fixture_id", fixtureId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<FixtureCurrentStage | null>(`/workflows/current-stage?${params.toString()}`);
}

export function fetchFixtureFullProgress(fixtureId: string, departmentId?: string) {
  const params = new URLSearchParams();
  params.set("fixture_id", fixtureId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<FixtureFullProgress>(`/workflows/progress?${params.toString()}`);
}

export function validateFixtureAssignment(fixtureId: string, departmentId?: string) {
  return apiRequest<AssignmentValidation>("/workflows/validate-assignment", {
    method: "POST",
    body: JSON.stringify(stripUndefined({ fixture_id: fixtureId, department_id: departmentId })),
  });
}

export function assignFixtureStage(payload: { fixture_id: string; assigned_to: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/assign", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function completeFixtureStage(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/complete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveFixtureStage(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/approve", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function rejectFixtureStage(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/reject", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function reopenFixtureStage(payload: {
  fixture_id: string;
  department_id?: string;
  target_stage_name?: string;
  target_stage_order?: number;
  revision_type: FixtureRevisionType;
  revision_reason: string;
  remarks?: string;
}) {
  return apiRequest<FixtureFullProgress>("/workflows/reopen-stage", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function manipulateFixtureStage(payload: {
  fixture_id: string;
  department_id?: string;
  target_stage_name?: string;
  target_stage_order?: number;
  target_status?: FixtureStageStatus;
  revision_reason: string;
  remarks?: string;
}) {
  return apiRequest<FixtureFullProgress>("/workflows/manual-stage", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}
