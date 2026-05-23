import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CalendarIcon,
  CheckSquare,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  User,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import {
  createDesignTask,
  fetchFixtureFullProgress,
  manipulateFixtureStage,
  reopenFixtureStage,
  validateFixtureAssignment,
  type FixtureFullProgress,
  type FixtureRevisionType,
} from "@/api/designApi";
import { API_ROOT_URL } from "@/api/config";
import { fetchVerificationTasks, transferTask, updateTask } from "@/api/taskApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

function getCurrentProgressStage(progress: FixtureFullProgress | null | undefined) {
  return progress?.stages?.find((stage) => stage.status !== "APPROVED") || null;
}

function getAssignableWorkflowOptions(progress: FixtureFullProgress | null | undefined) {
  if (!progress?.stages) {
    return [];
  }

  return progress.stages
    .sort((left, right) => Number(left.stage_order) - Number(right.stage_order));
}

function normalizeDeadlineToEndOfDayIso(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error("Deadline date is invalid");
  }

  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function formatDeadlineDate(dateValue: string) {
  if (!dateValue) {
    return "Deadline";
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) {
    return "Deadline";
  }

  return format(new Date(year, month - 1, day), "dd/MM/yyyy");
}

function isFixtureOperationallyAssigned(fixture: DesignFixtureOption, task: Task | null) {
  void task;
  return !["UNASSIGNED", "WORKFLOW_COMPLETE"].includes(String(fixture.operational_state || "UNASSIGNED"));
}

function fixtureStageStatusLabel(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case "IN_PROGRESS":
      return "In Progress";
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "VERIFICATION":
      return "Verification";
    case "REJECTED":
      return "Rejected";
    case "ASSIGNED":
      return "Assigned";
    case "WORKFLOW_COMPLETE":
      return "Workflow Complete";
    case "UNASSIGNED":
      return "Unassigned";
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
    case "WORKFLOW_COMPLETE":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "REJECTED":
      return "border-red-300 bg-red-50 text-red-800";
    case "VERIFICATION":
      return "border-violet-300 bg-violet-50 text-violet-800";
    case "UNASSIGNED":
      return "border-slate-300 bg-slate-50 text-slate-700";
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
  if (task?.latest_proof?.file_url) {
    return task.latest_proof.file_url;
  }
  return proofUrls.length > 0 ? proofUrls[proofUrls.length - 1] : null;
}

function getProofUploadedAt(task: Task | null) {
  return task?.latest_proof?.uploaded_at || null;
}

