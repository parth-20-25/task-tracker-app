import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/api/authApi";
import { getStoredToken } from "@/api/http";
import { authQueryKeys } from "@/lib/queryKeys";

export function useCurrentUserQuery() {
  return useQuery({
    queryKey: authQueryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: !!getStoredToken(),
    retry: false,
  });
}
