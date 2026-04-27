import { apiRequest } from "@/api/http";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkflowHealthStatus = "HEALTHY" | "MODERATE" | "UNSTABLE" | "CRITICAL";

export interface WorkflowHealthBreakdown {
  efficiency: number;
  quality: number;
  reliability: number;
  stability: number;
}

export interface WorkflowHealthRaw {
  avg_duration_minutes: number;
  rework_rate: number;
  on_time_rate: number;
  planning_error_std_dev: number;
  fixture_count: number;
  measurable_count: number;
}

export interface WorkflowHealthPayload {
  overall_score: number;
  breakdown: WorkflowHealthBreakdown;
  status: WorkflowHealthStatus;
  weakest_dimension: keyof WorkflowHealthBreakdown;
  raw: WorkflowHealthRaw;
}

export interface WorkflowHealthFilters {
  departmentId?: string;
  scopeId?: string;
  projectId?: string;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export function fetchWorkflowHealth(
  filters: WorkflowHealthFilters = {},
): Promise<WorkflowHealthPayload> {
  const params = new URLSearchParams();
  if (filters.departmentId) params.append("departmentId", filters.departmentId);
  if (filters.scopeId) params.append("scopeId", filters.scopeId);
  if (filters.projectId) params.append("projectId", filters.projectId);

  const query = params.toString();
  return apiRequest<WorkflowHealthPayload>(
    `/analytics/workflow-health${query ? `?${query}` : ""}`,
  );
}
