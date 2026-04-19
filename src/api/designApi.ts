import { apiRequest } from "@/api/http";
import { DepartmentProject, DesignInstanceOption, DesignProjectOption, DesignScopeOption, Task } from "@/types";

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
  project_id: string;
  scope_id?: string;
  instance_id?: string;
  description: string;
  assigned_to: string;
  assignee_ids?: string[];
  priority: Task["priority"];
  deadline: string;
  planned_minutes?: number;
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

export function fetchDepartmentProjects() {
  return apiRequest<DepartmentProject[]>("/department-projects");
}

export function fetchDesignProjects() {
  return apiRequest<DesignProjectOption[]>("/design/projects");
}

export function fetchDesignScopes(projectId: string) {
  return apiRequest<DesignScopeOption[]>(`/design/scopes?project_id=${encodeURIComponent(projectId)}`);
}

export function fetchDesignInstances(scopeId: string) {
  return apiRequest<DesignInstanceOption[]>(`/design/instances?scope_id=${encodeURIComponent(scopeId)}`);
}

export function fetchDepartmentWorkflowPreview() {
  return apiRequest<DepartmentWorkflowPreview>("/design/workflow-preview");
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
    body: JSON.stringify(payload),
  });
}
