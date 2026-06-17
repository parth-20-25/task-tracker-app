import { apiDownload, apiRequest } from "@/api/http";
import { DesignProjectOption } from "@/types";

export interface DesignReportFilters {
  department_id?: string;
  project_id?: string;
  report_type: "project";
  format?: "pdf";
}

export interface DesignReportValidation {
  ok: boolean;
  warnings: string[];
}

export interface DesignReportModel {
  reportVersion: string;
  generatedAt: string;
  generatedBy: string;
  context: Record<string, unknown>;
  statusColors: Record<string, string>;
  auxiliaryColors: Record<string, string>;
  overview: Array<{ label: string; value: string }>;
  kpis: Record<string, string | number | null | string[]>;
  projectProgress: {
    completion_percent: number | null;
    truth_status: string;
    truth_errors: string[];
    overall_stage?: {
      status: string;
      label: string;
      reason?: string | null;
      counts: Record<string, number>;
    };
  };
  stageHealthMatrix: Array<Record<string, string | number>>;
  progressVisualization: Array<{ area: string; percent: number; bar?: string }>;
  fixtureBreakdown: Array<Record<string, string | number | null>>;
  fixtureStageDetails: Array<Record<string, string | number | null>>;
  fixtureStageExecutionAudit: Array<{
    fixtureNumber: string;
    fixtureName: string;
    partFixtureName?: string;
    priority: string;
    currentStatus: string;
    currentStage: string;
    stages: Array<{
      key?: string;
      stage: string;
      status?: string;
      executionMode?: string;
      executionStatus?: string;
      statusReason?: string;
      transition?: string;
      vendor?: string;
      internalCoordinator?: string;
      outsourcingStartedAt?: string;
      outsourcingCompletedAt?: string;
      outsourceRecordStatus?: string;
      revision: string;
      revisionReason?: string;
      reworkLoops?: number;
      plannedStart?: string;
      plannedEnd?: string;
      plannedDuration?: string;
      actualStart?: string;
      actualCompletion?: string;
      elapsedDuration?: string;
      trackedWorkingTime?: string;
      actualEnd?: string;
      plannedTime?: string;
      actualTime?: string;
      variance?: string;
      progress?: string;
      approvalStatus?: string;
      priority?: string;
      transferred?: string;
      proofSummary?: string;
      holdSummary?: string;
      holdEvents?: Array<{
        timestamp: string;
        state: string;
        reason?: string;
        by?: string;
      }>;
      proofLinks?: Array<{ label?: string; url: string; uploadedBy?: string; uploadedAt?: string }>;
      workers?: Array<{
        worker: string;
        contributionPercent: string;
        contributionKind?: string;
        started?: string;
        ended?: string;
        transferReason?: string;
        transferredBy?: string;
        transferredAt?: string;
      }>;
    }>;
    fixtureId?: string;
    opNo?: string;
    assignedTo?: string;
    totalPlannedHours?: string;
    totalActualHours?: string;
    totalVariance?: string;
  }>;
  proofAnalytics: Array<Record<string, string | number | null>>;
  workProofHistory: Array<Record<string, string | number | null>>;
  reworkAnalytics: {
    counts: Record<string, number>;
    rows: Array<Record<string, string | number | null>>;
  };
  revisionHistory: Array<Record<string, string | number | null>>;
  holdHistory: Array<Record<string, string | number | null>>;
  assignmentHistory: Array<Record<string, string | number | null>>;
  activityLog: Array<Record<string, string | number | null>>;
  healthSummary: Array<Record<string, string | number | null>>;
  databaseQuerySummary: string[];
}

export interface DesignReportDataResponse {
  report_type: "project";
  generated_at: string;
  validation: DesignReportValidation;
  model: DesignReportModel;
}

export async function downloadDesignReport(filters: DesignReportFilters, fileName: string) {
  const params = new URLSearchParams();
  params.set("report_type", filters.report_type);
  params.set("format", filters.format || "pdf");

  if (filters.department_id) {
    params.set("department_id", filters.department_id);
  }

  if (filters.project_id) {
    params.set("project_id", filters.project_id);
  }

  await apiDownload(`/reports/design/export?${params.toString()}`, {
    filename: fileName,
  });
}

export function fetchDesignReportProjects(departmentId?: string) {
  const params = new URLSearchParams();

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<DesignProjectOption[]>(`/reports/design/projects${suffix}`);
}

export function fetchDesignReportData(filters: Omit<DesignReportFilters, "format">) {
  const params = new URLSearchParams();
  params.set("report_type", filters.report_type);

  if (filters.department_id) {
    params.set("department_id", filters.department_id);
  }

  if (filters.project_id) {
    params.set("project_id", filters.project_id);
  }

  return apiRequest<DesignReportDataResponse>(`/reports/design/data?${params.toString()}`);
}
