import { apiRequest } from "@/api/http";
import type { PerformanceAnalyticsContext } from "@/types";

export function fetchAnalyticsContext() {
  return apiRequest<PerformanceAnalyticsContext>("/analytics/context");
}
