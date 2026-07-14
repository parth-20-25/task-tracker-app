import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CheckSquare, Factory, Image as ImageIcon, Loader2, XCircle } from "lucide-react";

import {
  assignDesign2DCompletionTask,
  fetchDesign2DCompletionProjects,
  fetchDesign2DCompletionProjectState,
  fetchRecentOutsourceSuppliers,
  type AssignDesign2DCompletionTaskPayload,
  type Design2DCompletionProjectState,
  type Design2DCompletionTaskCode,
  type Design2DCompletionTaskDefinition,
} from "@/api/designApi";
import { cancelTask, fetchTaskAssignmentUsers, transferTask, updateTask } from "@/api/taskApi";
import { FixtureBoardCard, FixtureStatusBoard, type FixtureBoardSection } from "@/components/FixtureBoard";
import { ProjectFixtureSectionHeader } from "@/components/ProjectFixtureSectionHeader";
import { SafeImage } from "@/components/SafeImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { taskQueryKeys } from "@/lib/queryKeys";
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
  selected: ActivityOption;
  state: CompletionSectionKey;
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

function defaultDeadline() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function activityKey(code: string, revision: number) {
  return `${code}:${revision}`;
}

function activityLabel(definition: Design2DCompletionTaskDefinition, revision: number) {
  return `${definition.displayName} ${String(revision).padStart(2, "0")}`;
}

function isApproved(task: Task | null) {
  return task?.status === "closed" && task.verification_status === "approved";
}

function completionState(task: Task | null): CompletionSectionKey {
  if (!task) return "UNASSIGNED";
  if (task.status === "cancelled") return "CANCELLED";
  if (isApproved(task)) return "WORKFLOW_COMPLETE";
  if (task.status === "under_review") return "VERIFICATION";
  if (task.status === "rework" || task.verification_status === "rejected") return "REJECTED";
  if (task.completion_task_outsource_supplier) return "OUTSOURCED";
  if (task.status === "in_progress" || task.status === "on_hold" || Number(task.completion_percent) > 0) return "IN_PROGRESS";
  return "ASSIGNED";
}

