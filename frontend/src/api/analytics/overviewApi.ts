import { apiRequest } from "@/api/http";

export interface AnalyticsOverviewPayload {
  summary?: {
    assigned_entries: number;
    completed_entries: number;
    active_entries: number;
    measurable_entries: number;
    completion_rate_pct: number;
    on_time_rate_pct: number;
    delayed_entries: number;
    avg_delay_minutes: number;
    rework_rate_pct: number;
    rework_events: number;
    avg_cycle_minutes: number;
    bottleneck_stage: string;
  };
  rework: {
    by_stage: Record<string, number>;
    by_user: Array<{ name: string; reworks: number }>;
    total_reworks?: number;
    top_stage_name?: string | null;
  };
  deadline: {
    on_time: number;
    delayed: number;
    measurable_total?: number;
    on_time_rate_pct?: number;
    avg_delay_minutes: number;
    delay_by_stage: Record<string, number>;
  };
  efficiency: {
    avg_stage_duration: Record<string, number>;
    bottleneck_stage: string;
  };
  comparison?: {
    departments: Array<{
      department_id: string;
      department_name: string;
      completed_items: number;
      active_items: number;
      completion_rate_pct: number;
      on_time_rate_pct: number;
      rework_rate_pct: number;
      avg_cycle_minutes: number;
      workflow_health_score: number;
    }>;
  } | null;
  metadata?: {
    department_id: string | null;
    user_id: string | null;
    start_date: string | null;
    end_date: string | null;
    scope_mode: "overall" | "department" | "user";
  };
}

export interface AnalyticsFilters {
  departmentId?: string;
  userId?: string;
  scopeId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
}

export function fetchAnalyticsOverview(filters: AnalyticsFilters = {}): Promise<AnalyticsOverviewPayload> {
  const params = new URLSearchParams();
  if (filters.departmentId) params.append("departmentId", filters.departmentId);
  if (filters.userId) params.append("userId", filters.userId);
  if (filters.scopeId) params.append("scopeId", filters.scopeId);
  if (filters.projectId) params.append("projectId", filters.projectId);
  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);

  const query = params.toString();
  return apiRequest<AnalyticsOverviewPayload>(`/analytics/overview${query ? `?${query}` : ""}`);
}
