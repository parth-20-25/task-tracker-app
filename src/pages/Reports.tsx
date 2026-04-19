import { useEffect, useMemo, useState } from "react";
import { downloadTaskReport, fetchTaskReport, fetchWorkflowSummary, TaskReportFilters, TaskReportStatus, WorkflowProjectSummary } from "@/api/reportApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Download, FileSpreadsheet, Layers3 } from "lucide-react";
import { cn } from "@/lib/utils";

const statusOptions: Array<{ value: TaskReportStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "on_hold", label: "On Hold" },
  { value: "review", label: "Review" },
  { value: "rework", label: "Rework" },
  { value: "closed", label: "Closed" },
];

function summaryStatusClass(status: "GREEN" | "YELLOW" | "RED") {
  if (status === "GREEN") {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }

  if (status === "YELLOW") {
    return "bg-amber-100 text-amber-900 border-amber-200";
  }

  return "bg-rose-100 text-rose-800 border-rose-200";
}

export default function Reports() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [departmentId, setDepartmentId] = useState("all");
  const [status, setStatus] = useState<TaskReportStatus>("all");
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [matchingCount, setMatchingCount] = useState(0);
  const [departmentOptions, setDepartmentOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowProjectSummary[]>([]);

  const hasInvalidDateRange = Boolean(startDate && endDate && startDate > endDate);

  useEffect(() => {
    let active = true;

    fetchTaskReport({ status: "all" })
      .then((rows) => {
        if (!active) {
          return;
        }

        const options = rows
          .filter((row) => row.department_id)
          .reduce<Array<{ id: string; name: string }>>((items, row) => {
            if (items.some((item) => item.id === row.department_id)) {
              return items;
            }

            items.push({
              id: row.department_id,
              name: row.department_name || row.department_id,
            });
            return items;
          }, [])
          .sort((left, right) => left.name.localeCompare(right.name));

        setDepartmentOptions(options);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        toast({
          title: "Departments unavailable",
          description: "Could not load report departments.",
          variant: "destructive",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetchWorkflowSummary()
      .then((projects) => {
        if (active) {
          setWorkflowSummary(projects);
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        toast({
          title: "Workflow summary unavailable",
          description: error instanceof Error ? error.message : "Could not load workflow completion summary",
          variant: "destructive",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (hasInvalidDateRange) {
      setMatchingCount(0);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);

    const filters: TaskReportFilters = {
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      department_id: departmentId === "all" ? undefined : departmentId,
      status,
    };

    fetchTaskReport(filters)
      .then((rows) => {
        if (!active) {
          return;
        }

        setMatchingCount(rows.length);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        toast({
          title: "Report unavailable",
          description: error instanceof Error ? error.message : "Could not load task report data",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [departmentId, endDate, hasInvalidDateRange, startDate, status]);

  const handleDownload = async () => {
    if (hasInvalidDateRange) {
      toast({
        title: "Invalid date range",
        description: "End date must be on or after start date.",
        variant: "destructive",
      });
      return;
    }

    try {
      setDownloading(true);
      await downloadTaskReport({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        department_id: departmentId === "all" ? undefined : departmentId,
        status,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Could not export the report",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const activeScopeSummary = useMemo(
    () => workflowSummary
      .map((project) => ({
        ...project,
        scopes: project.scopes.filter((scope) => !scope.is_complete),
      }))
      .filter((project) => project.scopes.length > 0),
    [workflowSummary],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate a reusable task report with date, department, and status filters.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-3">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Task Report</h2>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {departmentOptions.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as TaskReportStatus)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-muted-foreground">
                {hasInvalidDateRange
                  ? "End date must be on or after start date."
                  : loading
                    ? "Loading matching tasks..."
                    : `${matchingCount} task${matchingCount === 1 ? "" : "s"} match the current filters.`}
              </div>

              <Button
                className="w-full md:w-auto"
                variant="outline"
                onClick={() => { handleDownload().catch(() => undefined); }}
                disabled={downloading || hasInvalidDateRange}
              >
                <Download className="h-4 w-4 mr-2" />
                {downloading ? "Downloading..." : "Download Report"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Active Scope Progress</h2>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-4">
            {activeScopeSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">All tracked scopes are complete.</p>
            ) : (
              activeScopeSummary.map((project) => (
                <div key={project.project_key} className="rounded-lg border p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {project.project_no}
                        {project.project_name ? ` · ${project.project_name}` : ""}
                      </p>
                      <Badge variant="outline" className={cn(summaryStatusClass(project.status))}>
                        {project.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {project.department_name || project.department_id}
                      {project.customer_name ? ` · ${project.customer_name}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {project.completed_scopes}/{project.total_scopes} scopes complete · {project.completed_instances}/{project.total_instances} instances complete
                    </p>
                  </div>

                  <div className="mt-4 space-y-2">
                    {project.scopes.map((scope) => (
                      <div key={scope.scope_key} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span>{scope.scope_name}</span>
                          <Badge variant="outline" className={cn(summaryStatusClass(scope.status))}>
                            {scope.status}
                          </Badge>
                        </div>
                        <span className="text-muted-foreground">
                          {scope.completed_instances}/{scope.total_instances} instances complete
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
