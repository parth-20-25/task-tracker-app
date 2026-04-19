import { useQuery } from "@tanstack/react-query";
import { fetchTasks } from "@/api/taskApi";
import { getStoredToken } from "@/api/http";
import { taskQueryKeys } from "@/lib/queryKeys";

export function useTasksQuery() {
  return useQuery({
    queryKey: taskQueryKeys.all,
    queryFn: fetchTasks,
    enabled: !!getStoredToken(),
  });
}
