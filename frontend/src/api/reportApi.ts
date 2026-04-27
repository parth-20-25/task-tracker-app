import { apiRequest, apiDownload } from "@/api/http";

export interface WorkflowScopeSummary {
  scope_key: string;
  scope_name: string;
  total_instances: number;
  completed_instances: number;
  fixture_no?: string | null;
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

export interface DesignScopeReportFilters {
  department_id?: string;
  project_id?: string;
  report_type?: "scope" | "project";
  scope_id: string;
}

export interface DesignReportFilters {
  department_id?: string;
  project_id?: string;
  report_type: "scope" | "project";
  scope_id?: string;
}

export function fetchWorkflowSummary() {
  return apiRequest<WorkflowProjectSummary[]>("/reports/workflow-summary");
}

export async function downloadDesignScopeReport(filters: DesignScopeReportFilters, fileName: string) {
  const params = new URLSearchParams();
  params.set("scope_id", filters.scope_id);

  await apiDownload(`/reports/design-scope/export?${params.toString()}`, {
    filename: fileName,
  });
}

export async function downloadDesignReport(filters: DesignReportFilters, fileName: string) {
  const params = new URLSearchParams();
  params.set("report_type", filters.report_type);

  if (filters.department_id) {
    params.set("department_id", filters.department_id);
  }

  if (filters.project_id) {
    params.set("project_id", filters.project_id);
  }

  if (filters.scope_id) {
    params.set("scope_id", filters.scope_id);
  }

  await apiDownload(`/reports/design/export?${params.toString()}`, {
    filename: fileName,
  });
}
