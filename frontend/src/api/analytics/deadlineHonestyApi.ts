import { apiRequest } from "@/api/http";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeadlineHonestitySummary {
  total: number;
  on_time: number;
  delayed: number;
  credibility_score: number; // 0–1
}

export interface DeadlineHonestyErrorDistribution {
  early: number;     
  on_target: number; 
  late: number;      
  severe: number;    
}

export interface DeadlineHonestyErrorStats {
  avg_error_minutes: number;
  median_error_minutes: number;
  max_delay_minutes: number;
}

export interface DeadlineHonestyUserRow {
  user_name: string;
  avg_error_minutes: number;
  credibility_score: number; // 0–1
  late_rate: number;         // 0–1
}

export interface DeadlineHonestyPayload {
  summary: DeadlineHonestitySummary;
  error_distribution: DeadlineHonestyErrorDistribution;
  error_stats: DeadlineHonestyErrorStats;
  delay_origin: Record<string, number>;
  by_user: DeadlineHonestyUserRow[];
}

export interface DeadlineHonestyFilters {
  departmentId?: string;
  scopeId?: string;
  projectId?: string;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export function fetchDeadlineHonesty(
  filters: DeadlineHonestyFilters = {},
): Promise<DeadlineHonestyPayload> {
  const params = new URLSearchParams();
  if (filters.departmentId) params.append("departmentId", filters.departmentId);
  if (filters.scopeId) params.append("scopeId", filters.scopeId);
  if (filters.projectId) params.append("projectId", filters.projectId);

  const query = params.toString();
  return apiRequest<DeadlineHonestyPayload>(
    `/analytics/deadline-honesty${query ? `?${query}` : ""}`,
  );
}
