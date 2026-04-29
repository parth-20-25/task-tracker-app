import { apiRequest } from "@/api/http";
import { DepartmentProject, DesignFixtureOption, DesignProjectOption, DesignScopeOption, Task, DesignExcelUploadResponse, ConfirmDesignUploadPayload } from "@/types";

// ── Fixture Workflow Types ────────────────────────────────────────────────────

export type FixtureStageStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "REJECTED";

export interface FixtureCurrentStage {
  stage: string | null;
  status: FixtureStageStatus | "APPROVED";
  stage_order: number | null;
  is_complete: boolean;
}

export interface FixtureProgressStage {
  stage_name: string;
  stage_order: number;
  status: FixtureStageStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  updated_at: string;
}

export interface FixtureFullProgress {
  workflow_name: string;
  stages: FixtureProgressStage[];
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
  scope_name: string;
  instance_count: number;
  rework_date?: string | null;
}

export interface CreateDesignTaskPayload {
  department_id?: string;
  project_id: string;
  scope_id?: string;
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
    scope_name: string;
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

export function fetchDesignProjects(departmentId?: string) {
  const url = departmentId
    ? `/design/projects?department_id=${encodeURIComponent(departmentId)}`
    : "/design/projects";
  return apiRequest<DesignProjectOption[]>(url);
}

export function fetchDesignScopes(projectId: string, departmentId?: string) {
  const params = new URLSearchParams();
  params.set("project_id", projectId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<DesignScopeOption[]>(`/design/scopes?${params.toString()}`);
}

export function fetchDesignFixtures(scopeId: string, departmentId?: string) {
  const params = new URLSearchParams();
  params.set("scope_id", scopeId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<DesignFixtureOption[]>(`/design/fixtures?${params.toString()}`);
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
