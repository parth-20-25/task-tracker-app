import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acknowledgeNotification,
  fetchMyOverdueAlerts,
  fetchTeamOverdueAlerts,
} from "@/api/notificationApi";
import { notificationQueryKeys } from "@/lib/queryKeys";

export function useMyOverdueAlertsQuery(enabled = true) {
  return useQuery({
    queryKey: notificationQueryKeys.overdueMe,
    queryFn: fetchMyOverdueAlerts,
    enabled,
    retry: 1,
    staleTime: 30_000,
  });
}

export function useTeamOverdueAlertsQuery(enabled = false) {
  return useQuery({
    queryKey: notificationQueryKeys.overdueTeam,
    queryFn: fetchTeamOverdueAlerts,
    enabled,
    retry: 1,
    staleTime: 30_000,
  });
}

export function useAcknowledgeNotificationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: acknowledgeNotification,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notificationQueryKeys.overdue });
      await queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all });
    },
  });
}