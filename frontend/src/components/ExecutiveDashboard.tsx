import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, FolderOpen, Info, RefreshCw, Search, SlidersHorizontal, TrendingUp, UsersRound } from "lucide-react";
import { fetchExecutiveDashboard, type ExecutiveDashboardFilters, type ExecutiveDashboardKpi, type ExecutiveDashboardPeriod, type ExecutiveDashboardResponse, type ExecutiveDashboardRiskFilter, type ExecutiveDashboardStatusFilter, type ExecutiveDashboardTone, type ExecutiveProjectHealthRow, type ExecutiveOverviewSegment } from "@/api/executiveDashboardApi";
import { useAuth } from "@/contexts/useAuth";
import { executiveDashboardQueryKeys } from "@/lib/queryKeys";
import { getDashboardConfigForDepartment, type DashboardColumn } from "@/lib/executiveDashboardConfig";
import { isProjectAuthorityUser } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const STORAGE_KEY = "taskcontrol.executive-dashboard.department";
const PAGE_SIZE = 7;

const periodOptions: Array<{ value: ExecutiveDashboardPeriod; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom Range" },
];

const statusOptions: Array<{ value: ExecutiveDashboardStatusFilter; label: string }> = [
  { value: "all", label: "Status: All" },
  { value: "in_progress", label: "In Progress" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "rework_required", label: "Rework Required" },
  { value: "blocked", label: "Blocked" },
  { value: "overdue", label: "Overdue" },
  { value: "released", label: "Released" },
  { value: "not_started", label: "Not Started" },
];

const riskOptions: Array<{ value: ExecutiveDashboardRiskFilter; label: string }> = [
  { value: "all", label: "Risk: All" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const kpiIcons: Record<string, typeof FolderOpen> = {
  total_active_projects: FolderOpen,
  completed_this_period: CheckCircle2,
  on_track: TrendingUp,
  at_risk: AlertTriangle,
  pending_approval: Clock3,
  overdue: AlertCircle,
};

const toneClasses: Record<ExecutiveDashboardTone, { icon: string; badge: string; text: string; bar: string; card?: string }> = {
  blue: { icon: "bg-blue-50 text-blue-700 ring-blue-100", badge: "border-blue-100 bg-blue-50 text-blue-800", text: "text-blue-700", bar: "bg-blue-500" },
  green: { icon: "bg-emerald-50 text-emerald-700 ring-emerald-100", badge: "border-emerald-100 bg-emerald-50 text-emerald-800", text: "text-emerald-700", bar: "bg-emerald-500", card: "bg-emerald-50/45 ring-1 ring-emerald-100/80" },
  amber: { icon: "bg-amber-50 text-amber-700 ring-amber-100", badge: "border-amber-100 bg-amber-50 text-amber-800", text: "text-amber-700", bar: "bg-amber-500" },
  red: { icon: "bg-red-50 text-red-700 ring-red-100", badge: "border-red-100 bg-red-50 text-red-800", text: "text-red-700", bar: "bg-red-500" },
  neutral: { icon: "bg-slate-100 text-slate-700 ring-slate-200", badge: "border-slate-200 bg-slate-50 text-slate-700", text: "text-slate-600", bar: "bg-slate-300" },
};

const statusLabelMap: Record<Exclude<ExecutiveDashboardStatusFilter, "all">, string> = {
  in_progress: "In Progress",
  pending_approval: "Pending Approval",
  rework_required: "Rework Required",
  blocked: "Blocked",
  overdue: "Overdue",
  released: "Released",
  not_started: "Not Started",
};

const statusClassMap: Record<Exclude<ExecutiveDashboardStatusFilter, "all">, string> = {
  in_progress: "border-blue-100 bg-blue-50 text-blue-800",
  pending_approval: "border-indigo-100 bg-indigo-50 text-indigo-800",
  rework_required: "border-amber-100 bg-amber-50 text-amber-800",
  blocked: "border-red-100 bg-red-50 text-red-800",
  overdue: "border-red-100 bg-red-50 text-red-800",
  released: "border-emerald-100 bg-emerald-50 text-emerald-800",
  not_started: "border-slate-200 bg-slate-50 text-slate-700",
};

const riskClassMap: Record<Exclude<ExecutiveDashboardRiskFilter, "all">, string> = {
  low: "border-emerald-100 bg-emerald-50 text-emerald-800",
  medium: "border-amber-100 bg-amber-50 text-amber-800",
  high: "border-red-100 bg-red-50 text-red-800",
};

function optionValue<T extends string>(value: string | null, options: Array<{ value: T }>, fallback: T): T {
  return options.some((option) => option.value === value) ? value as T : fallback;
}

function todayInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function readStoredDepartment() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
}

function storeDepartment(value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, value);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined, timezone: string) {
  const date = parseDate(value);
  if (!date) return "No date";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: timezone || "Asia/Kolkata" }).format(date);
}

