import { apiRequest } from "@/api/http";

export type ExecutiveDashboardPeriod = "this_week" | "last_week" | "this_month" | "custom";
export type ExecutiveDashboardStatusFilter =
  | "all"
  | "in_progress"
  | "pending_approval"
  | "rework_required"
  | "blocked"
  | "overdue"
  | "released"
  | "not_started";
export type ExecutiveDashboardRiskFilter = "all" | "low" | "medium" | "high";
export type ExecutiveDashboardTone = "blue" | "green" | "amber" | "red" | "neutral";
export type ExecutiveDashboardTrend = "up" | "down" | "neutral";

export interface ExecutiveDashboardFilters {
  department?: string;
  period?: ExecutiveDashboardPeriod;
  status?: ExecutiveDashboardStatusFilter;
  risk?: ExecutiveDashboardRiskFilter;
  search?: string;
  page?: number;
  page_size?: number;
  start?: string;
  end?: string;
}

export interface DashboardDepartmentOption {
  id: string;
  label: string;
  name?: string;
}

export interface SelectedDashboardDepartment {
  id: string | null;
  label: string;
  mode: "all" | "department";
}

export interface ExecutiveDashboardKpi {
  id: string;
  label: string;
  value: number;
  detail: string;
  trend?: ExecutiveDashboardTrend;
  tooltip: string;
  tone: ExecutiveDashboardTone;
  featured?: boolean;
}

export interface ExecutiveNeedsAttentionItem {
  id: string;
  label: string;
  count: number;
  description: string;
  action?: Partial<Pick<ExecutiveDashboardFilters, "status" | "risk" | "department">>;
}

export interface ExecutiveOverviewSegment {
  id: string;
  label: string;
  value: number;
  percent: number;
  tone: ExecutiveDashboardTone;
}

export interface ExecutiveDepartmentOverview {
  title: string;
  total_projects: number;
  comparison: {
    direction: ExecutiveDashboardTrend;
    text: string;
  };
  segments: ExecutiveOverviewSegment[];
}

export interface ExecutiveDepartmentComparisonRow {
  department_id: string;
  department_name: string;
  total_projects: number;
  completed_this_period: number;
  on_track: number;
  on_track_percent: number;
  at_risk: number;
  at_risk_percent: number;
  overdue: number;
  overdue_percent: number;
}

export interface ExecutiveOwnerWorkloadItem {
  owner_id: string;
  owner_name: string;
  active_projects: number;
  workload_percent: number;
}

export interface ExecutiveOwnerWorkload {
  title: string;
  basis: string;
  items: ExecutiveOwnerWorkloadItem[];
}

export interface ExecutiveApprovalsSummary {
  pending_my_approval: number;
  pending_over_24h: number;
  pending_over_48h: number;
}

export interface ExecutiveProjectHealthRow {
  project_id: string;
  project_no: string;
  project_name: string;
  customer_name: string;
  department_id: string;
  department_name: string;
  fixture_count: number;
  two_d_owner: string;
  three_d_owner: string;
  control_owner: string;
  project_owner: string;
  current_stage: string;
  current_control_stage: string;
  current_assignee: string;
  assigned_to: string;
  approval_with: string;
  progress: number;
  status: Exclude<ExecutiveDashboardStatusFilter, "all">;
  risk: Exclude<ExecutiveDashboardRiskFilter, "all">;
  due_at: string | null;
  last_updated_at: string | null;
  is_overdue: boolean;
}

export interface ExecutiveDashboardResponse {
  timezone: string;
  selected_department: SelectedDashboardDepartment;
  filters: {
    department: string;
    period: ExecutiveDashboardPeriod;
    period_label: string;
    status: ExecutiveDashboardStatusFilter;
    risk: ExecutiveDashboardRiskFilter;
    search: string;
    start: string;
    end: string;
  };
  departments: DashboardDepartmentOption[];
  kpis: ExecutiveDashboardKpi[];
  needs_attention: ExecutiveNeedsAttentionItem[];
  overview: ExecutiveDepartmentOverview;
  department_comparison: ExecutiveDepartmentComparisonRow[];
  owner_workload: ExecutiveOwnerWorkload;
  approvals_summary: ExecutiveApprovalsSummary;
  table: {
    rows: ExecutiveProjectHealthRow[];
    page: number;
    page_size: number;
    total_rows: number;
    total_pages: number;
  };
}

export async function fetchExecutiveDashboard(filters: ExecutiveDashboardFilters, init: RequestInit = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    params.set(key, String(value));
  });

  return apiRequest<ExecutiveDashboardResponse>(`/dashboard/executive?${params.toString()}`, init);
}
