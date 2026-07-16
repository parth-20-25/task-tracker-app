import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CheckSquare, ChevronDown, Factory, Image as ImageIcon, Loader2, XCircle } from "lucide-react";

import {
  assignDesign2DCompletionTasks,
  fetchDesign2DCompletionProjects,
  fetchDesign2DCompletionProjectState,
  fetchRecentOutsourceSuppliers,
  type AssignDesign2DCompletionTaskPayload,
  type Design2DCompletionProjectState,
  type Design2DCompletionTaskCode,
  type Design2DCompletionTaskDefinition,
} from "@/api/designApi";
import { cancelTask, fetchTaskAssignmentUsers, transferTask, updateTask } from "@/api/taskApi";
import { Design2DCompletionDueDatePicker, normalizeDesign2DCompletionDeadline } from "@/components/Design2DCompletionDueDate";
import { FixtureBoardCard, FixtureStatusBoard, type FixtureBoardSection } from "@/components/FixtureBoard";
import { ProjectFixtureSectionHeader } from "@/components/ProjectFixtureSectionHeader";
import { SafeImage } from "@/components/SafeImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { analyticsQueryKeys, executiveDashboardQueryKeys, taskAssignmentQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { resolveImageUrl } from "@/lib/imageUrl";
import { cn } from "@/lib/utils";
import type { Priority, Task } from "@/types";

type CompletionSectionKey = "UNASSIGNED" | "ASSIGNED" | "IN_PROGRESS" | "OUTSOURCED" | "VERIFICATION" | "REJECTED" | "WORKFLOW_COMPLETE" | "CANCELLED";
type CompletionFixture = Design2DCompletionProjectState["fixtures"][number];

interface ActivityOption {
  key: string;
  definition: Design2DCompletionTaskDefinition;
  revision: number;
  label: string;
  task: Task | null;
  completed: boolean;
}

interface CompletionFixtureRow {
  fixture: CompletionFixture;
  options: ActivityOption[];
  selectedOptions: ActivityOption[];
  state: CompletionSectionKey;
  task: Task | null;
}

interface AssignmentTarget {
  fixture: CompletionFixture | null;
  ownerLabel: string;
  selectedOptions: ActivityOption[];
}

const SECTION_STYLES: Array<Omit<FixtureBoardSection<CompletionFixtureRow>, "fixtures">> = [
  { key: "UNASSIGNED", label: "Unassigned", background: "#F1EFE8", text: "#444444", accent: "#666666", description: "No owner yet · waiting to be picked up" },
  { key: "ASSIGNED", label: "Assigned", background: "#E6F1FB", text: "#0B4F9C", accent: "#1E6FBB", description: "Ownership confirmed · not yet started" },
  { key: "IN_PROGRESS", label: "In Progress", background: "#EEEDFE", text: "#4B3FBF", accent: "#6A5ACD", description: "Actively being worked on" },
  { key: "OUTSOURCED", label: "Outsourced", background: "#FAEEDA", text: "#9A5A00", accent: "#D88900", description: "Delegated to external supplier" },
  { key: "VERIFICATION", label: "Verification", background: "#E1F5EE", text: "#006B5B", accent: "#009688", description: "Done · waiting for sign-off" },
  { key: "REJECTED", label: "Rejected", background: "#FCEBEB", text: "#B32626", accent: "#D32F2F", description: "Returned · needs correction" },
  { key: "WORKFLOW_COMPLETE", label: "Workflow Complete", background: "#EAF3DE", text: "#2F6B16", accent: "#5E9F2B", description: "Fully done · signed off" },
  { key: "CANCELLED", label: "Cancelled", background: "#F1EFE8", text: "#555555", accent: "#888888", description: "Stopped · revision retained in history" },
];

const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

function activityKey(code: string, revision: number) {
  return `${code}:${revision}`;
}

function activityLabel(definition: Design2DCompletionTaskDefinition, revision: number) {
  return `${definition.displayName} ${String(revision).padStart(2, "0")}`;
}

function isCompletionLocked(task: Task | null) {
  return task?.status === "closed"
    && (task?.verification_status === "approved" || Boolean(task?.approved_at) || Boolean(task?.completion_task_not_required_at));
}

function completionState(task: Task | null): CompletionSectionKey {
  if (!task) return "UNASSIGNED";
  if (task.status === "cancelled") return "CANCELLED";
  if (isCompletionLocked(task)) return "WORKFLOW_COMPLETE";
  if (task.status === "under_review") return "VERIFICATION";
  if (task.status === "rework" || task.verification_status === "rejected") return "REJECTED";
  if (task.completion_task_outsource_supplier) return "OUTSOURCED";
  if (task.status === "in_progress" || task.status === "on_hold" || Number(task.completion_percent) > 0) return "IN_PROGRESS";
  return "ASSIGNED";
}

