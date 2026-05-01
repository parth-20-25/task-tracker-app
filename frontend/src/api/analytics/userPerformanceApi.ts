import { apiRequest } from "@/api/http";

export interface UserPerformanceRow {
  name: string;
  fixtures_completed: number;
  avg_duration_minutes: number;
  avg_stage_duration: Record<string, number>;
  rework_rate: number;
  on_time_rate: number;
  avg_planning_error_minutes: number;
  performance_score: number;
  classification: string;
}

export interface UserPerformanceTeamSummary {
  total_users: number;
  avg_score: number;
  best_performer: string | null;
  highest_rework_risk: string | null;
  most_accountable?: string | null;
}

export interface UserPerformancePayload {
  users: UserPerformanceRow[];
  team_summary: UserPerformanceTeamSummary;
}

export interface UserPerformanceFilters {
  departmentId?: string;
  userId?: string;
  scopeId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
}

export function fetchUserPerformance(
  filters: UserPerformanceFilters = {},
): Promise<UserPerformancePayload> {
  const params = new URLSearchParams();
  if (filters.departmentId) params.append("departmentId", filters.departmentId);
  if (filters.userId) params.append("userId", filters.userId);
  if (filters.scopeId) params.append("scopeId", filters.scopeId);
  if (filters.projectId) params.append("projectId", filters.projectId);
  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);

  const query = params.toString();
  return apiRequest<UserPerformancePayload>(
    `/analytics/user-performance${query ? `?${query}` : ""}`,
  );
}
