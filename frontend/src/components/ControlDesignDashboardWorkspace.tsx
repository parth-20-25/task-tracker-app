import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  FilePenLine,
  FolderOpen,
  GitBranch,
  Loader2,
  LockKeyhole,
  PauseCircle,
  Plus,
  ShieldCheck,
  UserCheck,
  UserRound,
} from "lucide-react";
import {
  assignControlDesignProjectOwner,
  createControlDesignProject,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

const emptyCreateForm = {
  project_id: "",
  project_name: "",
  customer: "",
  budget: "",
};

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
  const amount = project.control_record?.budget_amount;
  if (amount === null || amount === undefined) {
    return "Not set";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function projectOptionLabel(project: ControlDesignProject) {
  const code = formatProjectNumber(project) || project.project_id;
  return `${code} - ${project.project_name || "Unnamed project"}`;
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
  const assignedTo = display.assignedToId ? formatEmployeeDisplay(display.assignedToId, display.assignedToName) : "Unassigned";
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
            <SummaryMetric label="Project ID" value={projectCode} />
            <SummaryMetric label="Budget (INR)" value={formatBudget(project)} tone={project.control_record ? undefined : "warning"} />
            <SummaryMetric label="Assigned To" value={assignedTo} />
            <SummaryMetric label="Current Stage" value={display.currentStageName} />
            <SummaryMetric label="Project Status" value={formatStatusText(project.project_status)} tone="primary" />
            <SummaryMetric label="Progress" value={progressLabel} />
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <ProjectStatusBadge status={project.project_status} />
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

function ProjectSelector({
  projects,
  selectedProjectId,
  canCreateProjects,
  onSelectProject,
  onNewProject,
}: {
  projects: ControlDesignProject[];
  selectedProjectId: string;
  canCreateProjects: boolean;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="control-design-project-selector">Project</Label>
            <Select value={selectedProjectId || "__none__"} onValueChange={(value) => onSelectProject(value === "__none__" ? "" : value)}>
              <SelectTrigger id="control-design-project-selector" className="h-10">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select a project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.project_id} value={project.project_id}>
                    {projectOptionLabel(project)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canCreateProjects ? (
            <Button type="button" onClick={onNewProject} className="sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs font-medium text-red-700">{message}</p> : null;
}

function NewProjectDialog({
  open,
  form,
  errors,
  pending,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  form: typeof emptyCreateForm;
  errors: Partial<Record<keyof typeof emptyCreateForm | "submit", string>>;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (field: keyof typeof emptyCreateForm, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Control Design Project</DialogTitle>
          <DialogDescription className="sr-only">Create a Control Design project.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="control-project-id">Project ID</Label>
            <Input id="control-project-id" value={form.project_id} onChange={(event) => onChange("project_id", event.target.value)} disabled={pending} />
            <FieldError message={errors.project_id} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-project-name">Project Name</Label>
            <Input id="control-project-name" value={form.project_name} onChange={(event) => onChange("project_name", event.target.value)} disabled={pending} />
            <FieldError message={errors.project_name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-project-customer">Customer</Label>
            <Input id="control-project-customer" value={form.customer} onChange={(event) => onChange("customer", event.target.value)} disabled={pending} />
            <FieldError message={errors.customer} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-project-budget">Budget (INR)</Label>
            <Input id="control-project-budget" inputMode="decimal" value={form.budget} onChange={(event) => onChange("budget", event.target.value)} disabled={pending} />
            <FieldError message={errors.budget} />
          </div>
          <FieldError message={errors.submit} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function validateCreateForm(form: typeof emptyCreateForm) {
  const errors: Partial<Record<keyof typeof emptyCreateForm, string>> = {};
  const budget = form.budget.trim();

  if (!form.project_id.trim()) errors.project_id = "Project ID is required.";
  if (!form.project_name.trim()) errors.project_name = "Project Name is required.";
  if (!form.customer.trim()) errors.customer = "Customer is required.";
  if (!budget) {
    errors.budget = "Budget is required.";
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(budget)) {
    errors.budget = "Budget must be a non-negative decimal amount.";
  }

  return errors;
}

export function ControlDesignDashboardWorkspace() {
  const queryClient = useQueryClient();
  const { user, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createErrors, setCreateErrors] = useState<Partial<Record<keyof typeof emptyCreateForm | "submit", string>>>({});

  const canCreateProjects = access.canCreateControlDesignProjects
    || hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_CREATE_PROJECTS);
  const canAssignProjects = access.canAssignControlDesignProjects
    || hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_ASSIGN_PROJECTS);
  const canReassignProjects = access.canReassignControlDesignProjects
    || hasUserPermission(user, PERMISSIONS.CONTROL_DESIGN_REASSIGN_PROJECTS)
    || canAssignProjects;

  const projectsQuery = useQuery({
    queryKey: ["control-design", "projects"],
    queryFn: fetchControlDesignProjects,
    enabled: Boolean(user?.employee_id),
    staleTime: 60_000,
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const selectedProject = projects.find((project) => project.project_id === selectedProjectId) || null;

  useEffect(() => {
    if (projects.length === 0) {
      if (selectedProjectId) setSelectedProjectId("");
      return;
    }

    if (!selectedProjectId || !projects.some((project) => project.project_id === selectedProjectId)) {
      setSelectedProjectId(projects[0].project_id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    setAssignedUserId(selectedProject?.workflow?.assigned_user_id || "");
  }, [selectedProject?.project_id, selectedProject?.workflow?.assigned_user_id]);

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

  const createProjectMutation = useMutation({
    mutationFn: () => createControlDesignProject({
      project_id: createForm.project_id.trim(),
      project_name: createForm.project_name.trim(),
      customer: createForm.customer.trim(),
      budget: createForm.budget.trim(),
    }),
    onSuccess: async (project) => {
      queryClient.setQueryData<ControlDesignProject[]>(["control-design", "projects"], (current = []) => {
        const withoutDuplicate = current.filter((item) => item.project_id !== project.project_id);
        return [project, ...withoutDuplicate];
      });
      setSelectedProjectId(project.project_id);
      setCreateForm(emptyCreateForm);
      setCreateErrors({});
      setCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["control-design", "projects"] }),
        queryClient.invalidateQueries({ queryKey: ["control-workflow", "project"] }),
      ]);
      toast({ title: "Control Design project created" });
    },
    onError: (error) => {
      setCreateErrors((current) => ({
        ...current,
        submit: error instanceof Error ? error.message : "Unable to create project.",
      }));
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
    if (!selectedProject) return null;

    return buildControlDesignWorkflowDisplay({
      project: selectedProject,
      workflow: workflowQuery.data || null,
      template: templateQuery.data || null,
    });
  }, [selectedProject, templateQuery.data, workflowQuery.data]);

  const handleCreateFormChange = (field: keyof typeof emptyCreateForm, value: string) => {
    setCreateForm((current) => ({ ...current, [field]: value }));
    setCreateErrors((current) => ({ ...current, [field]: undefined, submit: undefined }));
  };

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateCreateForm(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;
    createProjectMutation.mutate();
  };

  const loading = projectsQuery.isLoading
    || controlSubDepartmentsQuery.isLoading
    || (Boolean(controlDesignSubDepartment?.id) && templateQuery.isLoading);
  const selectedOwner = workflowQuery.data?.assigned_user_id || selectedProject?.workflow?.assigned_user_id || "";
  const assignmentDisabled = !selectedProject
    || !assignedUserId
    || assignmentMutation.isPending
    || (Boolean(selectedOwner) && !canReassignProjects);
  const emptyMessage = canCreateProjects
    ? "No Control Design projects have been created yet."
    : "No Control Design projects are currently assigned to you.";

  return (
    <main className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Control Design</h1>
          <p className="text-sm text-slate-600">{user?.name || user?.employee_id || "Signed-in user"}</p>
        </div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : null}
      </div>

      <ProjectSelector
        projects={projects}
        selectedProjectId={selectedProjectId}
        canCreateProjects={canCreateProjects}
        onSelectProject={setSelectedProjectId}
        onNewProject={() => setCreateOpen(true)}
      />

      {projectsQuery.isError ? (
        <Card className="border-red-200 bg-red-50 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center text-sm text-red-800">
            <AlertTriangle className="h-5 w-5" />
            <p>Unable to load Control Design projects.</p>
            <Button type="button" variant="outline" onClick={() => projectsQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : projects.length === 0 && !projectsQuery.isLoading ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
            <FolderOpen className="h-10 w-10 opacity-30" />
            <p>{emptyMessage}</p>
            {canCreateProjects ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New Project
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : !selectedProject || !display ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-[220px] items-center justify-center p-6 text-sm text-slate-500">
            {projectsQuery.isLoading ? "Loading Control Design projects" : "Select a project to view its Control Design lifecycle."}
          </CardContent>
        </Card>
      ) : workflowQuery.isError ? (
        <Card className="border-red-200 bg-red-50 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center text-sm text-red-800">
            <AlertTriangle className="h-5 w-5" />
            <p>Unable to load the selected project lifecycle.</p>
            <Button type="button" variant="outline" onClick={() => workflowQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <ControlDesignProjectSummaryCard project={selectedProject} display={display} />

          <div className={cn("grid gap-4", canAssignProjects && "xl:grid-cols-[minmax(0,1fr)_360px]")}>
            <ControlDesignLifecycleTree stages={display.stages} />

            {canAssignProjects ? (
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-lg font-semibold tracking-normal text-slate-950">Ownership</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="control-design-owner">Assigned To</Label>
                    <Select value={assignedUserId || "__none__"} onValueChange={(value) => setAssignedUserId(value === "__none__" ? "" : value)}>
                      <SelectTrigger id="control-design-owner">
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select owner</SelectItem>
                        {(assigneesQuery.data ?? []).map((assignee) => (
                          <SelectItem key={assignee.employee_id} value={assignee.employee_id}>
                            {formatEmployeeDisplay(assignee)}
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
      )}

      <NewProjectDialog
        open={createOpen}
        form={createForm}
        errors={createErrors}
        pending={createProjectMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !createProjectMutation.isPending) {
            setCreateOpen(false);
            setCreateErrors({});
            return;
          }
          setCreateOpen(open);
        }}
        onChange={handleCreateFormChange}
        onSubmit={handleCreateProject}
      />
    </main>
  );
}