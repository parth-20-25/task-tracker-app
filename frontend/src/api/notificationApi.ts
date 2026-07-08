import { apiRequest } from "@/api/http";
import type { OverdueAlert, TaskNotification } from "@/types";

export function fetchMyOverdueAlerts() {
  return apiRequest<OverdueAlert[]>("/notifications/overdue/me");
}

export function fetchTeamOverdueAlerts() {
  return apiRequest<OverdueAlert[]>("/notifications/overdue/team");
}

export function acknowledgeNotification(notificationId: string) {
  return apiRequest<TaskNotification>(`/notifications/${encodeURIComponent(notificationId)}/acknowledge`, {
    method: "POST",
  });
}