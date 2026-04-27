import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DesignProjectOption, DesignScopeOption } from "@/types";

const reportTypeOptions = [
  { value: "scope", label: "Scope Wise" },
  { value: "project", label: "Project Wise" },
] as const;

interface ReportFiltersProps {
  canExportReports: boolean;
  isAdmin: boolean;
  departmentOptions: Array<{ id: string; name: string }>;
  selectedDepartmentId: string;
  onDepartmentChange: (value: string) => void;
  selectedDepartmentName: string;
  reportType: "scope" | "project";
  onReportTypeChange: (value: "scope" | "project") => void;
  projects: DesignProjectOption[];
  scopes: DesignScopeOption[];
  selectedProjectId: string;
  onProjectChange: (value: string) => void;
  selectedScopeId: string;
  onScopeChange: (value: string) => void;
  selectedProject: DesignProjectOption | null;
  selectedScope: DesignScopeOption | null;
  projectsLoading: boolean;
  scopesLoading: boolean;
  exportLoading: boolean;
  canDownloadReport: boolean;
  onDownload: () => void;
}

export function ReportFilters({
  canExportReports,
  isAdmin,
  departmentOptions,
  selectedDepartmentId,
  onDepartmentChange,
  selectedDepartmentName,
  reportType,
  onReportTypeChange,
  projects,
  scopes,
  selectedProjectId,
  onProjectChange,
  selectedScopeId,
  onScopeChange,
  selectedProject,
  selectedScope,
  projectsLoading,
  scopesLoading,
  exportLoading,
  canDownloadReport,
  onDownload,
}: ReportFiltersProps) {
  if (!canExportReports) {
    return null;
  }

  const helperText = !selectedDepartmentId
    ? "Choose a department to load report data."
    : !selectedProject
      ? "Choose a project to continue."
      : reportType === "project"
        ? `Export a project-wise report for ${selectedProject.project_name}.`
        : selectedScope
          ? `Export a scope-wise report for ${selectedScope.scope_name}.`
          : "Choose a scope to generate the report.";

  return (
    <Card className="md:col-span-3">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Report</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            <Select
              value={selectedDepartmentId || "__none__"}
              onValueChange={(value) => onDepartmentChange(value === "__none__" ? "" : value)}
              disabled={!isAdmin || projectsLoading || exportLoading}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {isAdmin ? <SelectItem value="__none__">Select department</SelectItem> : null}
                {departmentOptions.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Report Type</Label>
            <Select
              value={reportType}
              onValueChange={(value) => onReportTypeChange(value as "scope" | "project")}
              disabled={exportLoading}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reportTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Project</Label>
            <Select
              value={selectedProjectId || "__none__"}
              onValueChange={(value) => onProjectChange(value === "__none__" ? "" : value)}
              disabled={!selectedDepartmentId || projectsLoading || exportLoading}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={projectsLoading ? "Loading projects..." : "Select project"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.project_id} value={project.project_id}>
                    {project.project_code} · {project.project_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Scope</Label>
            <Select
              value={selectedScopeId || "__none__"}
              onValueChange={(value) => onScopeChange(value === "__none__" ? "" : value)}
              disabled={reportType === "project" || !selectedProjectId || scopesLoading || exportLoading}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue
                  placeholder={
                    reportType === "project"
                      ? "Not required"
                      : scopesLoading
                        ? "Loading scopes..."
                        : "Select scope"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {reportType === "project" ? "Not required" : "Select scope"}
                </SelectItem>
                {scopes.map((scope) => (
                  <SelectItem key={scope.scope_id} value={scope.scope_id}>
                    {scope.scope_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedDepartmentId
              ? `${selectedDepartmentName} data is loaded dynamically for the selected project and scope. ${helperText}`
              : helperText}
          </div>

          <Button
            className="w-full md:w-auto"
            variant="outline"
            disabled={!canDownloadReport || exportLoading}
            onClick={onDownload}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportLoading ? "Downloading..." : "Download Report"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
