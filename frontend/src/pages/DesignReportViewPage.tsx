import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { DesignReportDataResponse, fetchDesignReportData } from "@/api/reportApi";
import { DesignExecutionReportView } from "@/components/reports/DesignExecutionReportView";

export default function DesignReportViewPage() {
  const [searchParams] = useSearchParams();
  const [report, setReport] = useState<DesignReportDataResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const filters = useMemo(() => ({
    department_id: searchParams.get("department_id") || "",
    project_id: searchParams.get("project_id") || "",
    report_type: "project" as const,
  }), [searchParams]);

  useEffect(() => {
    if (!filters.department_id || !filters.project_id) {
      setReport(null);
      setError("Department and project are required to view the report.");
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError("");
    setReport(null);

    fetchDesignReportData(filters)
      .then((nextReport) => {
        if (!active) {
          return;
        }

        if (!nextReport.validation.ok) {
          setError(nextReport.validation.warnings[0] || "Report data validation failed.");
          return;
        }

        setReport(nextReport);
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Could not load report data.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [filters]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading report data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-xl rounded border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <h1 className="text-lg font-semibold">Report could not be loaded</h1>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return report ? <DesignExecutionReportView report={report} /> : null;
}
