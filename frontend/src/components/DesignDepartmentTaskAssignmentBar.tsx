import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Plus,
  Search,
  Shield,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
  XCircle,
} from "lucide-react";
import {
  approveFixtureStage,
  assignFixtureStage,
  createDesignTask,
  fetchDesignFixtures,
  fetchDesignProjects,
  fetchDesignScopes,
  fetchFixtureCurrentStage,
  fetchFixtureFullProgress,
  rejectFixtureStage,
  validateFixtureAssignment,
  type FixtureCurrentStage,
  type FixtureFullProgress,
  type FixtureStageStatus,
} from "@/api/designApi";
import { useAssignableUsersQuery } from "@/hooks/queries/useAssignableUsersQuery";
import { useCurrentUserQuery } from "@/hooks/queries/useCurrentUserQuery";
import { toast } from "@/hooks/use-toast";
import {
  adminQueryKeys,
  analyticsQueryKeys,
  notificationQueryKeys,
  projectQueryKeys,
  taskQueryKeys,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { hasUserPermission, PERMISSIONS } from "@/lib/permissions";

const priorityOptions = [
  { value: "P1", label: "P1 — Critical" },
  { value: "P2", label: "P2 — High" },
  { value: "P3", label: "P3 — Medium" },
] as const;

const priorityValueMap = {
  P1: "critical",
  P2: "high",
  P3: "medium",
} as const;

type DesignPriority = keyof typeof priorityValueMap;

const STATUS_CONFIG: Record<FixtureStageStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: {
    label: "Pending",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <Clock className="h-3 w-3" />,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: <ChevronRight className="h-3 w-3" />,
  },
  COMPLETED: {
    label: "Completed",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    icon: <Clock className="h-3 w-3" />,
  },
  APPROVED: {
    label: "Approved",
    color: "bg-green-100 text-green-700 border-green-200",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  REJECTED: {
    label: "Rejected",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: <XCircle className="h-3 w-3" />,
  },
};

function formatStageTimestamp(value: string | null | undefined) {
  if (!value) {
    return "TBD";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "TBD";
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStageDuration(minutes: number | null | undefined) {
  if (!Number.isFinite(minutes) || !minutes || minutes <= 0) {
    return "";
  }

  const safeMinutes = Math.round(minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}h ${remainder}m`;
}

function StageStatusBadge({ status }: { status: FixtureStageStatus }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg.color}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function WorkflowTimeline({ progress }: { progress?: FixtureFullProgress }) {
  if (!progress) return null;

  return (
    <div className="rounded-xl border bg-gradient-to-r from-muted/30 to-muted/10 p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {progress.workflow_name} — Stage Progress
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        {progress.stages.map((stage, idx) => (
          <div key={stage.stage_name} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[10px] font-medium text-foreground">{stage.stage_name}</span>
              <StageStatusBadge status={stage.status} />
              <span className="max-w-[128px] text-center text-[9px] leading-tight text-muted-foreground">
                {stage.assigned_at || stage.completed_at
                  ? `${formatStageTimestamp(stage.assigned_at)} -> ${formatStageTimestamp(stage.completed_at)}`
                  : "Not started"}
              </span>
              {stage.duration_minutes ? (
                <span className="text-[9px] font-medium text-muted-foreground">
                  {formatStageDuration(stage.duration_minutes)}
                </span>
              ) : null}
            </div>
            {idx < progress.stages.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SupervisorPanel({
  fixtureId,
  currentStatus,
  onAction,
}: {
  fixtureId: string;
  currentStatus: FixtureStageStatus;
  onAction: () => void;
}) {
  const queryClient = useQueryClient();

  const approveMutation = useMutation({
    mutationFn: () => approveFixtureStage({ fixture_id: fixtureId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow", "current-stage", fixtureId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", "progress", fixtureId] });
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot });
      toast({ title: "Stage approved", description: "The fixture has advanced to the next stage." });
      onAction();
    },
    onError: (err) => {
      toast({
        title: "Approval failed",
        description: err instanceof Error ? err.message : "Failed to approve stage",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectFixtureStage({ fixture_id: fixtureId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow", "current-stage", fixtureId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", "progress", fixtureId] });
      toast({ title: "Stage rejected", description: "The stage has been sent back for rework." });
      onAction();
    },
    onError: (err) => {
      toast({
        title: "Rejection failed",
        description: err instanceof Error ? err.message : "Failed to reject stage",
        variant: "destructive",
      });
    },
  });

  if (currentStatus !== "COMPLETED") return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-600" />
          <div>
            <p className="text-xs font-semibold text-amber-800">Supervisor Verification Required</p>
            <p className="text-[10px] text-amber-600">This stage is completed and awaiting your review.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs"
            onClick={() => rejectMutation.mutate()}
            disabled={rejectMutation.isPending || approveMutation.isPending}
          >
            <ThumbsDown className="mr-1 h-3 w-3" />
            Reject
          </Button>
          <Button
            size="sm"
            className="h-7 bg-green-600 text-white hover:bg-green-700 text-xs"
            onClick={() => approveMutation.mutate()}
            disabled={rejectMutation.isPending || approveMutation.isPending}
          >
            <ThumbsUp className="mr-1 h-3 w-3" />
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DesignDepartmentTaskAssignmentBar() {
  const queryClient = useQueryClient();
  const assignableUsersQuery = useAssignableUsersQuery();
  const currentUserQuery = useCurrentUserQuery();
  const currentUser = currentUserQuery.data;
  const designDepartmentKey = currentUser?.department_id || "self";

  const projectsQuery = useQuery({
    queryKey: projectQueryKeys.designProjects(designDepartmentKey),
    queryFn: () => fetchDesignProjects(currentUser?.department_id),
  });

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [fixtureId, setFixtureId] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<DesignPriority>("P2");
  const [deadline, setDeadline] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [workflow, setWorkflow] = useState<FixtureCurrentStage | null>(null);
  const [workflowErrorMessage, setWorkflowErrorMessage] = useState<string | null>(null);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(false);
  const [workflowRequestVersion, setWorkflowRequestVersion] = useState(0);

  const resetWorkflowState = () => {
    setWorkflow(null);
    setWorkflowErrorMessage(null);
    setIsWorkflowLoading(false);
  };

  const refreshWorkflowState = () => {
    setWorkflowRequestVersion((value) => value + 1);
  };

  const scopesQuery = useQuery({
    queryKey: projectQueryKeys.designScopes(projectId || "unselected", designDepartmentKey),
    queryFn: () => fetchDesignScopes(projectId, currentUser?.department_id),
    enabled: Boolean(projectId),
  });

  const fixturesQuery = useQuery({
    queryKey: ["designFixtures", designDepartmentKey, scopeId || "unselected"],
    queryFn: () => fetchDesignFixtures(scopeId, currentUser?.department_id),
    enabled: Boolean(scopeId),
  });

  useEffect(() => {
    if (!fixtureId) {
      resetWorkflowState();
      return;
    }

    let isActive = true;
    setIsWorkflowLoading(true);
    setWorkflowErrorMessage(null);

    fetchFixtureCurrentStage(fixtureId)
      .then((resolvedWorkflow) => {
        if (!isActive) {
          return;
        }
        console.log("Workflow API response:", resolvedWorkflow);
        setWorkflow(resolvedWorkflow);
        setWorkflowErrorMessage(resolvedWorkflow ? null : "No workflow configured for this department");
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }
        console.error("Workflow fetch failed:", error);
        setWorkflow(null);
        setWorkflowErrorMessage(
          error instanceof Error && error.message
            ? error.message
            : "No workflow configured for this department",
        );
      })
      .finally(() => {
        if (isActive) {
          setIsWorkflowLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [fixtureId, workflowRequestVersion]);

  useEffect(() => {
    console.log("workflow state:", workflow);
  }, [workflow]);

  const validationQuery = useQuery({
    queryKey: ["workflow", "validate", fixtureId],
    queryFn: () => validateFixtureAssignment(fixtureId),
    enabled: Boolean(fixtureId) && !isWorkflowLoading && workflow !== null,
    refetchInterval: Boolean(fixtureId) && workflow !== null ? 5000 : false,
  });

  const progressQuery = useQuery({
    queryKey: ["workflow", "progress", fixtureId],
    queryFn: () => fetchFixtureFullProgress(fixtureId),
    enabled: Boolean(fixtureId) && !isWorkflowLoading && workflow !== null,
    refetchInterval: Boolean(fixtureId) && workflow !== null ? 5000 : false,
  });

  const assignableUsers = assignableUsersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const scopes = scopesQuery.data ?? [];
  const fixtures = fixturesQuery.data ?? [];

  const canVerify = hasUserPermission(currentUser, PERMISSIONS.VERIFY_TASK)
    || hasUserPermission(currentUser, PERMISSIONS.APPROVE_QUALITY);

  const validation = validationQuery.data;
  const currentStage = workflow;
  const hasWorkflow = workflow !== null;
  const resolvedStageName = currentStage?.is_complete ? null : currentStage?.stage || null;
  const blockingReason = hasWorkflow ? validation?.reason ?? null : null;
  const isReassignmentBlocked = blockingReason === "Stage already assigned";
  const visibleBlockingReason = blockingReason === "Stage already assigned" ? null : blockingReason;
  const canAssign = hasWorkflow && (validation?.canAssign ?? false);
  const canSubmitAssignment = canAssign || isReassignmentBlocked;
  const workflowProgress = progressQuery.data;
  const reviewStage = workflowProgress?.stages
    ? [...workflowProgress.stages].reverse().find((stage) => stage.status === "COMPLETED") || null
    : null;

  const filteredUsers = useMemo(
    () =>
      assignableUsers.filter(
        (user) =>
          user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.employee_id.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [assignableUsers, searchQuery],
  );

  const selectedUser = assignableUsers.find((u) => u.employee_id === assignedTo);
  const selectedProject = projects.find((p) => p.project_id === projectId);
  const selectedScope = scopes.find((s) => s.scope_id === scopeId);
  const selectedFixture = fixtures.find((f) => f.fixture_id === fixtureId);

  const createTaskMutation = useMutation({
    mutationFn: createDesignTask,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
        queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["workflow", "current-stage", fixtureId] }),
        queryClient.invalidateQueries({ queryKey: ["workflow", "validate", fixtureId] }),
        queryClient.invalidateQueries({ queryKey: ["workflow", "progress", fixtureId] }),
      ]);

      setProjectId("");
      setScopeId("");
      setFixtureId("");
      resetWorkflowState();
      setDescription("");
      setAssignedTo("");
      setPriority("P2");
      setDeadline("");
      setSearchQuery("");
      setOpen(false);

      toast({
        title: "Design task assigned",
        description: "The task has been created with the selected project, scope, and fixture.",
      });
    },
    onError: (error) => {
      toast({
        title: "Task not assigned",
        description: error instanceof Error ? error.message : "Failed to assign design task",
        variant: "destructive",
      });
    },
  });

  const assignStageMutation = useMutation({
    mutationFn: () =>
      assignFixtureStage({ fixture_id: fixtureId, assigned_to: assignedTo }),
    onSuccess: () => {
      refreshWorkflowState();
      queryClient.invalidateQueries({ queryKey: ["workflow", "current-stage", fixtureId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", "validate", fixtureId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", "progress", fixtureId] });
      createTaskMutation.mutate({
        project_id: projectId,
        scope_id: scopeId,
        fixture_id: fixtureId,
        description,
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        priority: priorityValueMap[priority],
        deadline: new Date(deadline).toISOString(),
      });
    },
    onError: (error) => {
      toast({
        title: "Assignment blocked",
        description: error instanceof Error ? error.message : "Could not assign stage",
        variant: "destructive",
      });
    },
  });

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setScopeId("");
    setFixtureId("");
    resetWorkflowState();
  };

  const handleScopeChange = (value: string) => {
    setScopeId(value);
    setFixtureId("");
    resetWorkflowState();
  };

  const handleFixtureChange = (value: string) => {
    setFixtureId(value);
    setAssignedTo("");
    setWorkflow(null);
    setWorkflowErrorMessage(null);
    setIsWorkflowLoading(Boolean(value));
  };

  const handleSubmit = () => {
    if (!projectId || !scopeId || !fixtureId || !assignedTo || !deadline) return;
    if (!canSubmitAssignment) return;
    assignStageMutation.mutate();
  };

  const isSubmitting = assignStageMutation.isPending || createTaskMutation.isPending;

  const projectPlaceholder = projectsQuery.isLoading
    ? "Loading projects..."
    : projectsQuery.isError
      ? "Projects unavailable"
      : projects.length > 0
        ? "Select project"
        : "No projects available";

  const scopePlaceholder = !projectId
    ? "Select project first"
    : scopesQuery.isLoading
      ? "Loading scopes..."
      : scopes.length > 0
        ? "Select scope"
        : "No scopes available";

  const fixturePlaceholder = !scopeId
    ? "Select scope first"
    : fixturesQuery.isLoading
      ? "Loading fixtures..."
      : fixtures.length > 0
        ? "Select fixture"
        : "No fixtures (all completed)";

  return (
    <Card className="animate-fade-in border-primary/20 bg-background/50 backdrop-blur-sm shadow-md transition-all">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2 border-b">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
            <Sparkles className="h-4 w-4" />
            Design Task Assignment
          </h3>
          <p className="mt-1 text-xs text-muted-foreground font-medium">
            Deploy deterministic tasks based on validated fixture ingestion.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full border-primary/20 hover:bg-primary/10"
          onClick={() => setOpen((c) => !c)}
        >
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 p-4 pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Project *</Label>
              <Select value={projectId} onValueChange={handleProjectChange}>
                <SelectTrigger className="h-9 text-sm" disabled={projectsQuery.isLoading || projects.length === 0}>
                  <SelectValue placeholder={projectPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.project_id} value={project.project_id}>
                      {project.project_code} · {project.project_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Scope *</Label>
              <Select value={scopeId} onValueChange={handleScopeChange}>
                <SelectTrigger className="h-9 text-sm" disabled={!projectId || scopesQuery.isLoading || scopes.length === 0}>
                  <SelectValue placeholder={scopePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((scope) => (
                    <SelectItem key={scope.scope_id} value={scope.scope_id}>
                      {scope.scope_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Fixture *</Label>
              <Select value={fixtureId} onValueChange={handleFixtureChange}>
                <SelectTrigger
                  className="h-9 text-sm border-primary/40 focus:border-primary"
                  disabled={!scopeId || fixturesQuery.isLoading || fixtures.length === 0}
                >
                  <SelectValue placeholder={fixturePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {fixtures.map((fixture) => (
                    <SelectItem key={fixture.fixture_id} value={fixture.fixture_id}>
                      {fixture.fixture_no} — {fixture.part_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Priority *</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as DesignPriority)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(selectedProject || selectedScope || selectedFixture) && (
            <div className="grid gap-3 rounded-xl border bg-gradient-to-r from-muted/50 to-muted/20 p-4 text-xs md:grid-cols-4 shadow-inner">
              <div className="md:col-span-1">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">Project</p>
                <p className="mt-1 font-medium text-foreground truncate">
                  {selectedProject ? selectedProject.project_code : "—"}
                </p>
                <p className="text-muted-foreground truncate">{selectedScope ? selectedScope.scope_name : "—"}</p>
              </div>
              <div className="md:col-span-3 border-l pl-4">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold mb-2">
                  Fixture Details (Read-only)
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground">PART NAME</div>
                    <div className="font-semibold">{selectedFixture?.part_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">OP.NO</div>
                    <div className="font-semibold">{selectedFixture?.op_no || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">TYPE</div>
                    <div className="font-semibold">{selectedFixture?.fixture_type || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">QTY</div>
                    <div className="font-semibold text-primary">{selectedFixture?.qty || "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!projectsQuery.isLoading && projects.length === 0 && (
            <div className="rounded-xl border-2 border-dashed p-4 text-sm text-center text-muted-foreground bg-muted/10">
              {projectsQuery.isError
                ? projectsQuery.error instanceof Error
                  ? projectsQuery.error.message
                  : "Projects are unavailable for the current department."
                : "Upload project data first using the Excel ingestion system."}
            </div>
          )}

          {fixtureId && (
            <div className="space-y-3">
              <div className="workflow-stage flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workflow Stage (Auto)</p>
                    {isWorkflowLoading ? (
                      <span className="mt-0.5 inline-block text-xs text-muted-foreground">Loading workflow...</span>
                    ) : workflow ? (
                      workflow.is_complete ? (
                        <span className="mt-0.5 inline-block text-xs font-semibold text-green-600">Current Stage: Completed</span>
                      ) : (
                        <span className="mt-0.5 inline-block text-sm font-semibold text-foreground">
                          Current Stage: {resolvedStageName || "Not available"}
                        </span>
                      )
                    ) : (
                      <span className="mt-0.5 inline-block text-xs font-medium text-red-600">
                        {workflowErrorMessage || "No workflow configured for this department"}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  {workflow && !workflow.is_complete && (
                    <StageStatusBadge status={workflow.status as FixtureStageStatus} />
                  )}
                  {workflow?.is_complete && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Complete
                    </span>
                  )}
                </div>
              </div>

              {!isWorkflowLoading && hasWorkflow && <WorkflowTimeline progress={workflowProgress} />}

              {hasWorkflow && !validationQuery.isLoading && visibleBlockingReason && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
                  <p className="text-xs font-medium text-destructive">{visibleBlockingReason}</p>
                </div>
              )}

              {canVerify && hasWorkflow && reviewStage && (
                <SupervisorPanel
                  fixtureId={fixtureId}
                  currentStatus={reviewStage.status}
                  onAction={() => {
                    refreshWorkflowState();
                    queryClient.invalidateQueries({ queryKey: ["designFixtures", designDepartmentKey, scopeId] });
                  }}
                />
              )}
            </div>
          )}

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Deadline *</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Assign To *</Label>
              <Popover open={showSearch} onOpenChange={setShowSearch}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-9 w-full justify-start text-sm font-normal">
                    <Search className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {selectedUser ? `${selectedUser.name} (${selectedUser.employee_id})` : "Search employee..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="start">
                  <Input
                    placeholder="Search by name or ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mb-2 h-8 text-sm"
                  />
                  <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {filteredUsers.map((user) => (
                      <button
                        key={user.employee_id}
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-primary/10"
                        onClick={() => {
                          setAssignedTo(user.employee_id);
                          setShowSearch(false);
                          setSearchQuery("");
                        }}
                      >
                        <span className="font-medium">{user.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{user.employee_id}</span>
                      </button>
                    ))}
                    {filteredUsers.length === 0 && (
                      <p className="py-2 text-center text-xs text-muted-foreground">No matches</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Task Description (Optional)</Label>
            <Textarea
              placeholder="Add execution notes for the design team..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t mt-4">
            {fixtureId && !canSubmitAssignment && !validationQuery.isLoading && visibleBlockingReason && (
              <p className="text-center text-xs text-muted-foreground">
                Fix the issue above before deploying.
              </p>
            )}
            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                className="h-10 px-6 text-sm font-semibold shadow-sm hover:translate-y-[-1px] transition-all"
                disabled={
                  !projectId ||
                  !scopeId ||
                  !fixtureId ||
                  !assignedTo ||
                  !deadline ||
                  !hasWorkflow ||
                  isWorkflowLoading ||
                  !canSubmitAssignment ||
                  isSubmitting
                }
              >
                <Plus className="mr-2 h-4 w-4 text-white" />
                {isSubmitting ? "Deploying..." : "Deploy Design Task"}
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
