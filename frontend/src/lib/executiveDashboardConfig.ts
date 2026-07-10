import type { ExecutiveProjectHealthRow } from "@/api/executiveDashboardApi";

export type DashboardColumnKey = keyof ExecutiveProjectHealthRow;

export interface DashboardColumn {
  key: DashboardColumnKey;
  label: string;
  kind?: "text" | "progress" | "status" | "risk" | "date" | "relativeDate" | "number";
  className?: string;
}

export interface DepartmentDashboardConfig {
  id: string;
  label: string;
  tableColumns: DashboardColumn[];
  ownerFields: DashboardColumnKey[];
  supportedMetrics: string[];
}

const commonTrailingColumns: DashboardColumn[] = [
  { key: "progress", label: "Progress", kind: "progress", className: "min-w-[130px]" },
  { key: "status", label: "Status", kind: "status", className: "min-w-[120px]" },
  { key: "risk", label: "Risk", kind: "risk", className: "min-w-[88px]" },
  { key: "due_at", label: "Due Date", kind: "date", className: "min-w-[108px]" },
  { key: "last_updated_at", label: "Last Updated", kind: "relativeDate", className: "min-w-[124px]" },
];

const allDepartmentsColumns: DashboardColumn[] = [
  { key: "project_no", label: "Project No.", className: "min-w-[118px]" },
  { key: "project_name", label: "Project Name", className: "min-w-[220px]" },
  { key: "customer_name", label: "Customer", className: "min-w-[140px]" },
  { key: "department_name", label: "Department", className: "min-w-[120px]" },
  { key: "project_owner", label: "Project Owner", className: "min-w-[150px]" },
  { key: "current_stage", label: "Current Stage", className: "min-w-[150px]" },
  { key: "current_assignee", label: "Current Assignee", className: "min-w-[160px]" },
  ...commonTrailingColumns,
];

const designColumns: DashboardColumn[] = [
  { key: "project_no", label: "Project No.", className: "min-w-[118px]" },
  { key: "project_name", label: "Project Name", className: "min-w-[220px]" },
  { key: "customer_name", label: "Customer", className: "min-w-[140px]" },
  { key: "fixture_count", label: "Fixture Count", kind: "number", className: "min-w-[110px]" },
  { key: "two_d_owner", label: "2D Owner", className: "min-w-[130px]" },
  { key: "three_d_owner", label: "3D Owner", className: "min-w-[130px]" },
  { key: "current_stage", label: "Current Stage", className: "min-w-[150px]" },
  ...commonTrailingColumns,
];

const controlColumns: DashboardColumn[] = [
  { key: "project_no", label: "Project No.", className: "min-w-[118px]" },
  { key: "project_name", label: "Project Name", className: "min-w-[220px]" },
  { key: "customer_name", label: "Customer", className: "min-w-[140px]" },
  { key: "control_owner", label: "Control Owner", className: "min-w-[150px]" },
  { key: "current_control_stage", label: "Current Control Stage", className: "min-w-[170px]" },
  { key: "assigned_to", label: "Assigned To", className: "min-w-[150px]" },
  { key: "approval_with", label: "Approval With", className: "min-w-[150px]" },
  ...commonTrailingColumns,
];

const departmentConfigs: Record<string, DepartmentDashboardConfig> = {
  all: {
    id: "all",
    label: "All Departments",
    tableColumns: allDepartmentsColumns,
    ownerFields: ["project_owner"],
    supportedMetrics: ["kpis", "overview", "comparison", "workload", "approvals", "table"],
  },
  design: {
    id: "design",
    label: "Design",
    tableColumns: designColumns,
    ownerFields: ["two_d_owner", "three_d_owner", "project_owner"],
    supportedMetrics: ["kpis", "overview", "comparison", "workload", "approvals", "table"],
  },
  control: {
    id: "control",
    label: "Control",
    tableColumns: controlColumns,
    ownerFields: ["control_owner", "assigned_to", "approval_with"],
    supportedMetrics: ["kpis", "overview", "comparison", "workload", "approvals", "table"],
  },
};

function normalizeDashboardDepartmentKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getDashboardConfigForDepartment(departmentId: string | null | undefined): DepartmentDashboardConfig {
  const key = normalizeDashboardDepartmentKey(departmentId) || "all";
  return departmentConfigs[key] || {
    id: key,
    label: departmentId || "Department",
    tableColumns: allDepartmentsColumns,
    ownerFields: ["project_owner"],
    supportedMetrics: departmentConfigs.all.supportedMetrics,
  };
}

