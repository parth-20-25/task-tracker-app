import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FolderOpen,
  GitBranch,
  Loader2,
  LockKeyhole,
  Plus,
  UserRound,
} from "lucide-react";
import {
  createControlDesignProject,
  fetchControlDesignAssignableUsers,
  fetchControlDesignCapabilities,
  fetchControlDesignProjects,
  fetchControlDesignSummary,
  fetchControlProjectWorkflow,
  fetchControlSubDepartments,
  fetchControlWorkflowTemplate,
  type ControlDesignCapabilities,
  type ControlDesignProject,
  type ControlDesignSummary,
} from "@/api/controlWorkflowApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatAssigneeOption, formatEmployeeDisplay } from "@/lib/employeeDisplay";
import {
  buildControlDesignWorkflowDisplay,
  type ControlDesignWorkflowDisplay,
} from "@/lib/controlDesignWorkflowDisplay";
import { CONTROL_DEPARTMENT_THEME } from "@/lib/controlDepartmentTheme";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { cn } from "@/lib/utils";
import { ControlWorkflowSection } from "@/components/ControlWorkflowSection";
import type { User } from "@/types";

const CONTROL_DESIGN_NAME = "Control Design";

const EMPTY_CONTROL_DESIGN_CAPABILITIES: ControlDesignCapabilities = {
  canViewWorkspace: false,
  canViewAssignedProjects: false,
  canViewAllProjects: false,
  canCreateProject: false,
  canEditProject: false,
  canAssignProject: false,
  canReassignProject: false,
  canCancelProject: false,
  canStartStage: false,
  canSubmitStage: false,
  canUpdatePath: false,
  canViewProof: false,
  canUploadProof: false,
  canReview: false,
  canApprove: false,
  canRequestChanges: false,
  canRaiseRevision: false,
  canExecuteRevision: false,
  canReviewRevision: false,
  canMarkPreCompleted: false,
  canOverrideUnlock: false,
  canSkipStage: false,
  canMarkDispatched: false,
  canReopenAfterDispatch: false,
  canViewAudit: false,
  canViewReports: false,
};


const emptyCreateForm = {
  project_id: "",
  project_name: "",
  customer: "",
  budget: "",
  assigned_user_id: "",
  priority: "",
  planned_start_date: "",
  target_completion_date: "",
  project_root_path: "",
  notes: "",
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
  return `${code} \u2014 ${project.project_name || "Unnamed project"}`;
}
type LifecycleFilter = "total" | "active" | "pending" | "updates" | "completed";

const lifecycleMetrics: Array<{ key: LifecycleFilter; label: string; icon: LucideIcon; tone: string }> = [
  { key: "total", label: "Total Projects", icon: FolderOpen, tone: "text-blue-700" },
  { key: "active", label: "Active Projects", icon: GitBranch, tone: "text-blue-700" },
  { key: "pending", label: "Pending Approval", icon: Clock3, tone: "text-amber-700" },
  { key: "updates", label: "Updates Required", icon: AlertTriangle, tone: "text-orange-700" },
  { key: "completed", label: "Completed Projects", icon: CheckCircle2, tone: "text-emerald-700" },
];

function matchesLifecycleFilter(project: ControlDesignProject, filter: LifecycleFilter | null) {
  const summary = project.lifecycle_summary;
  if (!filter || filter === "total") return true;
  if (filter === "active") return summary?.completed !== true && !["cancelled", "completed", "dispatched"].includes(project.project_status);
  if (filter === "pending") return Number(summary?.pending_approval_count || 0) > 0;
  if (filter === "updates") return Number(summary?.updates_required_count || 0) > 0;
  return summary?.completed === true;
}

