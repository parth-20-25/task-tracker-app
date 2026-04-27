import { apiRequest } from "@/api/http";

export interface AnalyticsOverviewPayload {
  rework: {
    by_stage: Record<string, number>;
    by_user: Array<{ name: string; reworks: number }>;
  };
  deadline: {
    on_time: number;
    delayed: number;
    avg_delay_minutes: number;
    delay_by_stage: Record<string, number>;
  };
  efficiency: {
    avg_stage_duration: Record<string, number>;
    bottleneck_stage: string;
  };
}

export interface AnalyticsFilters {
  departmentId?: string;
  userId?: string;
  scopeId?: string;
  projectId?: string;
}

export function fetchAnalyticsOverview(filters: AnalyticsFilters = {}): Promise<AnalyticsOverviewPayload> {
  const params = new URLSearchParams();
  if (filters.departmentId) params.append("departmentId", filters.departmentId);
  if (filters.userId) params.append("userId", filters.userId);
  if (filters.scopeId) params.append("scopeId", filters.scopeId);
  if (filters.projectId) params.append("projectId", filters.projectId);

  const query = params.toString();
  return apiRequest<AnalyticsOverviewPayload>(`/analytics/overview${query ? `?${query}` : ""}`);
}
