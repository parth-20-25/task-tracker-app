import { useEffect, useMemo, useState } from "react";
import { fetchDesignReportProjects } from "@/api/reportApi";
import { fetchAllDepartments } from "@/api/adminApi";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { DesignProjectOption } from "@/types";
import { isProjectAuthorityUser } from "@/lib/permissions";

export default function Reports() {
  const { user, access } = useAuth();
  const canSelectDepartments = access.canManageDepartments || isProjectAuthorityUser(user);
  const canExportReports = access.canExportReports;
  const [reportDepartmentOptions, setReportDepartmentOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedReportDepartmentId, setSelectedReportDepartmentId] = useState("");
  const [reportProjects, setReportProjects] = useState<DesignProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [reportProjectsLoading, setReportProjectsLoading] = useState(false);

  useEffect(() => {
    if (canSelectDepartments) return;
    const fixedDepartmentId = user?.department_id || "";
    setSelectedReportDepartmentId(fixedDepartmentId);
    setReportDepartmentOptions(fixedDepartmentId ? [{ id: fixedDepartmentId, name: user?.department?.name || fixedDepartmentId }] : []);
  }, [canSelectDepartments, user?.department?.name, user?.department_id]);

  useEffect(() => {
    if (!canExportReports || !canSelectDepartments) return undefined;
    let active = true;
    fetchAllDepartments().then((departments) => {
      if (!active) return;
      setReportDepartmentOptions(departments.filter((department) => department.id).map((department) => ({ id: department.id, name: department.name || department.id })).sort((left, right) => left.name.localeCompare(right.name)));
    }).catch((error) => {
      if (active) toast({ title: "Departments unavailable", description: error instanceof Error ? error.message : "Could not load departments for reports.", variant: "destructive" });
    });
    return () => { active = false; };
  }, [canExportReports, canSelectDepartments]);

  useEffect(() => {
    if (!canExportReports || !selectedReportDepartmentId) {
      setReportProjects([]);
      setSelectedProjectId("");
      return undefined;
    }
    let active = true;
    setReportProjectsLoading(true);
    setSelectedProjectId("");
    fetchDesignReportProjects(selectedReportDepartmentId).then((projects) => {
      if (active) setReportProjects(projects);
    }).catch((error) => {
      if (active) toast({ title: "Projects unavailable", description: error instanceof Error ? error.message : "Could not load report projects.", variant: "destructive" });
    }).finally(() => { if (active) setReportProjectsLoading(false); });
    return () => { active = false; };
  }, [canExportReports, selectedReportDepartmentId]);

  const selectedProject = useMemo(() => reportProjects.find((project) => project.project_id === selectedProjectId) || null, [reportProjects, selectedProjectId]);
  const selectedDepartmentName = useMemo(() => reportDepartmentOptions.find((department) => department.id === selectedReportDepartmentId)?.name || user?.department?.name || selectedReportDepartmentId, [reportDepartmentOptions, selectedReportDepartmentId, user?.department?.name]);
  const canViewReport = Boolean(canExportReports && selectedReportDepartmentId && selectedProject);

  const handleViewHtmlReport = () => {
    if (!selectedProject || !selectedReportDepartmentId) return;
    const params = new URLSearchParams({ department_id: selectedReportDepartmentId, project_id: selectedProject.project_id, report_type: "project" });
    const reportWindow = window.open(`${window.location.origin}/reports/design/view?${params.toString()}`, "_blank");
    if (reportWindow) {
      reportWindow.opener = null;
      return;
    }
    toast({ title: "Report window blocked", description: "Allow pop-ups for this site and try View HTML Report again.", variant: "destructive" });
  };

  return <div className="space-y-6 animate-fade-in"><div><h1 className="text-2xl font-bold">Reports</h1><p className="text-sm text-muted-foreground">Generate department-driven project reports.</p></div><ReportFilters canExportReports={canExportReports} canSelectDepartments={canSelectDepartments} departmentOptions={reportDepartmentOptions} selectedDepartmentId={selectedReportDepartmentId} onDepartmentChange={setSelectedReportDepartmentId} selectedDepartmentName={selectedDepartmentName} projects={reportProjects} selectedProjectId={selectedProjectId} onProjectChange={setSelectedProjectId} selectedProject={selectedProject} projectsLoading={reportProjectsLoading} canViewReport={canViewReport} onViewHtmlReport={handleViewHtmlReport} /></div>;
}