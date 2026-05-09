import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DesignProjectOption } from "@/types";
import { formatDesignProjectLabel } from "@/lib/projectDisplay";

interface ReportFiltersProps {
  canExportReports: boolean;
  canSelectDepartments: boolean;
  departmentOptions: Array<{ id: string; name: string }>;
  selectedDepartmentId: string;
  onDepartmentChange: (value: string) => void;
  selectedDepartmentName: string;
  projects: DesignProjectOption[];
  selectedProjectId: string;
  onProjectChange: (value: string) => void;
  selectedProject: DesignProjectOption | null;
  projectsLoading: boolean;
  exportLoading: boolean;
  canDownloadReport: boolean;
  onDownload: () => void;
}

export function ReportFilters({
  canExportReports,
  canSelectDepartments,
  departmentOptions,
  selectedDepartmentId,
  onDepartmentChange,
  selectedDepartmentName,
  projects,
  selectedProjectId,
  onProjectChange,
  selectedProject,
  projectsLoading,
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
      : `Export a project report for ${formatDesignProjectLabel(selectedProject)}.`;

  return (
    <Card className="md:col-span-3">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Report</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            <Select
              value={selectedDepartmentId || "__none__"}
              onValueChange={(value) => onDepartmentChange(value === "__none__" ? "" : value)}
              disabled={!canSelectDepartments || projectsLoading || exportLoading}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {canSelectDepartments ? <SelectItem value="__none__">Select department</SelectItem> : null}
                {departmentOptions.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
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
                    {formatDesignProjectLabel(project)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedDepartmentId
              ? `${selectedDepartmentName} data is loaded dynamically for the selected project. ${helperText}`
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
