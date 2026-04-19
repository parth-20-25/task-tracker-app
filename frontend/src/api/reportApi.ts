import { apiRequest, apiDownload, getStoredToken } from "@/api/http";
import { ApiError } from "@/lib/api/ApiError";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

export type TaskReportStatus = "assigned" | "in_progress" | "on_hold" | "review" | "rework" | "closed" | "all";

export interface TaskReportFilters {
  start_date?: string;
  end_date?: string;
  department_id?: string;
  status?: TaskReportStatus;
}

export interface TaskReportRow {
  project_no: string;
  project_name: string;
  project_description: string;
  customer_name: string;
  priority: string;
  scope_name: string;
  instance_code: string;
  quantity_index: string;
  workflow_stage: string;
  assigned_to_name: string;
  assignee_name: string;
  assigned_by_name: string;
  status: string;
  rework_history: string;
  planned_hours: number;
  start_time: string;
  end_time: string;
  department_id: string;
  department_name: string;
}

export interface WorkflowScopeSummary {
  scope_key: string;
  scope_name: string;
  total_instances: number;
  completed_instances: number;
  is_complete: boolean;
  status: "GREEN" | "YELLOW" | "RED";
  any_instance_started: boolean;
  any_instance_beyond_first_stage: boolean;
}

export interface WorkflowProjectSummary {
  project_key: string;
  department_id: string;
  department_name: string;
  project_no: string;
  project_name: string;
  customer_name: string;
  total_instances: number;
  completed_instances: number;
  total_scopes: number;
  completed_scopes: number;
  is_complete: boolean;
  status: "GREEN" | "YELLOW" | "RED";
  any_instance_started: boolean;
  any_instance_beyond_first_stage: boolean;
  scopes: WorkflowScopeSummary[];
}

function buildQueryString(filters: TaskReportFilters = {}) {
  const params = new URLSearchParams();

  if (filters.start_date) {
    params.set("start_date", filters.start_date);
  }

  if (filters.end_date) {
    params.set("end_date", filters.end_date);
  }

  if (filters.department_id && filters.department_id !== "all") {
    params.set("department_id", filters.department_id);
  }

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchTaskReport(filters: TaskReportFilters = {}) {
  return apiRequest<TaskReportRow[]>(`/reports/tasks${buildQueryString(filters)}`);
}

export function fetchWorkflowSummary() {
  return apiRequest<WorkflowProjectSummary[]>("/reports/workflow-summary");
}

export async function downloadTaskReport(filters: TaskReportFilters = {}) {
  await apiDownload(`/reports/tasks/export${buildQueryString(filters)}`, {
    filename: `tasks-report-${new Date().toISOString().slice(0, 10)}.csv`,
  });
}
