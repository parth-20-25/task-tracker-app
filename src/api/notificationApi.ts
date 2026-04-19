import { apiRequest } from "@/api/http";
import { Notification } from "@/types";

export function fetchNotifications() {
  return apiRequest<Notification[]>("/notifications");
}

export function markNotificationRead(notificationId: string) {
  return apiRequest<Notification>(`/notifications/${notificationId}/read`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
}
