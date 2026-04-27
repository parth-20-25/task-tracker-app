import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Search, 
  Filter, 
  Users, 
  Layers, 
  MapPin,
  ChevronDown,
  X
} from "lucide-react";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchDepartments, fetchUsers } from "@/api/adminApi";
import { adminQueryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/contexts/useAuth";

interface AnalyticsFilterBarProps {
  onFilterChange: (filters: {
    departmentId?: string;
    userId?: string;
    scopeId?: string;
    projectId?: string;
  }) => void;
}

export default function AnalyticsFilterBar({ onFilterChange }: AnalyticsFilterBarProps) {
  const { user, hasPermission } = useAuth();

  const canViewAllDepartments = hasPermission("view_all_departments_analytics");
  const canViewDepartment = hasPermission("view_department_analytics");
  const lockedDepartmentId = !canViewAllDepartments ? user?.department_id || "all" : "all";

  const [departmentId, setDepartmentId] = useState<string>(lockedDepartmentId);
  const [userId, setUserId] = useState<string>("all");
  const [scopeId, setScopeId] = useState<string>("all");
  const [projectId, setProjectId] = useState<string>("all");
  
  // Fetch departments if user can see multiple
  const { data: departments } = useQuery({
    queryKey: adminQueryKeys.departments,
    queryFn: fetchDepartments,
    enabled: canViewAllDepartments,
  });

  const departmentOptions = canViewAllDepartments
    ? departments ?? []
    : user?.department_id
      ? [{ id: user.department_id, name: user.department?.name || user.department_id }]
      : [];

  // Fetch users for the selected department
  const { data: users } = useQuery({
    queryKey: ["admin", "users", departmentId],
    queryFn: () => fetchUsers("accessible"), // We might want a specialized fetchUsers by department later
    enabled: departmentId !== "all" || canViewAllDepartments,
  });

  const handleFilterChange = () => {
    onFilterChange({
      departmentId: departmentId === "all" ? undefined : departmentId,
      userId: userId === "all" ? undefined : userId,
      scopeId: scopeId === "all" ? undefined : scopeId,
      projectId: projectId === "all" ? undefined : projectId,
    });
  };

  useEffect(() => {
    handleFilterChange();
  }, [departmentId, userId, scopeId, projectId]);

  useEffect(() => {
    if (!canViewAllDepartments && user?.department_id && departmentId !== user.department_id) {
      setDepartmentId(user.department_id);
    }
  }, [canViewAllDepartments, departmentId, user?.department_id]);

  return (
    <div className="sticky top-0 z-30 w-full bg-background/80 backdrop-blur-md border-b border-border/50 px-6 py-3 shadow-sm rounded-b-2xl mb-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 mr-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground uppercase tracking-wider">Filters</span>
        </div>

        {/* Department Selector */}
        {(canViewAllDepartments || canViewDepartment) && (
          <div className="flex flex-col gap-1 min-w-[160px]">
             <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1 flex items-center gap-1">
              <MapPin className="h-2.5 w-2.5" /> Department
            </label>
            <Select 
              value={departmentId} 
              onValueChange={setDepartmentId}
              disabled={!canViewAllDepartments}
            >
              <SelectTrigger className="h-9 rounded-xl border-border/60 bg-background/50 hover:bg-background transition-colors">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/60 shadow-xl overflow-hidden">
                {canViewAllDepartments && <SelectItem value="all">All Departments</SelectItem>}
                {departmentOptions.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* User Selector */}
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1 flex items-center gap-1">
            <Users className="h-2.5 w-2.5" /> Accountability
          </label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-9 rounded-xl border-border/60 bg-background/50 hover:bg-background transition-colors text-xs">
              <SelectValue placeholder="Unified View (All)" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/60 shadow-xl overflow-hidden">
              <SelectItem value="all">Unified View (All)</SelectItem>
              <SelectItem value="self">Self (My Metrics)</SelectItem>
              <div className="h-px bg-border/40 my-1" />
              {users?.map((u) => (
                <SelectItem key={u.employee_id} value={u.employee_id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search Clear */}
        {(departmentId !== "all" || userId !== "all") && (
          <button 
            onClick={() => {
              setDepartmentId(canViewAllDepartments ? "all" : (user?.department_id || "all"));
              setUserId("all");
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all mt-4"
          >
            <X className="h-3.5 w-3.5" /> Reset
          </button>
        )}
      </div>
    </div>
  );
}