function formatRelative(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "No activity";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function KpiCard({ kpi, loading }: { kpi?: ExecutiveDashboardKpi; loading?: boolean }) {
  if (loading || !kpi) {
    return (
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="flex h-[116px] items-center gap-4 p-5">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-3"><Skeleton className="h-6 w-16" /><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
        </CardContent>
      </Card>
    );
  }
  const Icon = kpiIcons[kpi.id] || Info;
  const tone = toneClasses[kpi.tone] || toneClasses.neutral;
  return (
    <Card className={cn("border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md", kpi.featured && tone.card)}>
      <CardContent className="flex min-h-[116px] items-center gap-4 p-5">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1", tone.icon)}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-3xl font-semibold leading-none tracking-normal text-slate-950">{formatNumber(kpi.value)}</div>
            <Tooltip><TooltipTrigger asChild><button type="button" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Calculation for ${kpi.label}`}><Info className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent className="max-w-72 text-xs leading-5">{kpi.tooltip}</TooltipContent></Tooltip>
          </div>
          <div className="mt-1 text-sm font-medium leading-5 text-slate-800">{kpi.label}</div>
          <div className={cn("mt-2 text-xs font-medium", tone.text)}>{kpi.detail}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Panel({ title, icon: Icon, action, children, className }: { title: string; icon?: typeof Info; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("border-slate-200 bg-white shadow-sm", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-950">{Icon ? <Icon className="h-4 w-4 shrink-0 text-blue-600" /> : null}<span className="truncate">{title}</span></div>
        {action}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function SegmentBar({ segments }: { segments: ExecutiveOverviewSegment[] }) {
  return <div className="flex h-3 overflow-hidden rounded-sm bg-slate-100" aria-label="Department status mix">{segments.map((segment) => <div key={segment.id} className={cn("h-full", toneClasses[segment.tone]?.bar || toneClasses.neutral.bar)} style={{ width: `${Math.max(segment.percent, segment.value > 0 ? 3 : 0)}%` }} title={`${segment.label}: ${segment.value} (${segment.percent}%)`} />)}</div>;
}

function ProjectProgress({ value }: { value: number }) {
  const safeValue = Math.min(100, Math.max(0, Number(value || 0)));
  return <div className="min-w-[112px]"><div className="mb-1 text-xs font-medium text-slate-700">{safeValue}%</div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${safeValue}%` }} /></div></div>;
}

function StatusBadge({ status }: { status: Exclude<ExecutiveDashboardStatusFilter, "all"> }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", statusClassMap[status])}>{statusLabelMap[status] || status}</Badge>;
}

function RiskBadge({ risk }: { risk: Exclude<ExecutiveDashboardRiskFilter, "all"> }) {
  return <Badge variant="outline" className={cn("capitalize", riskClassMap[risk])}>{risk}</Badge>;
}

