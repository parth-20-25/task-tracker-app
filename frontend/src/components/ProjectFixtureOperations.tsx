import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Image as ImageIcon,
  Loader2,
  User,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import {
  assignFixtureStage,
  createDesignTask,
  fetchFixtureFullProgress,
  reopenFixtureStage,
  validateFixtureAssignment,
  type FixtureFullProgress,
  type FixtureRevisionType,
} from "@/api/designApi";
import { API_ROOT_URL } from "@/api/config";
import { fetchVerificationTasks, transferTask, updateTask } from "@/api/taskApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { useTasks } from "@/contexts/useTasks";
import { useAssignableUsersQuery } from "@/hooks/queries/useAssignableUsersQuery";
import { toast } from "@/hooks/use-toast";
import { analyticsQueryKeys, batchQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import type { DesignFixtureOption, Priority, Task } from "@/types";

const OPEN_TASK_STATUSES = new Set(["assigned", "in_progress", "on_hold", "under_review", "rework"]);

const priorityOptions: Array<{ value: Priority; label: string }> = [
  { value: "critical", label: "P1 - Critical" },
  { value: "high", label: "P2 - High" },
  { value: "medium", label: "P3 - Medium" },
  { value: "low", label: "P4 - Low" },
];

const revisionReasonOptions: Array<{ value: FixtureRevisionType; label: string }> = [
  { value: "CUSTOMER_CHANGE", label: "Customer Change" },
  { value: "CUSTOMER_TRIAL_CHANGE", label: "Customer Trial Change" },
  { value: "CUSTOMER_REVISION", label: "Customer Revision" },
  { value: "INTERNAL_DESIGN_CHANGE", label: "Internal Design Change" },
  { value: "MANUFACTURING_ISSUE", label: "Manufacturing Issue" },
  { value: "QUALITY_CORRECTION", label: "Quality Correction" },
  { value: "COST_OPTIMIZATION", label: "Cost Optimization" },
  { value: "APPROVAL_REJECTION", label: "Approval Rejection" },
  { value: "PROCUREMENT_CONSTRAINT", label: "Procurement Constraint" },
  { value: "MANUAL_OVERRIDE", label: "Manual Override" },
  { value: "OTHER", label: "Other" },
];

function toProofUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_ROOT_URL}${path}`;
}

function compactWorkflowCode(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/\s+/g, "") : null;
}

function getFixtureWorkflowCode(fixture: DesignFixtureOption) {
  return compactWorkflowCode(fixture.workflow_revision_code);
}

function getStageWorkflowCode(stage: FixtureFullProgress["stages"][number] | null | undefined) {
  return compactWorkflowCode(stage?.revision_code)
    || (stage ? `Stage${stage.stage_order}` : "Workflow");
}

function fixtureStageStatusLabel(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case "IN_PROGRESS":
      return "In Progress";
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "COMPLETED":
      return "Completed";
    default:
      return status || "Pending";
  }
}

function fixtureStageStatusColor(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case "IN_PROGRESS":
      return "border-sky-300 bg-sky-50 text-sky-800";
    case "PENDING":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "APPROVED":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "REJECTED":
      return "border-red-300 bg-red-50 text-red-800";
    case "COMPLETED":
      return "border-violet-300 bg-violet-50 text-violet-800";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700";
  }
}

function formatSubmittedDate(value: string | null | undefined) {
  if (!value) {
    return "Not submitted";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not submitted";
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeTaskStage(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function getTaskScore(task: Task, fixture: DesignFixtureOption) {
  let score = 0;

  if (task.status === "under_review") {
    score += 100;
  } else if (OPEN_TASK_STATUSES.has(task.status)) {
    score += 80;
  } else if (task.status === "closed") {
    score += 20;
  }

  if (normalizeTaskStage(task.workflow_stage) === normalizeTaskStage(fixture.workflow_stage)) {
    score += 20;
  }

  return score;
}

function pickFixtureTask(fixture: DesignFixtureOption, tasks: Task[]) {
  const candidates = tasks
    .filter((task) => task.fixture_id === fixture.fixture_id)
    .sort((left, right) => {
      const scoreDelta = getTaskScore(right, fixture) - getTaskScore(left, fixture);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

  return candidates[0] || null;
}

function getProofImage(task: Task | null) {
  const proofUrls = task?.proof_url ?? [];
  return proofUrls.length > 0 ? proofUrls[proofUrls.length - 1] : null;
}

function getAssigneeName(fixture: DesignFixtureOption, task: Task | null) {
  return task?.assignee?.name
    || task?.assigned_to
    || fixture.workflow_assigned_to_name
    || fixture.workflow_assigned_to
    || "Unassigned";
}

function getSubmittedValue(task: Task | null) {
  return task?.submitted_at || task?.completed_at || null;
}

interface ProjectFixtureOperationsGridProps {
  fixtures: DesignFixtureOption[];
  projectId: string;
  departmentId?: string | null;
}

export function ProjectFixtureOperationsGrid({
  fixtures,
  projectId,
  departmentId,
}: ProjectFixtureOperationsGridProps) {
  const { access, user } = useAuth();
  const { tasks, refreshTasks } = useTasks();
  const queryClient = useQueryClient();
  const assignableUsersQuery = useAssignableUsersQuery();

  const verificationQuery = useQuery({
    queryKey: taskQueryKeys.verificationQueue,
    queryFn: fetchVerificationTasks,
    enabled: Boolean(user?.employee_id && access.canViewVerifications),
  });

  const combinedTasks = useMemo(() => {
    const fixtureIds = new Set(fixtures.map((fixture) => fixture.fixture_id));
    const taskById = new Map<number, Task>();

    [...tasks, ...(verificationQuery.data ?? [])].forEach((task) => {
      if (task.fixture_id && fixtureIds.has(task.fixture_id)) {
        taskById.set(task.id, task);
      }
    });

    return [...taskById.values()];
  }, [fixtures, tasks, verificationQuery.data]);

  const invalidateOperationalState = useCallback(async () => {
    await Promise.all([
      refreshTasks(),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.verificationQueue }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures", projectId, departmentId || undefined] }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
      queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["workflow"] }),
    ]);
  }, [departmentId, projectId, queryClient, refreshTasks]);

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {fixtures.map((fixture) => (
        <ProjectFixtureCard
          key={fixture.fixture_id}
          fixture={fixture}
          task={pickFixtureTask(fixture, combinedTasks)}
          projectId={projectId}
          departmentId={departmentId || undefined}
          assignableUsers={assignableUsersQuery.data ?? []}
          isLoadingUsers={assignableUsersQuery.isLoading}
          invalidateOperationalState={invalidateOperationalState}
        />
      ))}
    </div>
  );
}

interface ProjectFixtureCardProps {
  fixture: DesignFixtureOption;
  task: Task | null;
  projectId: string;
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
}

function ProjectFixtureCard({
  fixture,
  task,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
}: ProjectFixtureCardProps) {
  const { access } = useAuth();
  const [expanded, setExpanded] = useState<"assign" | "transfer" | null>(null);
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [workflowTarget, setWorkflowTarget] = useState("");
  const [reasonType, setReasonType] = useState<FixtureRevisionType | "">("");
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const canDeployDesignTask = access.canAssignTasks && access.canCreateTasks && access.canChangeFixtureStage;
  const completedPercent = Math.max(0, Math.min(100, Number(task?.completion_percent ?? 0)));
  const remainingPercent = Math.max(0, 100 - completedPercent);
  const canTransferTask = Boolean(
    task
    && remainingPercent > 0
    && (access.canTransferTasks || access.canAssignTasks)
    && !["closed", "cancelled", "under_review"].includes(task.status),
  );
  const canReviewTask = Boolean(
    task
    && task.status === "under_review"
    && (task.verification_status === "quality_pending" ? access.canApproveQuality : access.canApproveCompletedTasks || access.canApproveQuality),
  );

  const progressQuery = useQuery({
    queryKey: ["workflow", "progress", departmentId || "self", fixture.fixture_id],
    queryFn: () => fetchFixtureFullProgress(fixture.fixture_id, departmentId),
    enabled: expanded === "assign",
  });

  const validationQuery = useQuery({
    queryKey: ["workflow", "validate", departmentId || "self", fixture.fixture_id],
    queryFn: () => validateFixtureAssignment(fixture.fixture_id, departmentId),
    enabled: expanded === "assign",
  });

  const progress = progressQuery.data;
  const currentProgressStage = useMemo(() => {
    if (!progress?.stages) {
      return null;
    }

    return progress.stages.find((stage) => stage.status !== "APPROVED") || null;
  }, [progress]);

  const workflowOptions = useMemo(() => {
    if (!progress?.stages) {
      return [];
    }

    return progress.stages
      .filter((stage) => stage.status === "APPROVED" || stage.stage_name === currentProgressStage?.stage_name)
      .sort((left, right) => Number(left.stage_order) - Number(right.stage_order));
  }, [currentProgressStage?.stage_name, progress]);

  useEffect(() => {
    if (expanded !== "assign" || workflowTarget || !currentProgressStage?.stage_name) {
      return;
    }

    setWorkflowTarget(currentProgressStage.stage_name);
  }, [currentProgressStage?.stage_name, expanded, workflowTarget]);

  const selectedWorkflowStage = workflowOptions.find((stage) => stage.stage_name === workflowTarget) || null;
  const workflowChanged = Boolean(workflowTarget && workflowTarget !== currentProgressStage?.stage_name);
  const canAssignCurrent = validationQuery.data?.canAssign === true;
  const assignmentBlockedReason = validationQuery.data?.reason || null;
  const workflowChangeAllowed = workflowChanged && selectedWorkflowStage?.status === "APPROVED";
  const canSubmitAssignment = workflowChanged ? workflowChangeAllowed : canAssignCurrent;

  const proofImage = getProofImage(task);
  const isSubmittedForVerification = task?.status === "under_review";
  const isAssigned = Boolean(task && OPEN_TASK_STATUSES.has(task.status)) || Boolean(fixture.workflow_assigned_to);
  const workflowCode = getFixtureWorkflowCode(fixture);
  const operationalStatus = isSubmittedForVerification
    ? "Completed"
    : isAssigned
      ? "In Progress"
      : fixtureStageStatusLabel(fixture.workflow_status || "PENDING");

  const resetAssignForm = () => {
    setAssignedTo("");
    setDeadline("");
    setPriority("high");
    setWorkflowTarget("");
    setReasonType("");
  };

  const resetTransferForm = () => {
    setTransferTo("");
    setTransferReason("");
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!assignedTo || !deadline) {
        throw new Error("Assignee and deadline are required");
      }

      if (workflowChanged) {
        if (!reasonType) {
          throw new Error("Reason Type is required when workflow is changed");
        }

        await reopenFixtureStage({
          fixture_id: fixture.fixture_id,
          department_id: departmentId,
          target_stage_name: workflowTarget,
          revision_type: reasonType,
        });
      }

      await assignFixtureStage({
        fixture_id: fixture.fixture_id,
        assigned_to: assignedTo,
        department_id: departmentId,
      });

      await createDesignTask({
        department_id: departmentId,
        project_id: projectId,
        fixture_id: fixture.fixture_id,
        description: fixture.part_name || fixture.fixture_no,
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        priority,
        deadline: new Date(deadline).toISOString(),
      });
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      resetAssignForm();
      setExpanded(null);
      toast({ title: "Fixture assigned", description: "The existing workflow assignment was created for this fixture." });
    },
    onError: (error) => {
      toast({
        title: "Assignment failed",
        description: error instanceof Error ? error.message : "Could not assign fixture",
        variant: "destructive",
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!task) {
        throw new Error("No active task is available for transfer");
      }

      if (!transferTo) {
        throw new Error("Transfer employee is required");
      }

      await transferTask(task.id, {
        transfer_to: transferTo,
        transfer_reason: transferReason.trim() || "Inline fixture transfer",
        completion_percent: completedPercent,
      });
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      resetTransferForm();
      setExpanded(null);
      toast({ title: "Fixture transferred", description: `Remaining ${remainingPercent}% was transferred.` });
    },
    onError: (error) => {
      toast({
        title: "Transfer failed",
        description: error instanceof Error ? error.message : "Could not transfer fixture",
        variant: "destructive",
      });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ reviewTask, action, remarks }: { reviewTask: Task; action: "approve" | "reject"; remarks?: string }) => {
      await updateTask(reviewTask.id, {
        verification_action: action,
        remarks,
      });
    },
    onSuccess: async (_, variables) => {
      await invalidateOperationalState();
      setRejectingTask(null);
      setRejectionReason("");
      toast({
        title: variables.action === "approve" ? "Fixture approved" : "Fixture rejected",
        description: variables.action === "approve"
          ? "The existing verification flow advanced the workflow."
          : "The existing rejection flow preserved the workflow history.",
      });
    },
    onError: (error) => {
      toast({
        title: "Review failed",
        description: error instanceof Error ? error.message : "Could not review fixture",
        variant: "destructive",
      });
    },
  });

  const assignmentDisabled = !canDeployDesignTask
    || !assignedTo
    || !deadline
    || !workflowTarget
    || progressQuery.isLoading
    || validationQuery.isLoading
    || !canSubmitAssignment
    || (workflowChanged && !reasonType)
    || assignMutation.isPending;

  const transferDisabled = !task
    || !transferTo
    || remainingPercent <= 0
    || transferMutation.isPending;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
            <p className="text-xs text-muted-foreground">{fixture.part_name}</p>
          </div>

          {isSubmittedForVerification && canReviewTask ? (
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                disabled={reviewMutation.isPending}
                onClick={() => {
                  if (task) {
                    reviewMutation.mutate({ reviewTask: task, action: "approve" });
                  }
                }}
              >
                APPROVE
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 px-2 text-[11px]"
                disabled={reviewMutation.isPending}
                onClick={() => {
                  setRejectingTask(task);
                  setRejectionReason("");
                }}
              >
                REJECT
              </Button>
            </div>
          ) : isAssigned && canTransferTask ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setExpanded(expanded === "transfer" ? null : "transfer");
                resetAssignForm();
              }}
            >
              <ArrowRightLeft className="mr-1 h-3 w-3" />
              Transfer
            </Button>
          ) : !isAssigned && canDeployDesignTask ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setExpanded(expanded === "assign" ? null : "assign");
                resetTransferForm();
              }}
            >
              Assign Now
            </Button>
          ) : null}
        </div>

        {isAssigned && !isSubmittedForVerification ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {getAssigneeName(fixture, task)}
            </span>
            {task ? (
              <div className="flex items-center gap-2">
                <Progress value={completedPercent} className="h-1.5 w-16" />
                <span className="font-semibold text-foreground">{completedPercent}%</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {isSubmittedForVerification ? (
          <div className="space-y-2">
            {proofImage ? (
              <button
                type="button"
                className="block h-24 w-32 overflow-hidden rounded-md border bg-slate-50"
                onClick={() => setPreviewImage(toProofUrl(proofImage))}
              >
                <img src={toProofUrl(proofImage)} alt={`${fixture.fixture_no} proof`} className="h-full w-full object-cover" />
              </button>
            ) : (
              <div className="flex h-20 w-28 items-center justify-center rounded-md border border-dashed bg-slate-50 text-slate-400">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {workflowCode ? (
            <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-xs font-semibold text-indigo-800">
              {workflowCode}
            </Badge>
          ) : null}
          <Badge variant="outline" className={cn("text-xs font-medium", fixtureStageStatusColor(isSubmittedForVerification ? "COMPLETED" : fixture.workflow_status))}>
            {operationalStatus}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "gap-0.5 text-xs font-medium",
              isAssigned
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-300 bg-slate-50 text-slate-500",
            )}
          >
            {isAssigned ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
            {isAssigned ? getAssigneeName(fixture, task) : "Unassigned"}
          </Badge>
        </div>

        {isAssigned ? (
          <p className="text-xs text-muted-foreground">
            Submitted: {formatSubmittedDate(getSubmittedValue(task))}
          </p>
        ) : null}
      </div>

      {expanded === "assign" ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div>
            <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
            <p className="text-xs text-muted-foreground">{fixture.part_name}</p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Assignee</Label>
              <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
                <SelectTrigger className="h-9 text-xs" disabled={isLoadingUsers || assignMutation.isPending}>
                  <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Assignee"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Assignee</SelectItem>
                  {assignableUsers.map((employee) => (
                    <SelectItem key={employee.employee_id} value={employee.employee_id}>
                      {employee.name} ({employee.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Deadline</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="h-9 text-xs"
                disabled={assignMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger className="h-9 text-xs" disabled={assignMutation.isPending}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Workflow</Label>
            <Select
              value={workflowTarget || "__none__"}
              onValueChange={(value) => {
                setWorkflowTarget(value === "__none__" ? "" : value);
                setReasonType("");
              }}
              disabled={progressQuery.isLoading || assignMutation.isPending}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={progressQuery.isLoading ? "Loading workflow..." : "Workflow"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Workflow</SelectItem>
                {workflowOptions.map((stage) => (
                  <SelectItem key={`${stage.stage_name}-${stage.stage_version}`} value={stage.stage_name}>
                    {getStageWorkflowCode(stage)} - {fixtureStageStatusLabel(stage.status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {workflowChanged ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Reason Type</Label>
              <Select value={reasonType || "__none__"} onValueChange={(value) => setReasonType(value === "__none__" ? "" : value as FixtureRevisionType)}>
                <SelectTrigger className="h-9 text-xs" disabled={assignMutation.isPending}>
                  <SelectValue placeholder="Reason Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Reason Type</SelectItem>
                  {revisionReasonOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!workflowChangeAllowed ? (
                <p className="text-xs text-amber-700">Workflow changes can only reopen an approved stage.</p>
              ) : null}
            </div>
          ) : null}

          {!workflowChanged && assignmentBlockedReason ? (
            <p className="text-xs text-red-600">{assignmentBlockedReason}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetAssignForm();
                setExpanded(null);
              }}
              disabled={assignMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => assignMutation.mutate()}
              disabled={assignmentDisabled}
            >
              {assignMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Assign
            </Button>
          </div>
        </div>
      ) : null}

      {expanded === "transfer" ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="grid gap-2 text-xs md:grid-cols-[auto_1fr] md:items-center">
            <div className="font-medium">Transfer {remainingPercent}% To</div>
            <Select value={transferTo || "__none__"} onValueChange={(value) => setTransferTo(value === "__none__" ? "" : value)}>
              <SelectTrigger className="h-9 text-xs" disabled={isLoadingUsers || transferMutation.isPending}>
                <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Employee"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Employee</SelectItem>
                {assignableUsers
                  .filter((employee) => employee.employee_id !== task?.assigned_to)
                  .map((employee) => (
                    <SelectItem key={employee.employee_id} value={employee.employee_id}>
                      {employee.name} ({employee.employee_id})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              value={transferReason}
              onChange={(event) => setTransferReason(event.target.value)}
              rows={2}
              className="text-xs"
              disabled={transferMutation.isPending}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetTransferForm();
                setExpanded(null);
              }}
              disabled={transferMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => transferMutation.mutate()} disabled={transferDisabled}>
              {transferMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />}
              Transfer
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fixture.fixture_no} Work Image</DialogTitle>
          </DialogHeader>
          {previewImage ? (
            <img src={previewImage} alt={`${fixture.fixture_no} proof preview`} className="max-h-[70vh] w-full rounded-md object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => {
        if (!open) {
          setRejectingTask(null);
          setRejectionReason("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Fixture Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Rejection reason"
              rows={4}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRejectingTask(null);
                  setRejectionReason("");
                }}
                disabled={reviewMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!rejectionReason.trim() || reviewMutation.isPending || !rejectingTask}
                onClick={() => {
                  if (rejectingTask && rejectionReason.trim()) {
                    reviewMutation.mutate({
                      reviewTask: rejectingTask,
                      action: "reject",
                      remarks: rejectionReason.trim(),
                    });
                  }
                }}
              >
                {reviewMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
