import { useEffect, useMemo, useState } from "react";
import {
  downloadDesignReport,
  fetchWorkflowSummary,
  WorkflowProjectSummary,
} from "@/api/reportApi";
import { fetchAllDepartments } from "@/api/adminApi";
import { fetchDesignProjects, fetchDesignScopes } from "@/api/designApi";
import { ActiveScopeProgress, ActiveScopeProgressItem } from "@/components/reports/ActiveScopeProgress";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { DesignProjectOption, DesignScopeOption } from "@/types";

function sanitizeFileNamePart(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "Report";
}

export default function Reports() {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role?.hierarchy_level === 1;
  const canExportReports = hasPermission("can_export_reports");
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowProjectSummary[]>([]);
  const [reportDepartmentOptions, setReportDepartmentOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedReportDepartmentId, setSelectedReportDepartmentId] = useState("");
  const [reportType, setReportType] = useState<"scope" | "project">("scope");
  const [reportProjects, setReportProjects] = useState<DesignProjectOption[]>([]);
  const [reportScopes, setReportScopes] = useState<DesignScopeOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [reportExportLoading, setReportExportLoading] = useState(false);
  const [reportProjectsLoading, setReportProjectsLoading] = useState(false);
  const [reportScopesLoading, setReportScopesLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      return;
    }

    const fixedDepartmentId = user?.department_id || "";
    setSelectedReportDepartmentId(fixedDepartmentId);
    setReportDepartmentOptions(fixedDepartmentId
      ? [{ id: fixedDepartmentId, name: user?.department?.name || fixedDepartmentId }]
      : []);
  }, [isAdmin, user?.department?.name, user?.department_id]);

  useEffect(() => {
    if (!canExportReports || !isAdmin) {
      return undefined;
    }

    let active = true;

    fetchAllDepartments()
      .then((departments) => {
        if (!active) {
          return;
        }

        const options = departments
          .filter((department) => department.id)
          .map((department) => ({
            id: department.id,
            name: department.name || department.id,
          }))
          .sort((left, right) => left.name.localeCompare(right.name));

        setReportDepartmentOptions(options);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        toast({
          title: "Departments unavailable",
          description: error instanceof Error ? error.message : "Could not load departments for reports.",
          variant: "destructive",
        });
      });

    return () => {
      active = false;
    };
  }, [canExportReports, isAdmin]);

  useEffect(() => {
    if (!canExportReports || !selectedReportDepartmentId) {
      setReportProjects([]);
      setReportScopes([]);
      setSelectedProjectId("");
      setSelectedScopeId("");
      return undefined;
    }

    let active = true;
    setReportProjectsLoading(true);
    setSelectedProjectId("");
    setSelectedScopeId("");
    setReportScopes([]);

    fetchDesignProjects(selectedReportDepartmentId)
      .then((projects) => {
        if (!active) {
          return;
        }

        setReportProjects(projects);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        toast({
          title: "Projects unavailable",
          description: error instanceof Error ? error.message : "Could not load report projects.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) {
          setReportProjectsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [canExportReports, selectedReportDepartmentId]);

  useEffect(() => {
    if (!canExportReports || !selectedProjectId || !selectedReportDepartmentId) {
      setReportScopes([]);
      setSelectedScopeId("");
      return undefined;
    }

    let active = true;
    setReportScopesLoading(true);
    setSelectedScopeId("");

    fetchDesignScopes(selectedProjectId, selectedReportDepartmentId)
      .then((scopes) => {
        if (!active) {
          return;
        }

        setReportScopes(scopes);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        toast({
          title: "Scopes unavailable",
          description: error instanceof Error ? error.message : "Could not load report scopes.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) {
          setReportScopesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [canExportReports, selectedReportDepartmentId, selectedProjectId]);

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

  const selectedProject = useMemo(
    () => reportProjects.find((project) => project.project_id === selectedProjectId) || null,
    [reportProjects, selectedProjectId],
  );

  const selectedScope = useMemo(
    () => reportScopes.find((scope) => scope.scope_id === selectedScopeId) || null,
    [reportScopes, selectedScopeId],
  );

  const selectedDepartmentName = useMemo(
    () => reportDepartmentOptions.find((department) => department.id === selectedReportDepartmentId)?.name
      || user?.department?.name
      || selectedReportDepartmentId,
    [reportDepartmentOptions, selectedReportDepartmentId, user?.department?.name],
  );

  const activeScopeProgressItems = useMemo<ActiveScopeProgressItem[]>(
    () => workflowSummary.flatMap((project) => project.scopes
      .filter((scope) => !scope.is_complete)
      .map((scope) => ({
        project_key: project.project_key,
        project_no: project.project_no || "",
        project_name: project.project_name || "",
        customer_name: project.customer_name || "",
        department_name: project.department_name || project.department_id || "",
        scope_name: scope.scope_name || "",
        fixture_no: scope.fixture_no || null,
        instances_complete: scope.completed_instances ?? 0,
        total_instances: scope.total_instances ?? 0,
      }))),
    [workflowSummary],
  );

  const canDownloadReport = Boolean(
    canExportReports
      && selectedReportDepartmentId
      && selectedProject
      && (reportType === "project" || selectedScope),
  );

  const handleReportDownload = () => {
    if (!selectedProject || !selectedReportDepartmentId) {
      return;
    }

    if (reportType === "scope" && !selectedScope) {
      return;
    }

    const targetName = reportType === "project"
      ? selectedProject.project_name
      : selectedScope?.scope_name || "Scope";
    const reportLabel = reportType === "project"
      ? "Project_Wise_Report"
      : "Scope_Wise_Report";
    const fileName = `${sanitizeFileNamePart(selectedProject.project_code)}_${sanitizeFileNamePart(targetName)}_${reportLabel}.xlsx`;

    setReportExportLoading(true);
    downloadDesignReport({
      department_id: selectedReportDepartmentId,
      project_id: selectedProject.project_id,
      report_type: reportType,
      scope_id: reportType === "scope" ? selectedScope?.scope_id : undefined,
    }, fileName)
      .catch((error) => {
        toast({
          title: "Report export failed",
          description: error instanceof Error ? error.message : "Could not export the report.",
          variant: "destructive",
        });
      })
      .finally(() => {
        setReportExportLoading(false);
      });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate department-driven reports and review active scope progress without report-only UI artifacts.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <ReportFilters
          canExportReports={canExportReports}
          isAdmin={isAdmin}
          departmentOptions={reportDepartmentOptions}
          selectedDepartmentId={selectedReportDepartmentId}
          onDepartmentChange={setSelectedReportDepartmentId}
          selectedDepartmentName={selectedDepartmentName}
          reportType={reportType}
          onReportTypeChange={setReportType}
          projects={reportProjects}
          scopes={reportScopes}
          selectedProjectId={selectedProjectId}
          onProjectChange={setSelectedProjectId}
          selectedScopeId={selectedScopeId}
          onScopeChange={setSelectedScopeId}
          selectedProject={selectedProject}
          selectedScope={selectedScope}
          projectsLoading={reportProjectsLoading}
          scopesLoading={reportScopesLoading}
          exportLoading={reportExportLoading}
          canDownloadReport={canDownloadReport}
          onDownload={handleReportDownload}
        />

        <ActiveScopeProgress items={activeScopeProgressItems} />
      </div>
    </div>
  );
}