function buildActivityOptions(
  definitions: Design2DCompletionTaskDefinition[],
  tasks: Task[],
  fixtureId: string | null,
) {
  return definitions.flatMap((definition) => {
    const revisions = tasks
      .filter((task) => (
        task.completion_task_code === definition.code
        && (definition.scope === "fixture"
          ? task.fixture_id === fixtureId
          : task.scope_type === "project" && !task.fixture_id)
      ))
      .sort((left, right) => Number(left.completion_task_revision) - Number(right.completion_task_revision));
    const options: ActivityOption[] = revisions.map((task) => {
      const revision = Number(task.completion_task_revision || 0);
      return {
        key: activityKey(definition.code, revision),
        definition,
        revision,
        label: task.title || activityLabel(definition, revision),
        task,
        completed: isCompletionLocked(task),
      };
    });

    if (!revisions.length) {
      options.push({
        key: activityKey(definition.code, 0),
        definition,
        revision: 0,
        label: activityLabel(definition, 0),
        task: null,
        completed: false,
      });
    } else {
      const latest = revisions[revisions.length - 1];
      const nextRevision = Number(latest.completion_task_revision || 0) + 1;
      if ((latest.status === "cancelled" || isCompletionLocked(latest)) && nextRevision <= 99) {
        options.push({
          key: activityKey(definition.code, nextRevision),
          definition,
          revision: nextRevision,
          label: activityLabel(definition, nextRevision),
          task: null,
          completed: false,
        });
      }
    }

    return options;
  });
}

function isAssignableOption(option: ActivityOption) {
  return !option.task;
}

function keepSelectableKeys(current: string[] = [], options: ActivityOption[]) {
  const allowed = new Set(options.filter(isAssignableOption).map((option) => option.key));
  const next = current.filter((key) => allowed.has(key));
  return next.length === current.length && next.every((key, index) => key === current[index]) ? current : next;
}

function selectedOptionsForKeys(options: ActivityOption[], keys: string[] = []) {
  const selected = new Set(keys);
  return options.filter((option) => selected.has(option.key) && isAssignableOption(option));
}

function latestTasksForScope(definitions: Design2DCompletionTaskDefinition[], tasks: Task[], fixtureId: string | null) {
  return definitions.map((definition) => tasks
    .filter((task) => (
      task.completion_task_code === definition.code
      && (definition.scope === "fixture"
        ? task.fixture_id === fixtureId
        : task.scope_type === "project" && !task.fixture_id)
    ))
    .sort((left, right) => Number(right.completion_task_revision || 0) - Number(left.completion_task_revision || 0))[0]
    || null);
}

function aggregateStateForScope(definitions: Design2DCompletionTaskDefinition[], tasks: Task[], fixtureId: string | null): CompletionSectionKey {
  const mandatoryTasks = latestTasksForScope(
    definitions.filter((definition) => definition.required || definition.isMandatory),
    tasks,
    fixtureId,
  );

  if (mandatoryTasks.some((task) => task?.status === "rework" || task?.verification_status === "rejected")) return "REJECTED";
  if (mandatoryTasks.some((task) => task?.status === "under_review")) return "VERIFICATION";
  if (mandatoryTasks.some((task) => task?.completion_task_outsource_supplier && !isCompletionLocked(task))) return "OUTSOURCED";
  if (mandatoryTasks.some((task) => task && ["in_progress", "on_hold"].includes(task.status))) return "IN_PROGRESS";
  if (mandatoryTasks.some((task) => task && ["assigned", "created"].includes(task.status))) return "ASSIGNED";
  if (mandatoryTasks.length > 0 && mandatoryTasks.every((task) => isCompletionLocked(task))) return "WORKFLOW_COMPLETE";
  return "UNASSIGNED";
}

function representativeTaskForState(definitions: Design2DCompletionTaskDefinition[], tasks: Task[], fixtureId: string | null, state: CompletionSectionKey) {
  const latest = latestTasksForScope(definitions, tasks, fixtureId).filter((task): task is Task => Boolean(task));
  return latest.find((task) => completionState(task) === state) || latest[0] || null;
}

function activityStatusLabel(option: ActivityOption) {
  const task = option.task;
  if (!task) return "Unassigned";
  if (option.completed) return "Completed";
  if (task.status === "cancelled") return "Cancelled";
  if (task.status === "under_review") return "Verification";
  if (task.status === "rework" || task.verification_status === "rejected") return "Rejected";
  if (task.completion_task_outsource_supplier) return "Outsourced";
  if (task.status === "in_progress" || task.status === "on_hold" || Number(task.completion_percent) > 0) return "In Progress";
  return "Assigned";
}

function disabledReason(option: ActivityOption) {
  if (!option.task) return undefined;
  if (option.completed) return "Completed revision cannot be reassigned. Use the next revision option.";
  if (option.task.status === "cancelled") return "Cancelled revision is retained as history. Use the next revision option.";
  return `Already ${activityStatusLabel(option).toLowerCase()}. Finish, cancel, or reject it before creating another revision.`;
}

function selectedActivitySummary(options: ActivityOption[]) {
  if (options.length === 0) return "Select activities";
  if (options.length === 1) return options[0].label;
  return `${options.length} activities selected`;
}