function getProofUploadedBy(task: Task | null) {
  return task?.latest_proof?.uploaded_by_name || task?.latest_proof?.uploaded_by || null;
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

const FIXTURE_SECTION_ORDER = [
  { key: "VERIFICATION", label: "Verification" },
  { key: "UNASSIGNED", label: "Unassigned" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "WORKFLOW_COMPLETE", label: "Workflow Complete" },
] as const;

function compareFixtureNo(left: DesignFixtureOption, right: DesignFixtureOption) {
  return String(left.fixture_no || "").localeCompare(String(right.fixture_no || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortSectionFixtures(
  state: string,
  fixtures: DesignFixtureOption[],
  fixtureTaskById: Map<string, Task | null>,
) {
  return [...fixtures].sort((left, right) => {
    const leftTask = fixtureTaskById.get(left.fixture_id) || null;
    const rightTask = fixtureTaskById.get(right.fixture_id) || null;

    if (state === "VERIFICATION") {
      return new Date(getSubmittedValue(leftTask) || 0).getTime() - new Date(getSubmittedValue(rightTask) || 0).getTime();
    }

    if (state === "IN_PROGRESS") {
      return Number(rightTask?.completion_percent || 0) - Number(leftTask?.completion_percent || 0) || compareFixtureNo(left, right);
    }

    if (state === "ASSIGNED") {
      return new Date(leftTask?.deadline || "9999-12-31").getTime() - new Date(rightTask?.deadline || "9999-12-31").getTime()
        || compareFixtureNo(left, right);
    }

    if (state === "WORKFLOW_COMPLETE") {
      return new Date(rightTask?.approved_at || rightTask?.closed_at || 0).getTime()
        - new Date(leftTask?.approved_at || leftTask?.closed_at || 0).getTime()
        || compareFixtureNo(left, right);
    }

    return compareFixtureNo(left, right);
  });
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
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    VERIFICATION: true,
    UNASSIGNED: true,
    IN_PROGRESS: true,
    ASSIGNED: true,
    WORKFLOW_COMPLETE: false,
  });

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

  const fixtureTaskById = useMemo(() => {
    const map = new Map<string, Task | null>();
    fixtures.forEach((fixture) => {
      map.set(fixture.fixture_id, pickFixtureTask(fixture, combinedTasks));
    });
    return map;
  }, [combinedTasks, fixtures]);

  const unassignedFixtures = useMemo(
    () => fixtures.filter((fixture) => String(fixture.operational_state || "UNASSIGNED") === "UNASSIGNED"),
    [fixtures],
  );
  const fixtureSections = useMemo(() => {
    const seen = new Set<string>();

    return FIXTURE_SECTION_ORDER.map((section) => {
      const sectionFixtures = fixtures.filter((fixture) => {
        if (seen.has(fixture.fixture_id)) {
          return false;
        }

        const matches = String(fixture.operational_state || "UNASSIGNED") === section.key;
        if (matches) {
          seen.add(fixture.fixture_id);
        }
        return matches;
      });

      return {
        ...section,
        fixtures: sortSectionFixtures(section.key, sectionFixtures, fixtureTaskById),
      };
    });
  }, [fixtureTaskById, fixtures]);

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

  const toggleSelectedFixture = useCallback((fixtureId: string, checked: boolean) => {
    setSelectedFixtureIds((current) => (
      checked
        ? Array.from(new Set([...current, fixtureId]))
        : current.filter((id) => id !== fixtureId)
    ));
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          variant={bulkPanelOpen ? "secondary" : "outline"}
          className="h-8 px-3 text-xs"
          onClick={() => setBulkPanelOpen((open) => !open)}
          disabled={!unassignedFixtures.length}
        >
          <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
          Assign All
        </Button>
      </div>

      {bulkPanelOpen ? (
        <BulkFixtureAssignmentPanel
          unassignedFixtures={unassignedFixtures}
          selectedFixtureIds={selectedFixtureIds}
          projectId={projectId}
          departmentId={departmentId || undefined}
          assignableUsers={assignableUsersQuery.data ?? []}
          isLoadingUsers={assignableUsersQuery.isLoading}
          invalidateOperationalState={invalidateOperationalState}
          onCancel={() => setBulkPanelOpen(false)}
        />
      ) : null}

      <div className="space-y-3">
        {fixtureSections.map((section) => (
          <Collapsible
            key={section.key}
            open={openSections[section.key] ?? true}
            onOpenChange={(open) => setOpenSections((current) => ({ ...current, [section.key]: open }))}
            className="rounded-lg border bg-background"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
              <span className="text-sm font-semibold">{section.label}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{section.fixtures.length}</Badge>
                <ChevronDown className={cn("h-4 w-4 transition-transform", openSections[section.key] ? "rotate-180" : "")} />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t p-3">
              {section.fixtures.length === 0 ? (
                <p className="text-xs text-muted-foreground">No fixtures in this section.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {section.fixtures.map((fixture) => (
                    <ProjectFixtureCard
                      key={fixture.fixture_id}
                      fixture={fixture}
                      task={fixtureTaskById.get(fixture.fixture_id) || null}
                      projectId={projectId}
                      departmentId={departmentId || undefined}
                      assignableUsers={assignableUsersQuery.data ?? []}
                      isLoadingUsers={assignableUsersQuery.isLoading}
                      invalidateOperationalState={invalidateOperationalState}
                      selectable={bulkPanelOpen && section.key === "UNASSIGNED"}
                      selected={selectedFixtureIds.includes(fixture.fixture_id)}
                      onSelectedChange={toggleSelectedFixture}
                    />
                  ))}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}

function DateOnlyDeadlinePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedDate = useMemo(() => {
    if (!value) {
      return undefined;
    }

    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) {
      return undefined;
    }

    return new Date(year, month - 1, day);
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-9 w-full justify-start px-3 text-left text-xs font-normal", !value && "text-muted-foreground")}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {formatDeadlineDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate || new Date()}
          onSelect={(date) => {
            if (date) {
              onChange(format(date, "yyyy-MM-dd"));
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

interface BulkFixtureAssignmentPanelProps {
  unassignedFixtures: DesignFixtureOption[];
  selectedFixtureIds: string[];
  projectId: string;
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  onCancel: () => void;
}

function BulkFixtureAssignmentPanel({
  unassignedFixtures,
  selectedFixtureIds,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
  onCancel,
}: BulkFixtureAssignmentPanelProps) {
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [workflowTarget, setWorkflowTarget] = useState("");
  const [reasonType, setReasonType] = useState<FixtureRevisionType | "">("");
  const [scope, setScope] = useState<"all_unassigned" | "selected">("all_unassigned");

  const targetFixtures = useMemo(() => {
    if (scope === "selected") {
      const selected = new Set(selectedFixtureIds);
      return unassignedFixtures.filter((fixture) => selected.has(fixture.fixture_id));
    }

    return unassignedFixtures;
  }, [scope, selectedFixtureIds, unassignedFixtures]);

  const progressQueries = useQueries({
    queries: targetFixtures.map((fixture) => ({
      queryKey: ["workflow", "progress", departmentId || "self", fixture.fixture_id],
      queryFn: () => fetchFixtureFullProgress(fixture.fixture_id, departmentId),
      enabled: targetFixtures.length > 0,
    })),
  });

  const progressByFixtureId = useMemo(() => {
    const map = new Map<string, FixtureFullProgress>();
    targetFixtures.forEach((fixture, index) => {
      const progress = progressQueries[index]?.data;
      if (progress) {
        map.set(fixture.fixture_id, progress);
      }
    });
    return map;
  }, [progressQueries, targetFixtures]);

  const referenceProgress = progressQueries.find((query) => query.data)?.data;
  const currentStage = getCurrentProgressStage(referenceProgress);
  const workflowOptions = getAssignableWorkflowOptions(referenceProgress);

  useEffect(() => {
    if (!workflowTarget && currentStage?.stage_name) {
      setWorkflowTarget(currentStage.stage_name);
    }
  }, [currentStage?.stage_name, workflowTarget]);

  const workflowChanged = targetFixtures.some((fixture) => {
    const fixtureCurrent = getCurrentProgressStage(progressByFixtureId.get(fixture.fixture_id));
    return Boolean(workflowTarget && fixtureCurrent?.stage_name && workflowTarget !== fixtureCurrent.stage_name);
  });
  const selectedWorkflowStage = workflowOptions.find((stage) => stage.stage_name === workflowTarget) || null;
  const workflowChangeAllowed = !workflowChanged || reasonType === "MANUAL_OVERRIDE" || selectedWorkflowStage?.status === "APPROVED";
  const progressLoading = progressQueries.some((query) => query.isLoading);
  const selectedScopeEmpty = scope === "selected" && targetFixtures.length === 0;

  const resetForm = () => {
    setAssignedTo("");
    setDeadline("");
    setPriority("high");
    setWorkflowTarget("");
    setReasonType("");
    setScope("all_unassigned");
  };

  const bulkAssignMutation = useMutation({
    mutationFn: async () => {
      if (!targetFixtures.length) {
        throw new Error(scope === "selected" ? "Select fixtures before assigning" : "No unassigned fixtures are available");
      }

      if (!assignedTo || !deadline || !workflowTarget) {
        throw new Error("Employee, deadline, priority, and workflow are required");
      }

      if (workflowChanged && !reasonType) {
        throw new Error("Reason Type is required when workflow is changed");
      }

      for (const fixture of targetFixtures) {
        const progress = progressByFixtureId.get(fixture.fixture_id) || await fetchFixtureFullProgress(fixture.fixture_id, departmentId);
        const fixtureCurrent = getCurrentProgressStage(progress);
        const fixtureWorkflowChanged = Boolean(workflowTarget && fixtureCurrent?.stage_name && workflowTarget !== fixtureCurrent.stage_name);

        if (fixtureWorkflowChanged) {
          if (reasonType === "MANUAL_OVERRIDE") {
            await manipulateFixtureStage({
              fixture_id: fixture.fixture_id,
              department_id: departmentId,
              target_stage_name: workflowTarget,
              target_status: "PENDING",
              reason_type: "MANUAL_OVERRIDE",
              revision_type: "MANUAL_OVERRIDE",
              revision_reason: "Manual override selected during assignment workflow change",
              remarks: "Manual override selected during assignment workflow change",
            });
          } else {
            await reopenFixtureStage({
              fixture_id: fixture.fixture_id,
              department_id: departmentId,
              target_stage_name: workflowTarget,
              revision_type: reasonType as FixtureRevisionType,
            });
          }
        }

        await createDesignTask({
          department_id: departmentId,
          project_id: projectId,
          fixture_id: fixture.fixture_id,
          description: fixture.part_name || fixture.fixture_no,
          assigned_to: assignedTo,
          assignee_ids: [assignedTo],
          priority,
          deadline: normalizeDeadlineToEndOfDayIso(deadline),
        });
      }
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      resetForm();
      onCancel();
      toast({ title: "Fixtures assigned", description: "Assign All reused the existing assignment flow for each fixture." });
    },
    onError: (error) => {
      toast({
        title: "Assign All failed",
        description: error instanceof Error ? error.message : "Could not assign fixtures",
        variant: "destructive",
      });
    },
  });

  const disabled = !assignedTo
    || !deadline
    || !workflowTarget
    || progressLoading
    || selectedScopeEmpty
    || !workflowChangeAllowed
    || (workflowChanged && !reasonType)
    || bulkAssignMutation.isPending;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="grid gap-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Employee</Label>
          <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={isLoadingUsers || bulkAssignMutation.isPending}>
              <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Employee"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Employee</SelectItem>
              {assignableUsers.map((employee) => (
                <SelectItem key={employee.employee_id} value={employee.employee_id}>
                  {employee.name} ({employee.employee_id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Deadline</Label>
          <DateOnlyDeadlinePicker value={deadline} onChange={setDeadline} disabled={bulkAssignMutation.isPending} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Priority</Label>
          <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={bulkAssignMutation.isPending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Workflow</Label>
          <Select
            value={workflowTarget || "__none__"}
            onValueChange={(value) => {
              setWorkflowTarget(value === "__none__" ? "" : value);
              setReasonType("");
            }}
            disabled={progressLoading || bulkAssignMutation.isPending}
          >
            <SelectTrigger className="h-9 bg-white text-xs">
              <SelectValue placeholder={progressLoading ? "Loading workflow..." : "Workflow"} />
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
      </div>

      {workflowChanged ? (
        <div className="mt-2 max-w-sm space-y-1">
          <Label className="text-xs">Reason Type</Label>
          <Select value={reasonType || "__none__"} onValueChange={(value) => setReasonType(value === "__none__" ? "" : value as FixtureRevisionType)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={bulkAssignMutation.isPending}>
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
            <p className="text-xs text-amber-700">Previous stage must be approved before changing workflow.</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <Label className="text-xs">Assignment Scope</Label>
          <RadioGroup value={scope} onValueChange={(value) => setScope(value as "all_unassigned" | "selected")} className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs">
              <RadioGroupItem value="all_unassigned" />
              All Unassigned Fixtures ({unassignedFixtures.length})
            </label>
            <label className="flex items-center gap-2 text-xs">
              <RadioGroupItem value="selected" />
              Selected Fixtures ({selectedFixtureIds.length})
            </label>
          </RadioGroup>
          {selectedScopeEmpty ? (
            <p className="text-xs text-amber-700">Select fixtures in the grid before using selected scope.</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={bulkAssignMutation.isPending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => bulkAssignMutation.mutate()} disabled={disabled}>
            {bulkAssignMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Assign All
          </Button>
        </div>
      </div>
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
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (fixtureId: string, checked: boolean) => void;
}

function ProjectFixtureCard({
  fixture,
  task,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
  selectable = false,
  selected = false,
  onSelectedChange,
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
  const currentProgressStage = useMemo(() => getCurrentProgressStage(progress), [progress]);
  const workflowOptions = useMemo(() => getAssignableWorkflowOptions(progress), [progress]);

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
  const workflowChangeAllowed = workflowChanged && Boolean(selectedWorkflowStage);
  const canSubmitAssignment = workflowChanged ? workflowChangeAllowed : canAssignCurrent;

  const proofImage = getProofImage(task);
  const canonicalOperationalState = fixture.operational_state || "UNASSIGNED";
  const isSubmittedForVerification = canonicalOperationalState === "VERIFICATION";
  const isAssigned = isFixtureOperationallyAssigned(fixture, task);
  const workflowCode = getFixtureWorkflowCode(fixture);
  const operationalStatus = fixtureStageStatusLabel(canonicalOperationalState);

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

        if (reasonType === "MANUAL_OVERRIDE") {
          await manipulateFixtureStage({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
            target_stage_name: workflowTarget,
            target_status: "PENDING",
            reason_type: "MANUAL_OVERRIDE",
            revision_type: "MANUAL_OVERRIDE",
            revision_reason: "Manual override selected during assignment workflow change",
            remarks: "Manual override selected during assignment workflow change",
          });
        } else {
          await reopenFixtureStage({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
            target_stage_name: workflowTarget,
            revision_type: reasonType,
          });
        }
      }

      await createDesignTask({
        department_id: departmentId,
        project_id: projectId,
        fixture_id: fixture.fixture_id,
        description: fixture.part_name || fixture.fixture_no,
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        priority,
        deadline: normalizeDeadlineToEndOfDayIso(deadline),
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
        title: "Review not saved",
        description: error instanceof Error ? error.message : "Task is not in verification state.",
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
    <div className={cn("rounded-lg border border-slate-200 p-2.5", selected && "border-primary bg-primary/5")}>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {selectable ? (
              <Checkbox
                className="mt-0.5"
                checked={selected}
                onCheckedChange={(checked) => onSelectedChange?.(fixture.fixture_id, checked === true)}
                aria-label={`Select ${fixture.fixture_no}`}
              />
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
              <p className="truncate text-xs text-muted-foreground">{fixture.part_name}</p>
            </div>
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="block h-24 w-32 overflow-hidden rounded-md border bg-slate-50"
                  onClick={() => setPreviewImage(toProofUrl(proofImage))}
                >
                  <img src={toProofUrl(proofImage)} alt={`${fixture.fixture_no} proof`} className="h-full w-full object-cover" />
                </button>
                <div className="min-w-0 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Work proof</p>
                  <p>{formatSubmittedDate(getProofUploadedAt(task))}</p>
                  <p className="truncate">{getProofUploadedBy(task) || "Unknown uploader"}</p>
                </div>
              </div>
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
          <Badge variant="outline" className={cn("text-xs font-medium", fixtureStageStatusColor(canonicalOperationalState))}>
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
        <div className="mt-2 space-y-2 border-t pt-2">
          <div>
            <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
            <p className="truncate text-xs text-muted-foreground">{fixture.part_name}</p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-1">
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

            <div className="space-y-1">
              <Label className="text-xs">Deadline</Label>
              <DateOnlyDeadlinePicker
                value={deadline}
                onChange={setDeadline}
                disabled={assignMutation.isPending}
              />
            </div>

            <div className="space-y-1">
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

          <div className="space-y-1">
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
            <div className="space-y-1">
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
                <p className="text-xs text-amber-700">Choose a configured workflow stage.</p>
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
