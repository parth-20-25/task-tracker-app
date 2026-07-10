import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  FilePenLine,
  GitBranch,
  Loader2,
  LockKeyhole,
  PauseCircle,
  ShieldCheck,
  UserCheck,
  UserRound,
} from "lucide-react";
import {
  assignControlDesignProjectOwner,
  createControlDesignCo,
  fetchControlDesignAssignableUsers,
  fetchControlDesignProjects,
  fetchControlProjectWorkflow,
  fetchControlSubDepartments,
  fetchControlWorkflowTemplate,
  type ControlDesignProject,
  type ControlWorkflowStageStatus,
} from "@/api/controlWorkflowApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { PERMISSIONS, hasUserPermission } from "@/lib/permissions";
import {
  buildControlDesignWorkflowDisplay,
  type ControlDesignDisplayStage,
  type ControlDesignWorkflowDisplay,
} from "@/lib/controlDesignWorkflowDisplay";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { cn } from "@/lib/utils";

const CONTROL_DESIGN_NAME = "Control Design";
const DEFAULT_CURRENCY = "INR";

const stageStatusLabels: Record<ControlWorkflowStageStatus, string> = {
  approved: "Approved",
  in_progress: "In Progress",
  submitted_for_approval: "Submitted for Approval",
  revision_required: "Revision Required",
  locked: "Locked",
  blocked: "Blocked",
  pre_completed: "Pre-Completed",
  skipped_by_override: "Skipped by Override",
  not_started: "Not Started",
};

const stageStatusClasses: Record<ControlWorkflowStageStatus, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  in_progress: "border-blue-200 bg-blue-50 text-blue-800",
  submitted_for_approval: "border-amber-200 bg-amber-50 text-amber-900",
  revision_required: "border-orange-200 bg-orange-50 text-orange-900",
  locked: "border-slate-200 bg-slate-50 text-slate-500",
  blocked: "border-red-200 bg-red-50 text-red-800",
  pre_completed: "border-violet-200 bg-violet-50 text-violet-800",
  skipped_by_override: "border-zinc-200 bg-zinc-50 text-zinc-700",
  not_started: "border-slate-200 bg-white text-slate-700",
};

const stageNodeClasses: Record<ControlWorkflowStageStatus, string> = {
  approved: "border-emerald-200 bg-emerald-100 text-emerald-700",
  in_progress: "border-blue-200 bg-blue-100 text-blue-700 ring-4 ring-blue-50",
  submitted_for_approval: "border-amber-200 bg-amber-100 text-amber-800",
  revision_required: "border-orange-200 bg-orange-100 text-orange-800",
  locked: "border-slate-200 bg-slate-100 text-slate-500",
  blocked: "border-red-200 bg-red-100 text-red-700",
  pre_completed: "border-violet-200 bg-violet-100 text-violet-700",
  skipped_by_override: "border-zinc-200 bg-zinc-100 text-zinc-700",
  not_started: "border-slate-200 bg-white text-slate-500",
};

const stageIcons: Record<ControlWorkflowStageStatus, LucideIcon> = {
  approved: CheckCircle2,
  in_progress: FilePenLine,
  submitted_for_approval: Clock3,
  revision_required: AlertTriangle,
  locked: LockKeyhole,
  blocked: PauseCircle,
  pre_completed: ShieldCheck,
  skipped_by_override: ShieldCheck,
  not_started: Circle,
};

const projectStatusClasses: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  released: "border-emerald-200 bg-emerald-50 text-emerald-800",
  on_hold: "border-amber-200 bg-amber-50 text-amber-900",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600",
};

