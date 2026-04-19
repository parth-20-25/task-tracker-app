import { useQuery } from "@tanstack/react-query";
import { fetchUsers } from "@/api/adminApi";
import { getStoredToken } from "@/api/http";
import { adminQueryKeys } from "@/lib/queryKeys";

export function useAssignableUsersQuery() {
  return useQuery({
    queryKey: adminQueryKeys.users("assignable"),
    queryFn: () => fetchUsers("assignable"),
    enabled: !!getStoredToken(),
  });
}
