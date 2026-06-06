import { apiDownload } from "@/api/http";

export interface DesignReportFilters {
  department_id?: string;
  project_id?: string;
  report_type: "project";
  format?: "xlsx" | "pdf";
}

export async function downloadDesignReport(filters: DesignReportFilters, fileName: string) {
  const params = new URLSearchParams();
  params.set("report_type", filters.report_type);
  params.set("format", filters.format || "xlsx");

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
