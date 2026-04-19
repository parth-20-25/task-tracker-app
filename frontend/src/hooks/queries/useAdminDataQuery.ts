import { useQueries } from "@tanstack/react-query";
import { fetchAuditLogs, fetchDepartments, fetchRoles, fetchUsers } from "@/api/adminApi";
import { getStoredToken } from "@/api/http";
import { adminQueryKeys } from "@/lib/queryKeys";

export function useAdminDataQuery() {
  const enabled = !!getStoredToken();
  const [usersQuery, rolesQuery, departmentsQuery, auditLogsQuery] = useQueries({
    queries: [
      {
        queryKey: adminQueryKeys.users("accessible"),
        queryFn: () => fetchUsers("accessible"),
        enabled,
      },
      {
        queryKey: adminQueryKeys.roles,
        queryFn: fetchRoles,
        enabled,
      },
      {
        queryKey: adminQueryKeys.departments,
        queryFn: fetchDepartments,
        enabled,
      },
      {
        queryKey: adminQueryKeys.auditLogs,
        queryFn: fetchAuditLogs,
        enabled,
      },
    ],
  });

  return {
    usersQuery,
    rolesQuery,
    departmentsQuery,
    auditLogsQuery,
  };
}