function LifecycleSummaryCards({
  projects,
  summary,
  activeFilter,
  onFilter,
}: {
  projects: ControlDesignProject[];
  summary?: ControlDesignSummary | null;
  activeFilter: LifecycleFilter | null;
  onFilter: (filter: LifecycleFilter | null) => void;
}) {
  const values: Record<LifecycleFilter, number> = summary ?? {
    total: projects.length,
    active: projects.filter((project) => matchesLifecycleFilter(project, "active")).length,
    pending: projects.filter((project) => matchesLifecycleFilter(project, "pending")).length,
    updates: projects.filter((project) => matchesLifecycleFilter(project, "updates")).length,
    completed: projects.filter((project) => matchesLifecycleFilter(project, "completed")).length,
  };

  return (
    <section aria-label="Control Design lifecycle summary" className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {lifecycleMetrics.map(({ key, label, icon: Icon, tone }) => {
          const selected = activeFilter === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              className={cn(
                "min-h-[76px] rounded-lg border bg-white p-3 text-left shadow-sm transition hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                selected && CONTROL_DEPARTMENT_THEME.selectedCard,
              )}
              onClick={() => onFilter(selected ? null : key)}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-600">{label}</span>
                <Icon className={cn("h-5 w-5", tone)} />
              </span>
              <span className={cn("mt-1 block text-2xl font-semibold", tone)}>{values[key]}</span>
            </button>
          );
        })}
      </div>
      {activeFilter ? (
        <Button type="button" variant="ghost" size="sm" className="text-blue-800" onClick={() => onFilter(null)}>
          Clear lifecycle filter
        </Button>
      ) : null}
    </section>
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
      <CardContent className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)] lg:items-center">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-900">
                {projectCode}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold leading-tight text-slate-950">{project.project_name || "Unnamed project"}</h2>
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

          <div className="grid gap-3 border-slate-200 sm:grid-cols-2 lg:border-l lg:pl-4">
            <SummaryMetric label="Project ID" value={projectCode} />
            <SummaryMetric label="Budget (INR)" value={formatBudget(project)} tone={project.control_record ? undefined : "warning"} />
            <SummaryMetric label="Assigned To" value={assignedTo} />
            <SummaryMetric label="Current Stage" value={display.currentStageName} />
            <SummaryMetric label="Project Status" value={formatStatusText(project.project_status)} tone="primary" />
            <SummaryMetric label="Progress" value={progressLabel} />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
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