function normalizeControlName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function formatStatusText(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Not set";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatBudget(project: ControlDesignProject) {
  const record = project.control_record;
  if (!record || record.budget_amount === null || record.budget_amount === undefined) {
    return "Not set";
  }
  return `${record.budget_currency || DEFAULT_CURRENCY} ${Number(record.budget_amount).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function WorkflowStatusBadge({ status }: { status: ControlWorkflowStageStatus }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap px-2.5 py-1 text-[11px]", stageStatusClasses[status])}>
      {stageStatusLabels[status]}
    </Badge>
  );
}

function ProjectStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap px-2.5 py-1 text-[11px]", projectStatusClasses[status] || projectStatusClasses.active)}>
      {formatStatusText(status)}
    </Badge>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" | "primary" }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn(
        "truncate text-sm font-semibold text-slate-900",
        tone === "danger" && "text-red-700",
        tone === "warning" && "text-amber-800",
        tone === "primary" && "text-blue-700",
      )}>
        {value}
      </p>
    </div>
  );
}

function ControlDesignProjectSummaryCard({
  project,
  display,
}: {
  project: ControlDesignProject;
  display: ControlDesignWorkflowDisplay;
}) {
  const projectCode = formatProjectNumber(project) || project.project_id;
  const assignedTo = formatEmployeeDisplay(display.assignedToId, display.assignedToName);
  const progressLabel = `${display.approvedCount} / ${display.totalRequired} Approved`;

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-4 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)] lg:items-center">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-900">
                {projectCode}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold leading-tight text-slate-950">{project.project_name || "Unnamed project"}</h2>
                <p className="mt-1 text-sm text-slate-600">{project.customer_name || "Customer not set"}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <span className="inline-flex min-w-0 items-center gap-2">
                <UserRound className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">{assignedTo}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-2">
                <GitBranch className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">{display.currentStageName}</span>
              </span>
            </div>
          </div>

          <div className="grid gap-4 border-slate-200 lg:grid-cols-2 lg:border-l lg:pl-6">
            <SummaryMetric label="Status" value={formatStatusText(display.workflowStatus)} tone="primary" />
            <SummaryMetric label="Progress" value={progressLabel} />
            <SummaryMetric label="Budget" value={formatBudget(project)} tone={project.control_record ? undefined : "warning"} />
            <SummaryMetric label="Owner" value={assignedTo} />
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.project_status} />
            {!display.workflowAvailable ? (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                Lifecycle Preview
              </Badge>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-3 sm:min-w-[280px]">
            <Progress value={display.percent} className="h-2 bg-slate-100" />
            <span className="w-10 text-right text-xs font-semibold text-slate-600">{display.percent}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ControlDesignLifecycleStageCard({ stage, isLast }: { stage: ControlDesignDisplayStage; isLast: boolean }) {
  const Icon = stageIcons[stage.status];

  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)] gap-4">
      <div className="relative flex justify-center">
        {!isLast ? <span className="absolute top-11 h-[calc(100%+12px)] w-px bg-slate-200" aria-hidden="true" /> : null}
        <span className={cn(
          "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
          stageNodeClasses[stage.status],
        )}>
          <Icon className="h-5 w-5" />
        </span>
      </div>

      <div className={cn(
        "min-w-0 rounded-lg border bg-white p-4 transition-colors",
        stage.isCurrent ? "border-blue-200 bg-blue-50/40" : "border-slate-200",
        stage.locked && "bg-slate-50/70",
      )}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">{String(stage.order).padStart(2, "0")}</span>
              <h4 className={cn("text-base font-semibold text-slate-950", stage.locked && "text-slate-600")}>{stage.name}</h4>
              {stage.isCurrent ? (
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">Current</Badge>
              ) : null}
            </div>
            {stage.locked ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <LockKeyhole className="h-3.5 w-3.5" /> Locked until the previous stage is approved
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {stage.revisionCount > 0 ? (
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-800">
                Rev: {stage.revisionCount}
              </Badge>
            ) : null}
            <WorkflowStatusBadge status={stage.status} />
          </div>
        </div>
      </div>
    </li>
  );
}

function ControlDesignLifecycleTree({ stages }: { stages: ControlDesignDisplayStage[] }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
        <CardTitle className="text-lg font-semibold tracking-normal text-slate-950">Project Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2 md:p-6 md:pt-2">
        <ol className="space-y-3">
          {stages.map((stage, index) => (
            <ControlDesignLifecycleStageCard key={stage.id} stage={stage} isLast={index === stages.length - 1} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ProjectList({
  projects,
  selectedProjectId,
  onSelectProject,
}: {
  projects: ControlDesignProject[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-lg font-semibold tracking-normal text-slate-950">Control Design</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        {projects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">No Control Design projects available.</p>
        ) : projects.map((project) => {
          const active = project.project_id === selectedProjectId;
          return (
            <button
              type="button"
              key={project.project_id}
              onClick={() => onSelectProject(project.project_id)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <span className="block truncate text-sm font-semibold text-slate-950">{project.project_name || "Unnamed project"}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">{formatProjectNumber(project) || project.project_id}</span>
              <span className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="truncate">{project.customer_name || "Customer not set"}</span>
                <span className="shrink-0">{project.workflow ? "Assigned" : "Unassigned"}</span>
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ReadOnlyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} readOnly className="bg-slate-50 text-slate-700" />
    </div>
  );
}

export function ControlDesignDashboardWorkspace() {
  const queryClient = useQueryClient();
  const { user, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState(DEFAULT_CURRENCY);
  const [assignedUserId, setAssignedUserId] = useState("");

  const canAssignProjects = access.canAssignControlDesignProjects
    || hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_ASSIGN_PROJECTS)
    || hasUserPermission(user, PERMISSIONS.ASSIGN_TASK);
  const canReassignProjects = access.canReassignControlDesignProjects
    || hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_REASSIGN_PROJECTS)
    || canAssignProjects;

  const projectsQuery = useQuery({
    queryKey: ["control-design", "projects"],
    queryFn: fetchControlDesignProjects,
    enabled: Boolean(user?.employee_id),
    staleTime: 60_000,
  });

  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((project) => project.project_id === selectedProjectId) || null;

  useEffect(() => {
    if (projects.length === 0) {
      if (selectedProjectId) {
        setSelectedProjectId("");
      }
      return;
    }

    if (!selectedProjectId || !projects.some((project) => project.project_id === selectedProjectId)) {
      setSelectedProjectId(projects[0].project_id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProject) {
      setBudgetAmount("");
      setBudgetCurrency(DEFAULT_CURRENCY);
      setAssignedUserId("");
      return;
    }

    setBudgetAmount(
      selectedProject.control_record?.budget_amount === null || selectedProject.control_record?.budget_amount === undefined
        ? ""
        : String(selectedProject.control_record.budget_amount),
    );
    setBudgetCurrency(selectedProject.control_record?.budget_currency || DEFAULT_CURRENCY);
    setAssignedUserId(selectedProject.workflow?.assigned_user_id || "");
  }, [
    selectedProject?.project_id,
    selectedProject?.control_record?.budget_amount,
    selectedProject?.control_record?.budget_currency,
    selectedProject?.workflow?.assigned_user_id,
  ]);

  const controlSubDepartmentsQuery = useQuery({
    queryKey: ["control-workflow", "sub-departments"],
    queryFn: fetchControlSubDepartments,
    enabled: Boolean(user?.employee_id),
    staleTime: 5 * 60_000,
  });

  const controlDesignSubDepartment = useMemo(() => (
    (controlSubDepartmentsQuery.data ?? []).find(
      (subDepartment) => normalizeControlName(subDepartment.subdivision_name) === normalizeControlName(CONTROL_DESIGN_NAME),
    ) || null
  ), [controlSubDepartmentsQuery.data]);

  const templateQuery = useQuery({
    queryKey: ["control-workflow", "template", controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlWorkflowTemplate(controlDesignSubDepartment?.id || ""),
    enabled: Boolean(controlDesignSubDepartment?.id),
    staleTime: 5 * 60_000,
  });

  const workflowQuery = useQuery({
    queryKey: ["control-workflow", "project", selectedProject?.project_id || "none", controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlProjectWorkflow(selectedProject?.project_id || "", controlDesignSubDepartment?.id || ""),
    enabled: Boolean(selectedProject?.project_id && controlDesignSubDepartment?.id),
    staleTime: 60_000,
  });

  const assigneesQuery = useQuery({
    queryKey: ["control-design", "assignees"],
    queryFn: fetchControlDesignAssignableUsers,
    enabled: Boolean(user?.employee_id && canAssignProjects),
    staleTime: 60_000,
  });

  const createCoMutation = useMutation({
    mutationFn: () => createControlDesignCo({
      project_id: selectedProject?.project_id || "",
      budget_amount: budgetAmount,
      budget_currency: budgetCurrency,
    }),
    onSuccess: async () => {
      toast({ title: "CO saved" });
      await queryClient.invalidateQueries({ queryKey: ["control-design", "projects"] });
    },
    onError: (error) => {
      toast({
        title: "CO save failed",
        description: error instanceof Error ? error.message : "Unable to save CO.",
        variant: "destructive",
      });
    },
  });

  const assignmentMutation = useMutation({
    mutationFn: () => assignControlDesignProjectOwner(selectedProject?.project_id || "", assignedUserId),
    onSuccess: async () => {
      toast({ title: "Control Design project assigned" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["control-design", "projects"] }),
        queryClient.invalidateQueries({ queryKey: ["control-workflow", "project"] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Assignment failed",
        description: error instanceof Error ? error.message : "Unable to assign project.",
        variant: "destructive",
      });
    },
  });

  const display = useMemo(() => {
    if (!selectedProject) {
      return null;
    }

    return buildControlDesignWorkflowDisplay({
      project: selectedProject,
      workflow: workflowQuery.data || null,
      template: templateQuery.data || null,
    });
  }, [selectedProject, templateQuery.data, workflowQuery.data]);

  const loading = projectsQuery.isLoading
    || controlSubDepartmentsQuery.isLoading
    || (Boolean(controlDesignSubDepartment?.id) && (templateQuery.isLoading || workflowQuery.isLoading));
  const selectedProjectCode = selectedProject ? formatProjectNumber(selectedProject) || selectedProject.project_id : "";
  const selectedOwner = selectedProject?.workflow?.assigned_user_id || "";
  const assignmentDisabled = !selectedProject
    || !assignedUserId
    || assignmentMutation.isPending
    || (Boolean(selectedOwner) && !canReassignProjects);

  return (
    <main className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Control Design</h1>
          <p className="text-sm text-slate-600">{user?.name || user?.employee_id || "Signed-in user"}</p>
        </div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ProjectList projects={projects} selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} />

        {!selectedProject || !display ? (
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="flex min-h-[220px] items-center justify-center p-6 text-sm text-slate-500">
              {projectsQuery.isLoading ? "Loading Control Design projects" : "No project selected"}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <ControlDesignProjectSummaryCard project={selectedProject} display={display} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <ControlDesignLifecycleTree stages={display.stages} />

              <div className="space-y-4">
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-lg font-semibold tracking-normal text-slate-950">CO Creation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 p-4 pt-2">
                    <ReadOnlyField id="control-design-project-id" label="Project ID" value={selectedProjectCode} />
                    <ReadOnlyField id="control-design-project-name" label="Project Name" value={selectedProject.project_name || ""} />
                    <ReadOnlyField id="control-design-customer" label="Customer" value={selectedProject.customer_name || ""} />

                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_104px]">
                      <div className="space-y-2">
                        <Label htmlFor="control-design-budget-amount">Budget Amount</Label>
                        <Input
                          id="control-design-budget-amount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={budgetAmount}
                          onChange={(event) => setBudgetAmount(event.target.value)}
                          disabled={!canAssignProjects || createCoMutation.isPending}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="control-design-budget-currency">Budget Currency</Label>
                        <Input
                          id="control-design-budget-currency"
                          value={budgetCurrency}
                          maxLength={3}
                          onChange={(event) => setBudgetCurrency(event.target.value.toUpperCase())}
                          disabled={!canAssignProjects || createCoMutation.isPending}
                        />
                      </div>
                    </div>

                    {canAssignProjects ? (
                      <Button
                        type="button"
                        className="w-full"
                        onClick={() => createCoMutation.mutate()}
                        disabled={!selectedProject || !budgetAmount || createCoMutation.isPending}
                      >
                        {createCoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Create CO
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>

                {canAssignProjects ? (
                  <Card className="border-slate-200 bg-white shadow-sm">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-lg font-semibold tracking-normal text-slate-950">Ownership</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 p-4 pt-2">
                      <div className="space-y-2">
                        <Label htmlFor="control-design-owner">Owner</Label>
                        <Select value={assignedUserId || "__none__"} onValueChange={(value) => setAssignedUserId(value === "__none__" ? "" : value)}>
                          <SelectTrigger id="control-design-owner">
                            <SelectValue placeholder="Select owner" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select owner</SelectItem>
                            {(assigneesQuery.data ?? []).map((assignee) => (
                              <SelectItem key={assignee.employee_id} value={assignee.employee_id}>
                                {formatEmployeeDisplay(assignee.employee_id, assignee.name)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        type="button"
                        className="w-full"
                        onClick={() => assignmentMutation.mutate()}
                        disabled={assignmentDisabled}
                      >
                        {assignmentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                        Assign Control Design Project
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}