import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Filter, MapPin, RotateCcw, Users } from "lucide-react";

import { fetchUsers } from "@/api/adminApi";
import { fetchAnalyticsContext } from "@/api/analytics/contextApi";
import { analyticsQueryKeys } from "@/lib/queryKeys";
import { adminQueryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/contexts/useAuth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AnalyticsFilterBarProps {
  onFilterChange: (filters: {
    departmentId?: string;
    userId?: string;
    scopeId?: string;
    projectId?: string;
    startDate?: string;
    endDate?: string;
  }) => void;
}

function toInputDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export default function AnalyticsFilterBar({ onFilterChange }: AnalyticsFilterBarProps) {
  const { user } = useAuth();
  const { data: analyticsContext } = useQuery({
    queryKey: analyticsQueryKeys.context,
    queryFn: fetchAnalyticsContext,
  });
  const { data: users } = useQuery({
    queryKey: adminQueryKeys.users("accessible"),
    queryFn: () => fetchUsers("accessible"),
  });

  const canViewAllDepartments = analyticsContext?.permissions.view_department_comparison === true;
  const departmentOptions = analyticsContext?.departments ?? [];
  const defaultDepartmentId = canViewAllDepartments
    ? "overall"
    : analyticsContext?.default_department_id || user?.department_id || "overall";

  const [departmentId, setDepartmentId] = useState<string>(defaultDepartmentId);
  const [userId, setUserId] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  useEffect(() => {
    setDepartmentId(defaultDepartmentId);
  }, [defaultDepartmentId]);

  const filteredUsers = useMemo(() => {
    if (!users) {
      return [];
    }

    if (departmentId === "overall") {
      return users;
    }

    return users.filter((candidate) => candidate.department_id === departmentId);
  }, [departmentId, users]);

  useEffect(() => {
    if (userId !== "all" && userId !== "self" && filteredUsers.length > 0) {
      const stillVisible = filteredUsers.some((candidate) => candidate.employee_id === userId);
      if (!stillVisible) {
        setUserId("all");
      }
    }
  }, [filteredUsers, userId]);

  useEffect(() => {
    onFilterChange({
      departmentId: departmentId === "overall" ? undefined : departmentId,
      userId: userId === "all" ? undefined : userId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  }, [departmentId, endDate, onFilterChange, startDate, userId]);

  const isFiltered = departmentId !== defaultDepartmentId || userId !== "all" || Boolean(startDate) || Boolean(endDate);

  return (
    <div className="sticky top-0 z-30 w-full rounded-b-2xl border-b border-border/50 bg-background/80 px-6 py-3 shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-2 flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wider text-foreground">Filters</span>
        </div>

        <div className="flex min-w-[170px] flex-col gap-1">
          <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
            <MapPin className="h-2.5 w-2.5" /> Department
          </label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="h-9 rounded-xl border-border/60 bg-background/50 text-xs transition-colors hover:bg-background">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/60 shadow-xl">
              {canViewAllDepartments && <SelectItem value="overall">Overall</SelectItem>}
              {departmentOptions.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-[190px] flex-col gap-1">
          <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
            <Users className="h-2.5 w-2.5" /> Accountability
          </label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-9 rounded-xl border-border/60 bg-background/50 text-xs transition-colors hover:bg-background">
              <SelectValue placeholder="All visible users" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/60 shadow-xl">
              <SelectItem value="all">All visible users</SelectItem>
              <SelectItem value="self">Only me</SelectItem>
              {filteredUsers.map((candidate) => (
                <SelectItem key={candidate.employee_id} value={candidate.employee_id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-[150px] flex-col gap-1">
          <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
            <CalendarRange className="h-2.5 w-2.5" /> Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-9 rounded-xl border border-border/60 bg-background/50 px-3 text-xs text-foreground outline-none transition-colors hover:bg-background focus:border-primary"
            max={endDate || undefined}
          />
        </div>

        <div className="flex min-w-[150px] flex-col gap-1">
          <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
            <CalendarRange className="h-2.5 w-2.5" /> End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-9 rounded-xl border border-border/60 bg-background/50 px-3 text-xs text-foreground outline-none transition-colors hover:bg-background focus:border-primary"
            min={startDate || undefined}
          />
        </div>

        {isFiltered && (
          <button
            onClick={() => {
              setDepartmentId(defaultDepartmentId);
              setUserId("all");
              setStartDate("");
              setEndDate("");
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        )}

        {!startDate && !endDate && (
          <button
            onClick={() => {
              const today = new Date();
              const pastThirtyDays = new Date(today);
              pastThirtyDays.setUTCDate(today.getUTCDate() - 29);
              setStartDate(toInputDate(pastThirtyDays));
              setEndDate(toInputDate(today));
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground"
          >
            <CalendarRange className="h-3.5 w-3.5" /> Last 30 days
          </button>
        )}
      </div>
    </div>
  );
}
