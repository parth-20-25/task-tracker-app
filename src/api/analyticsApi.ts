import { apiRequest } from "@/api/http";
import { AnalyticsPayload } from "@/types";

export function fetchAnalytics() {
  return apiRequest<AnalyticsPayload>("/analytics");
}