function selectedActivityCount(targets: Array<{ selectedOptions: ActivityOption[] }>) {
  return targets.reduce((count, target) => count + target.selectedOptions.length, 0);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function assigneeName(task: Task | null) {
  if (!task) return null;
  if (task.assignee_names) return task.assignee_names;
  if (task.assignee) return formatEmployeeDisplay(task.assignee);
  return task.assigned_to;
}

function assignmentFailureDescription(failures: PromiseRejectedResult[]) {
  if (!failures.length) return undefined;
  const firstMessage = failures
    .map((failure) => failure.reason)
    .find((reason): reason is Error => reason instanceof Error)?.message;
  const count = `${failures.length} assignment${failures.length === 1 ? "" : "s"} failed.`;
  return firstMessage ? `${count} ${firstMessage}` : count;
}

interface Design2DCompletionTasksProps {
  departmentId?: string | null;
}

export function Design2DCompletionTasks({ departmentId }: Design2DCompletionTasksProps) {
  const queryClient = useQueryClient();
  const { user, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedActivityByFixture, setSelectedActivityByFixture] = useState<Record<string, string[]>>({});
  const [selectedProjectActivityKeys, setSelectedProjectActivityKeys] = useState<string[]>([]);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    UNASSIGNED: true,
    ASSIGNED: true,
    IN_PROGRESS: true,
    OUTSOURCED: true,
    VERIFICATION: true,
    REJECTED: true,
    WORKFLOW_COMPLETE: true,
    CANCELLED: true,
  });
  const [assignmentTarget, setAssignmentTarget] = useState<AssignmentTarget | null>(null);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [outsourceTargets, setOutsourceTargets] = useState<CompletionFixtureRow[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [instructions, setInstructions] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [transferringTask, setTransferringTask] = useState<Task | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [cancellingTask, setCancellingTask] = useState<Task | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const cancelInFlightRef = useRef(false);

  const projectsQuery = useQuery({
    queryKey: ["design", "2d-completion", "projects", departmentId || "all"],
    queryFn: () => fetchDesign2DCompletionProjects(departmentId || undefined),
    enabled: Boolean(user?.employee_id),
  });
  const stateQuery = useQuery({
    queryKey: ["design", "2d-completion", "project", selectedProjectId],
    queryFn: () => fetchDesign2DCompletionProjectState(selectedProjectId, departmentId || undefined),
    enabled: Boolean(selectedProjectId),
  });
  const state = stateQuery.data;
  const effectiveDepartmentId = state?.project.department_id || departmentId || undefined;
  const canAssign = access.canAssignTasks && access.canCreateTasks;
  const assigneesQuery = useQuery({
    queryKey: ["task-assignment", "design-2d-completion", selectedProjectId, effectiveDepartmentId],
    queryFn: () => fetchTaskAssignmentUsers({
      task_type: "department_workflow",
      department_id: effectiveDepartmentId,
      project_id: selectedProjectId,
      stage_name: "2D Finish",
    }),
    enabled: Boolean(selectedProjectId && effectiveDepartmentId && canAssign),
  });
  const suppliersQuery = useQuery({
    queryKey: ["design", "outsource-suppliers", effectiveDepartmentId],
    queryFn: () => fetchRecentOutsourceSuppliers(effectiveDepartmentId),
    enabled: outsourceTargets.length > 0,
  });
  const assignees = assigneesQuery.data ?? [];
  const definitions = useMemo(
    () => (state?.fixture_task_types ?? []).filter((definition) => definition.scope === "fixture"),
    [state?.fixture_task_types],
  );
  const projectDefinitions = useMemo(
    () => (state?.project_task_types ?? []).filter((definition) => definition.scope === "project"),
    [state?.project_task_types],
  );
  const projectOptions = useMemo(
    () => buildActivityOptions(projectDefinitions, state?.tasks ?? [], null),
    [projectDefinitions, state?.tasks],
  );
  const selectedProjectOptions = useMemo(
    () => selectedOptionsForKeys(projectOptions, selectedProjectActivityKeys),
    [projectOptions, selectedProjectActivityKeys],
  );

  useEffect(() => {
    setSelectedProjectId("");
    setSelectedProjectActivityKeys([]);
  }, [departmentId]);

  useEffect(() => {
    if (!state) return;
    setSelectedActivityByFixture((current) => Object.fromEntries(state.fixtures.map((fixture) => {
      const options = buildActivityOptions(definitions, state.tasks, fixture.fixture_id);
      return [fixture.fixture_id, keepSelectableKeys(current[fixture.fixture_id], options)];
    })));
  }, [definitions, state]);

  useEffect(() => {
    setSelectedProjectActivityKeys((current) => keepSelectableKeys(current, projectOptions));
  }, [projectOptions]);

  const rows = useMemo<CompletionFixtureRow[]>(() => (state?.fixtures ?? []).map((fixture) => {
    const options = buildActivityOptions(definitions, state?.tasks ?? [], fixture.fixture_id);
    const selectedOptions = selectedOptionsForKeys(options, selectedActivityByFixture[fixture.fixture_id]);
    const fixtureState = aggregateStateForScope(definitions, state?.tasks ?? [], fixture.fixture_id);
    const task = representativeTaskForState(definitions, state?.tasks ?? [], fixture.fixture_id, fixtureState);
    return { fixture, options, selectedOptions, state: fixtureState, task };
  }), [definitions, selectedActivityByFixture, state]);

  const sections = useMemo(() => SECTION_STYLES.map((section) => ({
    ...section,
    fixtures: rows
      .filter((row) => row.state === section.key)
      .sort((left, right) => left.fixture.fixture_no.localeCompare(right.fixture.fixture_no, undefined, { numeric: true })),
  })), [rows]);
  const eligibleRows = rows.filter((row) => row.options.some(isAssignableOption));
  const eligibleIds = new Set(eligibleRows.map((row) => row.fixture.fixture_id));
  const selectedEligibleRows = rows.filter((row) => selectedFixtureIds.includes(row.fixture.fixture_id) && eligibleIds.has(row.fixture.fixture_id));
  const selectedRows = selectedEligibleRows.filter((row) => row.selectedOptions.length > 0);
  const allEligibleSelected = eligibleRows.length > 0 && selectedEligibleRows.length === eligibleRows.length;
  const someEligibleSelected = selectedEligibleRows.length > 0 && !allEligibleSelected;
  const assignmentSummary = {
    assigned: rows.filter((row) => row.state !== "UNASSIGNED").length,
    unassigned: rows.filter((row) => row.state === "UNASSIGNED").length,
  };

  useEffect(() => {
    setSelectedFixtureIds((current) => current.filter((fixtureId) => eligibleIds.has(fixtureId)));
  }, [rows]);

  async function refreshCompletionState() {
    await Promise.all([
      stateQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.verificationQueue }),
      queryClient.invalidateQueries({ queryKey: taskAssignmentQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures"] }),
      queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: executiveDashboardQueryKeys.all }),
    ]);
  }

  function payloadFor(target: AssignmentTarget | CompletionFixtureRow, supplier?: string): AssignDesign2DCompletionTaskPayload {
    if (!assignedTo || !deadline) throw new Error("Assignee and deadline are required");
    const taskCodes = [...new Set(target.selectedOptions.map((option) => option.definition.code as Design2DCompletionTaskCode))];
    if (!taskCodes.length) throw new Error("Select at least one unassigned activity");
    return {
      department_id: effectiveDepartmentId,
      project_id: selectedProjectId,
      fixture_id: target.fixture?.fixture_id ?? null,
      task_codes: taskCodes,
      instructions: instructions.trim() || undefined,
      assigned_to: assignedTo,
      priority,
      deadline: normalizeDesign2DCompletionDeadline(deadline),
      outsource: Boolean(supplier),
      supplier_name: supplier || undefined,
    };
  }

  const assignmentMutation = useMutation({
    mutationFn: async ({ targets, supplier }: { targets: Array<AssignmentTarget | CompletionFixtureRow>; supplier?: string }) => {
      if (!targets.length || selectedActivityCount(targets) === 0) throw new Error("Select at least one unassigned activity");
      const results = await Promise.allSettled(targets.map((target) => assignDesign2DCompletionTasks(payloadFor(target, supplier))));
      return {
        succeeded: results.reduce((count, result) => count + (result.status === "fulfilled" ? result.value.length : 0), 0),
        failures: results.filter((result): result is PromiseRejectedResult => result.status === "rejected"),
      };
    },
    onSuccess: async ({ succeeded, failures }) => {
      await refreshCompletionState();
      if (succeeded > 0) {
        setAssignmentTarget(null);
        setBulkPanelOpen(false);
        setOutsourceTargets([]);
        setSelectedFixtureIds([]);
        setSelectedActivityByFixture({});
        setSelectedProjectActivityKeys([]);
        setSupplierName("");
        setInstructions("");
      }
      toast({
        title: failures.length && succeeded === 0
          ? "Assignment failed"
          : `${succeeded} activit${succeeded === 1 ? "y" : "ies"} assigned successfully`,
        description: assignmentFailureDescription(failures),
        variant: failures.length ? "destructive" : "default",
      });
    },
    onError: (error) => toast({
      title: "Assignment failed",
      description: error instanceof Error ? error.message : "Could not assign the activity.",
      variant: "destructive",
    }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ task, action, remarks }: { task: Task; action: "approve" | "reject"; remarks?: string }) =>
      updateTask(task.id, { verification_action: action, remarks }),
    onSuccess: async (_, variables) => {
      await refreshCompletionState();
      setRejectingTask(null);
      setRejectionReason("");
      toast({ title: variables.action === "approve" ? "Activity approved" : "Activity rejected" });
    },
    onError: (error) => toast({ title: "Review failed", description: error instanceof Error ? error.message : "Could not review the activity.", variant: "destructive" }),
  });

  const transferMutation = useMutation({
    mutationFn: () => {
      if (!transferringTask || !transferTo || !transferReason.trim()) throw new Error("Employee and reason are required");
      return transferTask(transferringTask.id, {
        transfer_to: transferTo,
        transfer_reason: transferReason.trim(),
        completion_percent: transferringTask.completion_percent || 0,
      });
    },
    onSuccess: async () => {
      await refreshCompletionState();
      setTransferringTask(null);
      setTransferTo("");
      setTransferReason("");
      toast({ title: "Activity transferred" });
    },
    onError: (error) => toast({ title: "Transfer failed", description: error instanceof Error ? error.message : "Could not transfer the activity.", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!cancellingTask || !cancellationReason.trim()) throw new Error("Cancellation reason is required");
      return cancelTask(cancellingTask.id, cancellationReason.trim());
    },
    onSuccess: async () => {
      await refreshCompletionState();
      setCancellingTask(null);
      setCancellationReason("");
      toast({ title: "Activity cancelled" });
    },
    onError: (error) => toast({ title: "Cancellation failed", description: error instanceof Error ? error.message : "Could not cancel the activity.", variant: "destructive" }),
    onSettled: () => { cancelInFlightRef.current = false; },
  });

  function submitCancellation() {
    if (cancelMutation.isPending || cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    cancelMutation.mutate();
  }

  function activitySelect(row: CompletionFixtureRow) {
    return (
      <ActivityMultiSelect
        options={row.options}
        selectedKeys={row.selectedOptions.map((option) => option.key)}
        onSelectedKeysChange={(keys) => setSelectedActivityByFixture((current) => ({ ...current, [row.fixture.fixture_id]: keys }))}
        ariaLabel={`${row.fixture.fixture_no} activity`}
      />
    );
  }

  function cardActions(row: CompletionFixtureRow) {
    const task = row.task;
    const ownTask = task?.assigned_to === user?.employee_id || task?.assignee_ids?.includes(user?.employee_id || "");
    const canReview = task?.status === "under_review"
      && task.verification_status === "pending"
      && access.canApproveCompletedTasks
      && (!ownTask || access.canSelfApprove);
    const canTransfer = Boolean(task && !["closed", "cancelled", "under_review"].includes(task.status)
      && (access.canTransferTasks || access.canAssignTasks));
    const canCancel = Boolean(task && !["cancelled", "under_review"].includes(task.status) && !isCompletionLocked(task)
      && (access.canAssignTasks || ownTask));

    return (
      <>
        <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
          {canAssign && row.selectedOptions.length ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={assignmentMutation.isPending}
                onClick={() => setAssignmentTarget({ fixture: row.fixture, ownerLabel: row.fixture.fixture_no, selectedOptions: row.selectedOptions })}
              >
                Assign Now
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={assignmentMutation.isPending} onClick={() => setOutsourceTargets([row])}><Factory className="mr-1 h-3 w-3" />Outsource</Button>
            </>
          ) : null}
          {canReview ? (
            <>
              <Button type="button" size="sm" className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ task, action: "approve" })}>APPROVE</Button>
              <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-[11px]" disabled={reviewMutation.isPending} onClick={() => setRejectingTask(task)}>REJECT</Button>
            </>
          ) : (
            <>
              {canTransfer ? <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setTransferringTask(task)}><ArrowRightLeft className="mr-1 h-3 w-3" />Transfer</Button> : null}
              {canCancel ? <Button type="button" size="sm" variant="outline" className="h-7 border-red-200 px-2 text-[11px] text-red-700 hover:bg-red-50" onClick={() => setCancellingTask(task)}><XCircle className="mr-1 h-3 w-3" />Cancel Task</Button> : null}
            </>
          )}
        </div>
      </>
    );
  }

  function renderCard(row: CompletionFixtureRow) {
    const task = row.task;
    const proofImage = task?.latest_proof?.file_url || task?.proof_url?.at(-1) || null;

    return (
      <FixtureBoardCard
        key={row.fixture.fixture_id}
        fixtureId={row.fixture.fixture_id}
        fixtureNo={row.fixture.fixture_no}
        partName={row.fixture.part_name}
        activity={activitySelect(row)}
        assigned={Boolean(task)}
        assigneeName={assigneeName(task)}
        progressPercent={task?.completion_percent ?? null}
        submittedLabel={formatDate(task?.submitted_at || task?.completed_at)}
        actions={cardActions(row)}
        selectable={canAssign && row.options.some(isAssignableOption)}
        selected={selectedFixtureIds.includes(row.fixture.fixture_id)}
        onSelectedChange={(fixtureId, checked) => setSelectedFixtureIds((current) => checked
          ? [...new Set([...current, fixtureId])]
          : current.filter((id) => id !== fixtureId))}
      >
        {row.state === "OUTSOURCED" ? <p className="text-xs font-medium text-amber-700">Supplier: {task?.completion_task_outsource_supplier}</p> : null}
        {row.state === "REJECTED" && task?.remarks ? <p className="text-xs font-medium text-red-700">Rejection: {task.remarks}</p> : null}
        {row.state === "VERIFICATION" ? (
          <div className="space-y-2 rounded-md bg-slate-50/70 p-2">
            {proofImage ? (
              <button type="button" className="block h-20 w-28 overflow-hidden rounded-md border bg-slate-50" onClick={() => setPreviewImage(resolveImageUrl(proofImage))}>
                <SafeImage src={proofImage} alt={`${row.fixture.fixture_no} proof`} className="h-full w-full object-cover" />
              </button>
            ) : <div className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed bg-slate-50 text-slate-400"><ImageIcon className="h-5 w-5" /></div>}
          </div>
        ) : null}

      </FixtureBoardCard>
    );
  }

  const selectedProject = state?.project;

  return (
    <section className="space-y-3" aria-labelledby="design-2d-completion-heading">
      <ProjectFixtureSectionHeader
        headingId="design-2d-completion-heading"
        title="2D Completion Tasks"
        selectedProjectId={selectedProjectId}
        onProjectChange={(projectId) => {
          setSelectedProjectId(projectId);
          setSelectedFixtureIds([]);
          setBulkPanelOpen(false);
        }}
        ariaLabel="2D Completion Tasks project"
        projects={(projectsQuery.data ?? []).map((project) => ({
          projectId: project.project_id,
          label: `${formatProjectNumber(project)} — ${project.project_name}`,
        }))}
      />

      {!selectedProjectId ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Select a project with at least one completed original 2D fixture stage.</CardContent></Card>
      ) : stateQuery.isLoading ? (
        <Card><CardContent className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
      ) : state ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Showing {rows.length} fixture(s) · {selectedProject?.company_name || "No customer"}</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-emerald-700">{assignmentSummary.assigned} assigned</span>
              <span className="text-slate-500">{assignmentSummary.unassigned} unassigned</span>
            </div>
          </div>

          {canAssign ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={someEligibleSelected ? "indeterminate" : allEligibleSelected}
                  disabled={!eligibleRows.length || assignmentMutation.isPending}
                  onCheckedChange={(checked) => setSelectedFixtureIds(checked === true ? eligibleRows.map((row) => row.fixture.fixture_id) : [])}
                  aria-label="Select all eligible fixtures"
                />
                <span>Select all eligible fixtures</span>
              </label>
              <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={!selectedRows.length} onClick={() => setOutsourceTargets(selectedRows)}><Factory className="mr-1.5 h-3.5 w-3.5" />Outsource Selected ({selectedRows.length})</Button>
              <Button type="button" size="sm" variant={bulkPanelOpen ? "secondary" : "outline"} className="h-8 px-3 text-xs" disabled={!selectedRows.length} onClick={() => setBulkPanelOpen((open) => !open)}><CheckSquare className="mr-1.5 h-3.5 w-3.5" />Assign All</Button>
            </div>
          ) : null}

          {bulkPanelOpen ? (
            <Card className="border-primary/30"><CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold">Assign {selectedActivityCount(selectedRows)} selected completion activit{selectedActivityCount(selectedRows) === 1 ? "y" : "ies"}</p>
              <SelectedActivitiesList targets={selectedRows.map((row) => ({ ownerLabel: row.fixture.fixture_no, selectedOptions: row.selectedOptions }))} />
              <AssignmentFields assignees={assignees} assignedTo={assignedTo} setAssignedTo={setAssignedTo} deadline={deadline} setDeadline={setDeadline} priority={priority} setPriority={setPriority} instructions={instructions} setInstructions={setInstructions} disabled={assignmentMutation.isPending} />
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setBulkPanelOpen(false)}>Cancel</Button><Button type="button" size="sm" disabled={!assignedTo || !deadline || assignmentMutation.isPending} onClick={() => assignmentMutation.mutate({ targets: selectedRows })}>Assign All</Button></div>
            </CardContent></Card>
          ) : null}

          <ProjectLevelCompletionTasks
            disabled={!state.project_tasks_unlocked}
            options={projectOptions}
            selectedKeys={selectedProjectActivityKeys}
            onSelectedKeysChange={setSelectedProjectActivityKeys}
            onAssign={() => setAssignmentTarget({ fixture: null, ownerLabel: "Project-level tasks", selectedOptions: selectedProjectOptions })}
            selectedCount={selectedProjectOptions.length}
          />

          <FixtureStatusBoard
            sections={sections}
            openSections={openSections}
            onOpenChange={(key, open) => setOpenSections((current) => ({ ...current, [key]: open }))}
            renderFixture={renderCard}
          />
        </div>
      ) : <Card><CardContent className="p-8 text-center text-sm text-destructive">Could not load 2D completion tasks.</CardContent></Card>}

      <Dialog open={outsourceTargets.length > 0} onOpenChange={(open) => !open && setOutsourceTargets([])}>
        <DialogContent>
          <DialogHeader><DialogTitle>{outsourceTargets.length > 1 ? "Outsource Selected Activities" : "Outsource 2D Completion Activity"}</DialogTitle><DialogDescription>The activity remains attached to the same fixture and uses the normal proof and approval lifecycle.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Supplier</Label><Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Supplier name" /></div>
            {(suppliersQuery.data ?? []).length ? <div className="flex flex-wrap gap-2">{suppliersQuery.data?.map((supplier) => <Button key={supplier} type="button" size="sm" variant="outline" onClick={() => setSupplierName(supplier)}>{supplier}</Button>)}</div> : null}
            <SelectedActivitiesList targets={outsourceTargets.map((row) => ({ ownerLabel: row.fixture.fixture_no, selectedOptions: row.selectedOptions }))} />
            <AssignmentFields assignees={assignees} assignedTo={assignedTo} setAssignedTo={setAssignedTo} deadline={deadline} setDeadline={setDeadline} priority={priority} setPriority={setPriority} instructions={instructions} setInstructions={setInstructions} disabled={assignmentMutation.isPending} />
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOutsourceTargets([])}>Cancel</Button><Button type="button" disabled={!supplierName.trim() || !assignedTo || !deadline || assignmentMutation.isPending} onClick={() => assignmentMutation.mutate({ targets: outsourceTargets, supplier: supplierName.trim() })}>{assignmentMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Outsource</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assignmentTarget)} onOpenChange={(open) => !open && setAssignmentTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Completion Activities</DialogTitle>
            <DialogDescription>Review the selected activities before assignment.</DialogDescription>
          </DialogHeader>
          {assignmentTarget ? (
            <div className="space-y-4">
              <SelectedActivitiesList targets={[assignmentTarget]} />
              <AssignmentFields assignees={assignees} assignedTo={assignedTo} setAssignedTo={setAssignedTo} deadline={deadline} setDeadline={setDeadline} priority={priority} setPriority={setPriority} instructions={instructions} setInstructions={setInstructions} disabled={assignmentMutation.isPending} />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignmentTarget(null)} disabled={assignmentMutation.isPending}>Cancel</Button>
            <Button
              type="button"
              disabled={!assignedTo || !deadline || !assignmentTarget?.selectedOptions.length || assignmentMutation.isPending}
              onClick={() => assignmentTarget && assignmentMutation.mutate({ targets: [assignmentTarget] })}
            >
              {assignmentMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Assign {assignmentTarget?.selectedOptions.length || 0} Activit{assignmentTarget?.selectedOptions.length === 1 ? "y" : "ies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => !open && setRejectingTask(null)}><DialogContent><DialogHeader><DialogTitle>Reject Completion Activity</DialogTitle></DialogHeader><Textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Rejection reason" rows={4} /><DialogFooter><Button type="button" variant="outline" onClick={() => setRejectingTask(null)}>Cancel</Button><Button type="button" variant="destructive" disabled={!rejectingTask || !rejectionReason.trim() || reviewMutation.isPending} onClick={() => rejectingTask && reviewMutation.mutate({ task: rejectingTask, action: "reject", remarks: rejectionReason.trim() })}>Reject</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(transferringTask)} onOpenChange={(open) => !open && setTransferringTask(null)}><DialogContent><DialogHeader><DialogTitle>Transfer Completion Activity</DialogTitle></DialogHeader><div className="space-y-3"><div className="space-y-1.5"><Label>Employee</Label><Select value={transferTo || "__none__"} onValueChange={(value) => setTransferTo(value === "__none__" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger><SelectContent><SelectItem value="__none__">Select employee</SelectItem>{assignees.filter((employee) => employee.employee_id !== transferringTask?.assigned_to).map((employee) => <SelectItem key={employee.employee_id} value={employee.employee_id}>{employee.employee_id} — {employee.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>Reason</Label><Textarea value={transferReason} onChange={(event) => setTransferReason(event.target.value)} rows={3} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setTransferringTask(null)}>Cancel</Button><Button type="button" disabled={!transferTo || !transferReason.trim() || transferMutation.isPending} onClick={() => transferMutation.mutate()}>Transfer</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(cancellingTask)} onOpenChange={(open) => !open && setCancellingTask(null)}><DialogContent><DialogHeader><DialogTitle>Cancel Completion Activity</DialogTitle><DialogDescription>The cancelled revision remains in history and does not change the original fixture workflow.</DialogDescription></DialogHeader><Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Cancellation reason" rows={3} /><DialogFooter><Button type="button" variant="outline" onClick={() => setCancellingTask(null)} disabled={cancelMutation.isPending}>Keep Activity</Button><Button type="button" variant="destructive" disabled={!cancellingTask || !cancellationReason.trim() || cancelMutation.isPending} onClick={submitCancellation}>Cancel Activity</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}><DialogContent className="max-w-3xl">{previewImage ? <SafeImage src={previewImage} alt="Completion activity proof" className="max-h-[70vh] w-full rounded-md object-contain" /> : null}</DialogContent></Dialog>
    </section>
  );
}

interface ActivityMultiSelectProps {
  options: ActivityOption[];
  selectedKeys: string[];
  onSelectedKeysChange: (keys: string[]) => void;
  ariaLabel: string;
  disabled?: boolean;
}

function ActivityMultiSelect({ options, selectedKeys, onSelectedKeysChange, ariaLabel, disabled = false }: ActivityMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected = new Set(selectedKeys);
  const selectedOptions = selectedOptionsForKeys(options, selectedKeys);

  function toggle(option: ActivityOption) {
    if (disabled || !isAssignableOption(option)) return;
    const next = selected.has(option.key)
      ? selectedKeys.filter((key) => key !== option.key)
      : [...selectedKeys, option.key];
    onSelectedKeysChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 min-w-[210px] justify-between gap-2 px-2 text-xs"
          aria-label={ariaLabel}
          disabled={disabled && options.every((option) => !isAssignableOption(option))}
          data-selected-count={selectedOptions.length}
        >
          <span className="truncate">{selectedActivitySummary(selectedOptions)}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="max-h-72 space-y-1 overflow-y-auto" role="group" aria-label={ariaLabel}>
          {options.map((option) => {
            const checkboxId = `${id}-${option.key}`.replace(/[^a-zA-Z0-9_-]/g, "-");
            const optionDisabled = disabled || !isAssignableOption(option);
            const reason = disabledReason(option);
            const display = !option.task && option.revision > 0 ? `Create ${option.label}` : option.label;

            return (
              <div
                key={option.key}
                className={cn(
                  "rounded-md px-2 py-2 text-xs",
                  option.completed && "bg-emerald-600 text-white",
                  !option.completed && optionDisabled && "bg-slate-50 text-slate-500",
                  !option.completed && !optionDisabled && "hover:bg-slate-50",
                )}
                data-activity-option={option.key}
                data-completed={option.completed ? "true" : "false"}
                title={reason}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={selected.has(option.key)}
                    disabled={optionDisabled}
                    onCheckedChange={() => toggle(option)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        toggle(option);
                      }
                    }}
                    aria-describedby={reason ? `${checkboxId}-status` : undefined}
                    className={cn(option.completed && "border-white data-[state=checked]:bg-white data-[state=checked]:text-emerald-700")}
                  />
                  <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate font-medium">{option.completed ? "✓ " : ""}{display}</span>
                    <span
                      id={`${checkboxId}-status`}
                      className={cn(
                        "mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        option.completed ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {activityStatusLabel(option)}
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!selectedOptions.length} onClick={() => onSelectedKeysChange([])}>Clear</Button>
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
function ProjectLevelCompletionTasks({
  disabled,
  options,
  selectedKeys,
  onSelectedKeysChange,
  onAssign,
  selectedCount,
}: {
  disabled: boolean;
  options: ActivityOption[];
  selectedKeys: string[];
  onSelectedKeysChange: (keys: string[]) => void;
  onAssign: () => void;
  selectedCount: number;
}) {
  if (!options.length) return null;

  return (
    <Card className="border-slate-200">
      <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Project-level 2D completion tasks</p>
          <p className="text-xs text-muted-foreground">
            {disabled ? "Available after all mandatory fixture-level activities are approved." : "CMM Data, Line Layout, Mimic, and Wear-Out Data stay separate from fixture cards."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityMultiSelect
            options={options}
            selectedKeys={selectedKeys}
            onSelectedKeysChange={onSelectedKeysChange}
            ariaLabel="Project-level activity"
            disabled={disabled}
          />
          <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={disabled || selectedCount === 0} onClick={onAssign}>Assign Project Tasks</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SelectedActivitiesList({ targets }: { targets: Array<{ ownerLabel: string; selectedOptions: ActivityOption[] }> }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected activities</p>
      <ul className="mt-2 space-y-1 text-sm">
        {targets.flatMap((target) => target.selectedOptions.map((option) => (
          <li key={`${target.ownerLabel}-${option.key}`} className="flex items-center justify-between gap-3">
            <span>{option.label}</span>
            <span className="text-xs text-muted-foreground">{target.ownerLabel}</span>
          </li>
        )))}
      </ul>
    </div>
  );
}
interface AssignmentFieldsProps {
  assignees: Array<{ employee_id: string; name: string }>;
  assignedTo: string;
  setAssignedTo: (value: string) => void;
  deadline: string;
  setDeadline: (value: string) => void;
  priority: Priority;
  setPriority: (value: Priority) => void;
  instructions: string;
  setInstructions: (value: string) => void;
  disabled: boolean;
}

function AssignmentFields({ assignees, assignedTo, setAssignedTo, deadline, setDeadline, priority, setPriority, instructions, setInstructions, disabled }: AssignmentFieldsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5"><Label>Assignee</Label><Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}><SelectTrigger disabled={disabled}><SelectValue placeholder="Select assignee" /></SelectTrigger><SelectContent><SelectItem value="__none__">Select assignee</SelectItem>{assignees.map((employee) => <SelectItem key={employee.employee_id} value={employee.employee_id}>{employee.employee_id} — {employee.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Deadline</Label><Design2DCompletionDueDatePicker value={deadline} onChange={setDeadline} disabled={disabled} /></div>
      <div className="space-y-1.5"><Label>Priority</Label><Select value={priority} onValueChange={(value) => setPriority(value as Priority)}><SelectTrigger disabled={disabled}><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5 md:col-span-3"><Label>Instructions</Label><Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional instructions" rows={3} disabled={disabled} /></div>
    </div>
  );
}