function buildActivityOptions(
  definitions: Design2DCompletionTaskDefinition[],
  tasks: Task[],
  fixtureId: string,
) {
  return definitions.flatMap((definition) => {
    const revisions = tasks
      .filter((task) => task.fixture_id === fixtureId && task.completion_task_code === definition.code)
      .sort((left, right) => Number(left.completion_task_revision) - Number(right.completion_task_revision));
    const options: ActivityOption[] = revisions.map((task) => {
      const revision = Number(task.completion_task_revision || 0);
      return {
        key: activityKey(definition.code, revision),
        definition,
        revision,
        label: task.title || activityLabel(definition, revision),
        task,
        completed: isApproved(task),
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
      if (["closed", "cancelled"].includes(latest.status) && nextRevision <= 99) {
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

function latestExistingOption(options: ActivityOption[]) {
  return [...options]
    .filter((option) => option.task)
    .sort((left, right) => new Date(right.task?.created_at || 0).getTime() - new Date(left.task?.created_at || 0).getTime())[0]
    || options[0];
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

interface Design2DCompletionTasksProps {
  departmentId?: string | null;
}

export function Design2DCompletionTasks({ departmentId }: Design2DCompletionTasksProps) {
  const queryClient = useQueryClient();
  const { user, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedActivityByFixture, setSelectedActivityByFixture] = useState<Record<string, string>>({});
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
  const [assignmentTarget, setAssignmentTarget] = useState<CompletionFixtureRow | null>(null);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [outsourceTargets, setOutsourceTargets] = useState<CompletionFixtureRow[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [priority, setPriority] = useState<Priority>("medium");
  const [supplierName, setSupplierName] = useState("");
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [transferringTask, setTransferringTask] = useState<Task | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [cancellingTask, setCancellingTask] = useState<Task | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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

  useEffect(() => {
    setSelectedProjectId("");
  }, [departmentId]);

  useEffect(() => {
    if (!state) return;
    setSelectedActivityByFixture((current) => Object.fromEntries(state.fixtures.map((fixture) => {
      const options = buildActivityOptions(definitions, state.tasks, fixture.fixture_id);
      const selected = options.find((option) => option.key === current[fixture.fixture_id]) || latestExistingOption(options);
      return [fixture.fixture_id, selected?.key || ""];
    })));
  }, [definitions, state]);

  const rows = useMemo<CompletionFixtureRow[]>(() => (state?.fixtures ?? []).map((fixture) => {
    const options = buildActivityOptions(definitions, state?.tasks ?? [], fixture.fixture_id);
    const selected = options.find((option) => option.key === selectedActivityByFixture[fixture.fixture_id])
      || latestExistingOption(options);
    return { fixture, options, selected, state: completionState(selected.task) };
  }).filter((row) => row.selected), [definitions, selectedActivityByFixture, state]);

  const sections = useMemo(() => SECTION_STYLES.map((section) => ({
    ...section,
    fixtures: rows
      .filter((row) => row.state === section.key)
      .sort((left, right) => left.fixture.fixture_no.localeCompare(right.fixture.fixture_no, undefined, { numeric: true })),
  })), [rows]);
  const eligibleRows = rows.filter((row) => row.state === "UNASSIGNED" && !row.selected.task);
  const eligibleIds = new Set(eligibleRows.map((row) => row.fixture.fixture_id));
  const selectedRows = rows.filter((row) => selectedFixtureIds.includes(row.fixture.fixture_id) && eligibleIds.has(row.fixture.fixture_id));
  const allEligibleSelected = eligibleRows.length > 0 && selectedRows.length === eligibleRows.length;
  const someEligibleSelected = selectedRows.length > 0 && !allEligibleSelected;
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
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures"] }),
    ]);
  }

  function payloadFor(row: CompletionFixtureRow, supplier?: string): AssignDesign2DCompletionTaskPayload {
    if (!assignedTo || !deadline) throw new Error("Assignee and deadline are required");
    return {
      department_id: effectiveDepartmentId,
      project_id: selectedProjectId,
      fixture_id: row.fixture.fixture_id,
      task_code: row.selected.definition.code as Design2DCompletionTaskCode,
      assigned_to: assignedTo,
      priority,
      deadline: new Date(deadline).toISOString(),
      outsource: Boolean(supplier),
      supplier_name: supplier || undefined,
    };
  }

  const assignmentMutation = useMutation({
    mutationFn: async ({ targets, supplier }: { targets: CompletionFixtureRow[]; supplier?: string }) => {
      if (!targets.length) throw new Error("Select at least one unassigned activity");
      const results = await Promise.allSettled(targets.map((row) => assignDesign2DCompletionTask(payloadFor(row, supplier))));
      return {
        succeeded: results.filter((result) => result.status === "fulfilled").length,
        failures: results.filter((result): result is PromiseRejectedResult => result.status === "rejected"),
      };
    },
    onSuccess: async ({ succeeded, failures }) => {
      await refreshCompletionState();
      setAssignmentTarget(null);
      setBulkPanelOpen(false);
      setOutsourceTargets([]);
      setSelectedFixtureIds([]);
      setSupplierName("");
      toast({
        title: `${succeeded} activit${succeeded === 1 ? "y" : "ies"} assigned`,
        description: failures.length ? `${failures.length} assignment${failures.length === 1 ? "" : "s"} failed.` : undefined,
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
  });

  function activitySelect(row: CompletionFixtureRow) {
    return (
      <Select
        value={row.selected.key}
        onValueChange={(value) => setSelectedActivityByFixture((current) => ({ ...current, [row.fixture.fixture_id]: value }))}
      >
        <SelectTrigger
          className={cn(
            "h-8 min-w-[210px] text-xs",
            row.selected.completed && "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-600",
          )}
          aria-label={`${row.fixture.fixture_no} activity`}
          data-completed={row.selected.completed ? "true" : "false"}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {row.options.map((option) => (
            <SelectItem
              key={option.key}
              value={option.key}
              className={cn(
                option.completed && "bg-emerald-600 text-white focus:bg-emerald-700 focus:text-white",
              )}
              data-completed={option.completed ? "true" : "false"}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  function cardActions(row: CompletionFixtureRow) {
    const task = row.selected.task;
    const ownTask = task?.assigned_to === user?.employee_id || task?.assignee_ids?.includes(user?.employee_id || "");
    const canReview = task?.status === "under_review"
      && task.verification_status === "pending"
      && access.canApproveCompletedTasks
      && (!ownTask || access.canSelfApprove);
    const canTransfer = Boolean(task && !["closed", "cancelled", "under_review"].includes(task.status)
      && (access.canTransferTasks || access.canAssignTasks));
    const canCancel = Boolean(task && !["closed", "cancelled", "under_review"].includes(task.status)
      && (access.canAssignTasks || ownTask));

    return (
      <>
        <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
          {canReview ? (
            <>
              <Button type="button" size="sm" className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ task, action: "approve" })}>APPROVE</Button>
              <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-[11px]" disabled={reviewMutation.isPending} onClick={() => setRejectingTask(task)}>REJECT</Button>
            </>
          ) : canAssign && !task ? (
            <>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setAssignmentTarget(row)}>Assign Now</Button>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setOutsourceTargets([row])}><Factory className="mr-1 h-3 w-3" />Outsource</Button>
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
    const task = row.selected.task;
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
        selectable={canAssign && row.state === "UNASSIGNED"}
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
        {assignmentTarget?.fixture.fixture_id === row.fixture.fixture_id && assignmentTarget.selected.key === row.selected.key ? (
          <div className="mt-2 space-y-3 border-t pt-3">
            <AssignmentFields assignees={assignees} assignedTo={assignedTo} setAssignedTo={setAssignedTo} deadline={deadline} setDeadline={setDeadline} priority={priority} setPriority={setPriority} disabled={assignmentMutation.isPending} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAssignmentTarget(null)}>Cancel</Button>
              <Button type="button" size="sm" disabled={!assignedTo || !deadline || assignmentMutation.isPending} onClick={() => assignmentMutation.mutate({ targets: [row] })}>{assignmentMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Assign</Button>
            </div>
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
              <p className="text-sm font-semibold">Assign {selectedRows.length} selected completion activit{selectedRows.length === 1 ? "y" : "ies"}</p>
              <AssignmentFields assignees={assignees} assignedTo={assignedTo} setAssignedTo={setAssignedTo} deadline={deadline} setDeadline={setDeadline} priority={priority} setPriority={setPriority} disabled={assignmentMutation.isPending} />
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setBulkPanelOpen(false)}>Cancel</Button><Button type="button" size="sm" disabled={!assignedTo || !deadline || assignmentMutation.isPending} onClick={() => assignmentMutation.mutate({ targets: selectedRows })}>Assign All</Button></div>
            </CardContent></Card>
          ) : null}

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
            <AssignmentFields assignees={assignees} assignedTo={assignedTo} setAssignedTo={setAssignedTo} deadline={deadline} setDeadline={setDeadline} priority={priority} setPriority={setPriority} disabled={assignmentMutation.isPending} />
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOutsourceTargets([])}>Cancel</Button><Button type="button" disabled={!supplierName.trim() || !assignedTo || !deadline || assignmentMutation.isPending} onClick={() => assignmentMutation.mutate({ targets: outsourceTargets, supplier: supplierName.trim() })}>{assignmentMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Outsource</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => !open && setRejectingTask(null)}><DialogContent><DialogHeader><DialogTitle>Reject Completion Activity</DialogTitle></DialogHeader><Textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Rejection reason" rows={4} /><DialogFooter><Button type="button" variant="outline" onClick={() => setRejectingTask(null)}>Cancel</Button><Button type="button" variant="destructive" disabled={!rejectingTask || !rejectionReason.trim() || reviewMutation.isPending} onClick={() => rejectingTask && reviewMutation.mutate({ task: rejectingTask, action: "reject", remarks: rejectionReason.trim() })}>Reject</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(transferringTask)} onOpenChange={(open) => !open && setTransferringTask(null)}><DialogContent><DialogHeader><DialogTitle>Transfer Completion Activity</DialogTitle></DialogHeader><div className="space-y-3"><div className="space-y-1.5"><Label>Employee</Label><Select value={transferTo || "__none__"} onValueChange={(value) => setTransferTo(value === "__none__" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger><SelectContent><SelectItem value="__none__">Select employee</SelectItem>{assignees.filter((employee) => employee.employee_id !== transferringTask?.assigned_to).map((employee) => <SelectItem key={employee.employee_id} value={employee.employee_id}>{employee.employee_id} — {employee.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>Reason</Label><Textarea value={transferReason} onChange={(event) => setTransferReason(event.target.value)} rows={3} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setTransferringTask(null)}>Cancel</Button><Button type="button" disabled={!transferTo || !transferReason.trim() || transferMutation.isPending} onClick={() => transferMutation.mutate()}>Transfer</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(cancellingTask)} onOpenChange={(open) => !open && setCancellingTask(null)}><DialogContent><DialogHeader><DialogTitle>Cancel Completion Activity</DialogTitle><DialogDescription>The cancelled revision remains in history and does not change the original fixture workflow.</DialogDescription></DialogHeader><Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Cancellation reason" rows={3} /><DialogFooter><Button type="button" variant="outline" onClick={() => setCancellingTask(null)}>Keep Activity</Button><Button type="button" variant="destructive" disabled={!cancellingTask || !cancellationReason.trim() || cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>Cancel Activity</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}><DialogContent className="max-w-3xl">{previewImage ? <SafeImage src={previewImage} alt="Completion activity proof" className="max-h-[70vh] w-full rounded-md object-contain" /> : null}</DialogContent></Dialog>
    </section>
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
  disabled: boolean;
}

function AssignmentFields({ assignees, assignedTo, setAssignedTo, deadline, setDeadline, priority, setPriority, disabled }: AssignmentFieldsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5"><Label>Assignee</Label><Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}><SelectTrigger disabled={disabled}><SelectValue placeholder="Select assignee" /></SelectTrigger><SelectContent><SelectItem value="__none__">Select assignee</SelectItem>{assignees.map((employee) => <SelectItem key={employee.employee_id} value={employee.employee_id}>{employee.employee_id} — {employee.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Deadline</Label><Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={disabled} /></div>
      <div className="space-y-1.5"><Label>Priority</Label><Select value={priority} onValueChange={(value) => setPriority(value as Priority)}><SelectTrigger disabled={disabled}><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select></div>
    </div>
  );
}