function renderCell(row: ExecutiveProjectHealthRow, column: DashboardColumn, timezone: string) {
  const value = row[column.key];
  if (column.kind === "progress") return <ProjectProgress value={Number(value || 0)} />;
  if (column.kind === "status") return <StatusBadge status={row.status} />;
  if (column.kind === "risk") return <RiskBadge risk={row.risk} />;
  if (column.kind === "date") return <span className={cn("whitespace-nowrap", row.is_overdue && column.key === "due_at" ? "font-medium text-red-700" : "text-slate-700")}>{formatDate(String(value || ""), timezone)}</span>;
  if (column.kind === "relativeDate") return <div className="whitespace-nowrap"><div className="font-medium text-slate-700">{formatDate(String(value || ""), timezone)}</div><div className="text-xs text-slate-500">{formatRelative(String(value || ""))}</div></div>;
  if (column.kind === "number") return <span className="tabular-nums text-slate-700">{formatNumber(Number(value || 0))}</span>;
  return <span className="line-clamp-2 text-slate-700">{String(value || "-")}</span>;
}

function downloadVisibleRows(data: ExecutiveDashboardResponse, columns: DashboardColumn[]) {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const body = data.table.rows.map((row) => columns.map((column) => {
    const rawValue = row[column.key];
    if (column.kind === "status") return csvEscape(statusLabelMap[row.status]);
    if (column.kind === "risk") return csvEscape(row.risk);
    if (column.kind === "date" || column.kind === "relativeDate") return csvEscape(formatDate(String(rawValue || ""), data.timezone));
    return csvEscape(rawValue);
  }).join(","));
  const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `executive-dashboard-${data.filters.department}-${data.filters.period}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExecutiveDashboard() {
  const { user, access } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canSelectAllDepartments = isProjectAuthorityUser(user) || access?.canViewAllDepartmentsAnalytics === true;
  const storedDepartment = readStoredDepartment();
  const fallbackDepartment = canSelectAllDepartments ? storedDepartment || "all" : user?.department_id || "all";

  const filters = useMemo<ExecutiveDashboardFilters>(() => {
    const period = optionValue(searchParams.get("period"), periodOptions, "this_week");
    return {
      department: searchParams.get("department") || fallbackDepartment,
      period,
      status: optionValue(searchParams.get("status"), statusOptions, "all"),
      risk: optionValue(searchParams.get("risk"), riskOptions, "all"),
      search: searchParams.get("search") || "",
      page: Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1),
      page_size: PAGE_SIZE,
      start: period === "custom" ? searchParams.get("start") || todayInputValue() : undefined,
      end: period === "custom" ? searchParams.get("end") || todayInputValue() : undefined,
    };
  }, [fallbackDepartment, searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const required: Record<string, string> = {
      department: filters.department || "all",
      period: filters.period || "this_week",
      status: filters.status || "all",
      risk: filters.risk || "all",
      page: String(filters.page || 1),
    };
    Object.entries(required).forEach(([key, value]) => {
      if (!next.get(key)) {
        next.set(key, value);
        changed = true;
      }
    });
    if (filters.period === "custom") {
      if (!next.get("start") && filters.start) {
        next.set("start", filters.start);
        changed = true;
      }
      if (!next.get("end") && filters.end) {
        next.set("end", filters.end);
        changed = true;
      }
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [filters.department, filters.end, filters.page, filters.period, filters.risk, filters.start, filters.status, searchParams, setSearchParams]);

  useEffect(() => {
    if (filters.department) storeDepartment(filters.department);
  }, [filters.department]);

  const dashboardQuery = useQuery({
    queryKey: executiveDashboardQueryKeys.filtered(filters),
    queryFn: () => fetchExecutiveDashboard(filters),
    enabled: Boolean(user?.employee_id),
    staleTime: 30_000,
  });

  const data = dashboardQuery.data;
  const selectedDepartment = data?.selected_department || {
    id: filters.department === "all" ? null : filters.department || null,
    label: filters.department === "all" ? "All Departments" : filters.department || "Department",
    mode: filters.department === "all" ? "all" as const : "department" as const,
  };
  const dashboardConfig = getDashboardConfigForDepartment(selectedDepartment.mode === "all" ? "all" : selectedDepartment.id);
  const timezone = data?.timezone || "Asia/Kolkata";
  const departmentButtons = useMemo(() => {
    const departmentOptions = data?.departments || [];
    return [
      ...(canSelectAllDepartments ? [{ id: "all", label: "All Departments" }] : []),
      ...departmentOptions.map((department) => ({ id: department.id, label: department.label })),
    ];
  }, [canSelectAllDepartments, data?.departments]);

  const updateFilters = useCallback((updates: Partial<ExecutiveDashboardFilters>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    });
    if (!Object.prototype.hasOwnProperty.call(updates, "page")) next.set("page", "1");
    if (updates.period && updates.period !== "custom") {
      next.delete("start");
      next.delete("end");
    }
    if (updates.period === "custom") {
      const today = todayInputValue();
      if (!next.get("start")) next.set("start", today);
      if (!next.get("end")) next.set("end", today);
    }
    if (updates.department) storeDepartment(String(updates.department));
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handleExport = useCallback(() => {
    if (data) downloadVisibleRows(data, dashboardConfig.tableColumns);
  }, [dashboardConfig.tableColumns, data]);

  const table = data?.table;
  const page = table?.page || filters.page || 1;
  const totalPages = table?.total_pages || 1;
  const rows = table?.rows || [];
  const pageNumbers = Array.from({ length: Math.min(3, totalPages) }, (_, index) => index + 1);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50/80 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-slate-950">Executive Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">{selectedDepartment.label} - {data?.filters.period_label || periodOptions.find((option) => option.value === filters.period)?.label || "This Week"}</p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="inline-flex w-full rounded-md border border-slate-200 bg-white p-1 shadow-sm lg:w-auto">
              {departmentButtons.map((department) => {
                const selected = (department.id === "all" && selectedDepartment.mode === "all") || department.id === selectedDepartment.id;
                return (
                  <button key={department.id} type="button" onClick={() => updateFilters({ department: department.id })} className={cn("min-h-9 flex-1 rounded px-4 text-sm font-medium transition-colors lg:flex-none", selected ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950")}>{department.label}</button>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-[170px_170px_160px_40px] lg:flex lg:items-center">
              <Select value={filters.period} onValueChange={(value: ExecutiveDashboardPeriod) => updateFilters({ period: value })}>
                <SelectTrigger className="h-10 bg-white"><Clock3 className="mr-2 h-4 w-4 text-slate-500" /><SelectValue /></SelectTrigger>
                <SelectContent>{periodOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.status} onValueChange={(value: ExecutiveDashboardStatusFilter) => updateFilters({ status: value })}>
                <SelectTrigger className="h-10 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.risk} onValueChange={(value: ExecutiveDashboardRiskFilter) => updateFilters({ risk: value })}>
                <SelectTrigger className="h-10 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{riskOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => dashboardQuery.refetch()} title="Refresh dashboard"><RefreshCw className={cn("h-4 w-4", dashboardQuery.isFetching && "animate-spin")} /></Button>
            </div>
          </div>
        </div>

        {filters.period === "custom" ? (
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-end">
            <Input type="date" value={filters.start || ""} onChange={(event) => updateFilters({ start: event.target.value })} className="h-9 bg-white sm:w-40" aria-label="Custom start date" />
            <Input type="date" value={filters.end || ""} onChange={(event) => updateFilters({ end: event.target.value })} className="h-9 bg-white sm:w-40" aria-label="Custom end date" />
          </div>
        ) : null}

        {dashboardQuery.isError ? (
          <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Dashboard unavailable</AlertTitle><AlertDescription>{dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "Could not load executive dashboard data."}</AlertDescription></Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {(data?.kpis || Array.from({ length: 6 })).map((kpi, index) => <KpiCard key={(kpi as ExecutiveDashboardKpi | undefined)?.id || index} kpi={kpi as ExecutiveDashboardKpi | undefined} loading={dashboardQuery.isLoading} />)}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.05fr_1.55fr_1.35fr_1.2fr]">
          <Panel title="Needs Attention" icon={AlertCircle}>
            {dashboardQuery.isLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
            ) : data?.needs_attention.length ? (
              <div className="divide-y divide-slate-100">
                {data.needs_attention.map((item) => (
                  <button key={item.id} type="button" className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-slate-50" onClick={() => updateFilters({ ...item.action, page: 1 })}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-sm font-semibold text-red-700">{item.count}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{item.label}</span><span className="block text-xs text-slate-500">{item.description}</span></span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>
            ) : <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">No exception groups in this scope.</div>}
          </Panel>

          <Panel title={data?.overview.title || `${selectedDepartment.label} Overview`}>
            {dashboardQuery.isLoading || !data ? (
              <div className="space-y-5"><div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16" />)}</div><Skeleton className="h-3 w-full" /><Skeleton className="h-5 w-40" /></div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 divide-slate-100 sm:grid-cols-4 sm:divide-x">
                  {data.overview.segments.map((segment) => (
                    <div key={segment.id} className="px-3 py-1 text-center first:pl-0 last:pr-0">
                      <div className={cn("text-xs font-semibold", toneClasses[segment.tone]?.text || toneClasses.neutral.text)}>{segment.label}</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{segment.value}</div>
                      <div className="mt-1 text-xs text-slate-500">{segment.percent}%</div>
                    </div>
                  ))}
                </div>
                <SegmentBar segments={data.overview.segments} />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Total Projects: <span className="font-medium text-slate-800">{data.overview.total_projects}</span></span>
                  <span className={cn("font-medium", data.overview.comparison.direction === "down" ? "text-red-700" : "text-emerald-700")}>{data.overview.comparison.text}</span>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Department Progress Comparison" icon={UsersRound}>
            {dashboardQuery.isLoading || !data ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-8 w-full" />)}</div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-100">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="h-9 px-3 text-xs">Metric</TableHead>
                      {data.department_comparison.map((department) => <TableHead key={department.department_id} className="h-9 px-3 text-center text-xs"><button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => updateFilters({ department: department.department_id })}>{department.department_name}</button></TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ["Total Projects", "total_projects"],
                      ["Completed This Week", "completed_this_period"],
                      ["On Track", "on_track"],
                      ["At Risk", "at_risk"],
                      ["Overdue", "overdue"],
                    ].map(([label, key]) => (
                      <TableRow key={key} className="hover:bg-transparent">
                        <TableCell className="px-3 py-2 text-xs font-medium text-slate-600">{label}</TableCell>
                        {data.department_comparison.map((department) => {
                          const value = Number(department[key as keyof typeof department] || 0);
                          const percentKey = key === "on_track" ? "on_track_percent" : key === "at_risk" ? "at_risk_percent" : key === "overdue" ? "overdue_percent" : null;
                          const percentValue = percentKey ? Number(department[percentKey as keyof typeof department] || 0) : null;
                          return <TableCell key={`${department.department_id}-${key}`} className="px-3 py-2 text-center text-xs text-slate-700">{formatNumber(value)}{percentValue !== null ? ` (${percentValue}%)` : ""}</TableCell>;
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>

          <Panel title={data?.owner_workload.title || "Owner Workload"}>
            {dashboardQuery.isLoading || !data ? (
              <div className="space-y-4">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
            ) : data.owner_workload.items.length ? (
              <div className="space-y-4">
                {data.owner_workload.items.map((owner) => (
                  <div key={owner.owner_id}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm"><div className="min-w-0"><div className="truncate font-medium text-slate-900">{owner.owner_name}</div><div className="text-xs text-slate-500">{owner.active_projects} active projects</div></div><div className="text-xs font-medium text-slate-500">{owner.workload_percent}%</div></div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${owner.workload_percent}%` }} /></div>
                  </div>
                ))}
                <Button type="button" variant="link" className="h-auto p-0 text-blue-700" onClick={() => navigate(`/analytics?department=${encodeURIComponent(data.filters.department)}`)}>View all workloads</Button>
              </div>
            ) : <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">No active owner workload in this scope.</div>}
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="min-w-0 border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-950">Project Health - {selectedDepartment.label}</div>
                <div className="mt-1 text-xs text-slate-500">Showing {rows.length ? ((page - 1) * PAGE_SIZE) + 1 : 0} to {Math.min(page * PAGE_SIZE, table?.total_rows || 0)} of {table?.total_rows || 0} projects</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={filters.search || ""} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Search projects..." className="h-9 bg-white pl-9" />
                </div>
                <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={() => updateFilters({ status: "all", risk: "all", search: "" })}><SlidersHorizontal className="mr-2 h-4 w-4" />Filters</Button>
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 bg-white" onClick={handleExport} disabled={!data || !rows.length} title="Download visible project rows"><Download className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[560px] overflow-auto">
                <Table className="min-w-[1180px]">
                  <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                    <TableRow className="hover:bg-transparent">{dashboardConfig.tableColumns.map((column) => <TableHead key={column.key} className={cn("h-10 px-3 text-xs font-semibold text-slate-500", column.className)}>{column.label}</TableHead>)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardQuery.isLoading ? (
                      Array.from({ length: PAGE_SIZE }).map((_, rowIndex) => <TableRow key={rowIndex}>{dashboardConfig.tableColumns.map((column) => <TableCell key={column.key} className="px-3 py-3"><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>)
                    ) : rows.length ? (
                      rows.map((row) => (
                        <TableRow key={row.project_id} className={cn("cursor-pointer", row.is_overdue && "bg-red-50/45 hover:bg-red-50")} onClick={() => navigate(`/batches?project_id=${encodeURIComponent(row.project_id)}`)}>
                          {dashboardConfig.tableColumns.map((column) => <TableCell key={column.key} className="px-3 py-3 text-xs">{renderCell(row, column, timezone)}</TableCell>)}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={dashboardConfig.tableColumns.length} className="h-28 text-center text-sm text-slate-500">No projects match the selected filters.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">Page {page} of {totalPages}</div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => updateFilters({ page: page - 1 })}><ChevronLeft className="h-4 w-4" /></Button>
                  {pageNumbers.map((pageNumber) => <Button key={pageNumber} type="button" variant={page === pageNumber ? "default" : "outline"} size="sm" className="h-8 min-w-8" onClick={() => updateFilters({ page: pageNumber })}>{pageNumber}</Button>)}
                  {totalPages > 3 ? <span className="px-1 text-xs text-slate-400">...</span> : null}
                  {totalPages > 3 ? <Button type="button" variant={page === totalPages ? "default" : "outline"} size="sm" className="h-8 min-w-8" onClick={() => updateFilters({ page: totalPages })}>{totalPages}</Button> : null}
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => updateFilters({ page: page + 1 })}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Panel title="Approvals Summary" icon={Clock3}>
            {dashboardQuery.isLoading || !data ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div>
            ) : (
              <div className="space-y-3">
                {[
                  ["Pending My Approval", data.approvals_summary.pending_my_approval, "blue"],
                  ["Pending > 24 Hours", data.approvals_summary.pending_over_24h, "amber"],
                  ["Pending > 48 Hours", data.approvals_summary.pending_over_48h, "red"],
                ].map(([label, value, tone]) => (
                  <button key={String(label)} type="button" className="flex w-full items-center justify-between rounded-md border border-slate-100 bg-white px-3 py-3 text-left transition-colors hover:bg-slate-50" onClick={() => updateFilters({ status: "pending_approval" })}>
                    <span className="text-sm font-medium text-slate-700">{label}</span>
                    <span className={cn("rounded-md px-2.5 py-1 text-sm font-semibold", toneClasses[tone as ExecutiveDashboardTone]?.badge)}>{value}</span>
                  </button>
                ))}
                <Button type="button" variant="link" className="h-auto p-0 text-blue-700" onClick={() => navigate("/team-tasks?status=pending_verification")}>Go to Approvals</Button>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