function ProjectSelector({
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
  assignees,
  pending,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  form: typeof emptyCreateForm;
  errors: Partial<Record<keyof typeof emptyCreateForm | "submit", string>>;
  assignees: User[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (field: keyof typeof emptyCreateForm, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
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
          <div className="space-y-2">
            <Label htmlFor="control-project-assignee">Assigned Control Design member</Label>
            <Select value={form.assigned_user_id || "__none__"} onValueChange={(value) => onChange("assigned_user_id", value === "__none__" ? "" : value)} disabled={pending}>
              <SelectTrigger id="control-project-assignee">
                <SelectValue placeholder="Select a member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select a member</SelectItem>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee.employee_id} value={assignee.employee_id}>{formatAssigneeOption(assignee)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.assigned_user_id} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="control-project-priority">Priority</Label>
              <Select value={form.priority || "__none__"} onValueChange={(value) => onChange("priority", value === "__none__" ? "" : value)} disabled={pending}>
                <SelectTrigger id="control-project-priority"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  {['low', 'medium', 'high', 'urgent'].map((priority) => <SelectItem key={priority} value={priority}>{formatStatusText(priority)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="control-project-root">Project root path</Label>
              <Input id="control-project-root" value={form.project_root_path} onChange={(event) => onChange("project_root_path", event.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="control-project-start">Planned start date</Label>
              <Input id="control-project-start" type="date" value={form.planned_start_date} onChange={(event) => onChange("planned_start_date", event.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="control-project-target">Target completion date</Label>
              <Input id="control-project-target" type="date" value={form.target_completion_date} onChange={(event) => onChange("target_completion_date", event.target.value)} disabled={pending} />
              <FieldError message={errors.target_completion_date} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-project-notes">Notes</Label>
            <Textarea id="control-project-notes" value={form.notes} onChange={(event) => onChange("notes", event.target.value)} disabled={pending} rows={2} />
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
  if (!form.assigned_user_id.trim()) errors.assigned_user_id = "Assigned Control Design member is required.";
  if (form.planned_start_date && form.target_completion_date && form.target_completion_date < form.planned_start_date) {
    errors.target_completion_date = "Target completion date cannot be before the planned start date.";
  }
  if (!budget) {
    errors.budget = "Budget is required.";
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(budget)) {
    errors.budget = "Budget must be a non-negative decimal amount.";
  }

  return errors;
}

function createProjectErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Server error";
  }

  const status = "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 409) return "Duplicate Project ID";
  if (status === 403) return "Permission denied";
  if (status === 400 && /budget/i.test(error.message)) return "Invalid budget";
  if (status === 400) return "Missing required field";
  if (status >= 500) return "Server error";
  return error.message || "Server error";
}

export function ControlDesignDashboardWorkspace() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeFilter, setActiveFilter] = useState<LifecycleFilter | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createErrors, setCreateErrors] = useState<Partial<Record<keyof typeof emptyCreateForm | "submit", string>>>({});

  const capabilitiesQuery = useQuery({
    queryKey: ["control-design", "capabilities"],
    queryFn: fetchControlDesignCapabilities,
    enabled: Boolean(user?.employee_id),
    staleTime: 60_000,
  });

  const capabilities = capabilitiesQuery.data ?? EMPTY_CONTROL_DESIGN_CAPABILITIES;
  const canViewWorkspace = capabilities.canViewWorkspace;
  const canCreateProjects = capabilities.canCreateProject;

  const projectsQuery = useQuery({
    queryKey: ["control-design", "projects"],
    queryFn: fetchControlDesignProjects,
    enabled: Boolean(user?.employee_id && canViewWorkspace),
    staleTime: 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ["control-design", "summary"],
    queryFn: fetchControlDesignSummary,
    enabled: Boolean(user?.employee_id && canViewWorkspace),
    staleTime: 60_000,
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const filteredProjects = useMemo(() => projects.filter((project) => matchesLifecycleFilter(project, activeFilter)), [activeFilter, projects]);
  const selectedProject = filteredProjects.find((project) => project.project_id === selectedProjectId) || null;

  useEffect(() => {
    if (filteredProjects.length === 0) {
      if (selectedProjectId) setSelectedProjectId("");
      return;
    }
    if (!filteredProjects.some((project) => project.project_id === selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0].project_id);
    }
  }, [filteredProjects, selectedProjectId]);

  const controlSubDepartmentsQuery = useQuery({
    queryKey: ["control-workflow", "sub-departments"],
    queryFn: fetchControlSubDepartments,
    enabled: Boolean(user?.employee_id && canViewWorkspace),
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
    enabled: Boolean(canViewWorkspace && controlDesignSubDepartment?.id),
    staleTime: 5 * 60_000,
  });

  const workflowQuery = useQuery({
    queryKey: ["control-workflow", "project", selectedProject?.project_id || "none", controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlProjectWorkflow(selectedProject?.project_id || "", controlDesignSubDepartment?.id || ""),
    enabled: Boolean(canViewWorkspace && selectedProject?.project_id && controlDesignSubDepartment?.id),
    staleTime: 60_000,
  });

  const assigneesQuery = useQuery({
    queryKey: ["control-design", "assignees"],
    queryFn: fetchControlDesignAssignableUsers,
    enabled: Boolean(user?.employee_id && canCreateProjects),
    staleTime: 60_000,
  });

  const createProjectMutation = useMutation({
    mutationFn: () => createControlDesignProject({
      projectId: createForm.project_id.trim(),
      projectName: createForm.project_name.trim(),
      customer: createForm.customer.trim(),
      budget: createForm.budget.trim(),
      assignedUserId: createForm.assigned_user_id.trim(),
      priority: createForm.priority || undefined,
      plannedStartDate: createForm.planned_start_date || undefined,
      targetCompletionDate: createForm.target_completion_date || undefined,
      projectRootPath: createForm.project_root_path.trim() || undefined,
      notes: createForm.notes.trim() || undefined,
    }),
    onSuccess: async (project) => {
      queryClient.setQueryData<ControlDesignProject[]>(["control-design", "projects"], (current = []) => {
        const withoutDuplicate = current.filter((item) => item.project_id !== project.project_id);
        return [project, ...withoutDuplicate];
      });
      setSelectedProjectId(project.project_id);
      setActiveFilter(null);
      setCreateForm(emptyCreateForm);
      setCreateErrors({});
      setCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["control-design", "projects"] }),
        queryClient.invalidateQueries({ queryKey: ["control-design", "summary"] }),
        queryClient.invalidateQueries({ queryKey: ["control-workflow", "project"] }),
      ]);
      toast({ title: "Control Design project created" });
    },
    onError: (error) => {
      setCreateErrors((current) => ({
        ...current,
        submit: createProjectErrorMessage(error),
      }));
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

  const loading = capabilitiesQuery.isLoading
    || (canViewWorkspace && projectsQuery.isLoading)
    || (canViewWorkspace && controlSubDepartmentsQuery.isLoading)
    || (canViewWorkspace && Boolean(controlDesignSubDepartment?.id) && templateQuery.isLoading);
  const emptyMessage = "No Control Design projects are available in your current scope.";

  if (!capabilitiesQuery.isLoading && !canViewWorkspace) {
    return (
      <main className="space-y-4 p-4 md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Control Design</h1>
            <p className="text-sm text-slate-600">{user?.name || user?.employee_id || "Signed-in user"}</p>
          </div>
        </div>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
            <LockKeyhole className="h-10 w-10 opacity-30" />
            <p>You do not have Control Design workspace access.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className={cn("min-h-full space-y-4 p-4 md:p-6", CONTROL_DEPARTMENT_THEME.workspace)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={cn("text-2xl font-semibold tracking-normal", CONTROL_DEPARTMENT_THEME.heading)}>Welcome to Control Design</h1>
          <p className="text-sm text-slate-600">{user?.name || user?.employee_id || "Signed-in user"}</p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : null}
        </div>
      </div>

      <LifecycleSummaryCards projects={projects} summary={summaryQuery.data} activeFilter={activeFilter} onFilter={setActiveFilter} />

      <section className="space-y-3" aria-labelledby="control-design-projects-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="control-design-projects-heading" className={cn("text-xl font-semibold", CONTROL_DEPARTMENT_THEME.heading)}>Control Design Projects</h2>
          {canCreateProjects ? (
            <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Project
            </Button>
          ) : null}
        </div>
        <ProjectSelector
          projects={filteredProjects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />
      </section>

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
      ) : projects.length === 0 && !loading ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
            <FolderOpen className="h-10 w-10 opacity-30" />
            <p>{emptyMessage}</p>
            {canCreateProjects ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add New Project
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 && activeFilter ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
            <FolderOpen className="h-8 w-8 opacity-30" />
            <p>No projects match the selected lifecycle filter.</p>
            <Button type="button" variant="outline" onClick={() => setActiveFilter(null)}>Clear filter</Button>
          </CardContent>
        </Card>
      ) : !selectedProject || !display ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex min-h-[220px] items-center justify-center p-6 text-sm text-slate-500">
            {projectsQuery.isLoading ? "Loading Control Design projects" : "Select a Control Design project to view its lifecycle."}
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

          <ControlWorkflowSection key={selectedProject.project_id} project={selectedProject} capabilities={capabilities} />
        </div>
      )}

      <NewProjectDialog
        open={createOpen}
        form={createForm}
        errors={createErrors}
        assignees={assigneesQuery.data ?? []}
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