import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignDesign2DCompletionTask,
  fetchDesign2DCompletionProjects,
  fetchDesign2DCompletionProjectState,
  fetchRecentOutsourceSuppliers,
  markDesign2DMimicNotRequired,
  type AssignDesign2DCompletionTaskPayload,
  type Design2DCompletionTaskCode,
  type Design2DCompletionTaskDefinition,
} from "@/api/designApi";
import { fetchTaskAssignmentUsers, transferTask, updateTask } from "@/api/taskApi";
import { TaskCard } from "@/components/TaskCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { taskQueryKeys } from "@/lib/queryKeys";
import { isOperationalControllerUser } from "@/lib/permissions";
import { formatProjectNumber } from "@/lib/projectDisplay";
import type { Priority, Task } from "@/types";
import { ArrowRightLeft, CheckCircle2, FolderOpen, Loader2, Lock, XCircle } from "lucide-react";

function defaultDeadline() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function latestTask(tasks: Task[], code: string, fixtureId: string | null) {
  return tasks
    .filter((task) => task.completion_task_code === code && (task.fixture_id || null) === fixtureId)
    .sort((left, right) => Number(right.completion_task_revision) - Number(left.completion_task_revision))[0];
}

interface Design2DCompletionTasksProps {
  departmentId?: string | null;
}

export function Design2DCompletionTasks({ departmentId }: Design2DCompletionTasksProps) {
  const queryClient = useQueryClient();
  const { user, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedFixtureId, setSelectedFixtureId] = useState("");
  const [selectedTaskCode, setSelectedTaskCode] = useState<Design2DCompletionTaskCode>("FIXTURE_DRAFTING_CHECKING");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [outsourceOpen, setOutsourceOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [transferringTask, setTransferringTask] = useState<Task | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [notRequiredOpen, setNotRequiredOpen] = useState(false);
  const [notRequiredReason, setNotRequiredReason] = useState("");

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
  const assigneesQuery = useQuery({
    queryKey: ["task-assignment", "design-2d-completion", selectedProjectId, effectiveDepartmentId],
    queryFn: () => fetchTaskAssignmentUsers({
      task_type: "department_workflow",
      department_id: effectiveDepartmentId,
      project_id: selectedProjectId,
      stage_name: "2D Finish",
    }),
    enabled: Boolean(selectedProjectId && effectiveDepartmentId && access.canAssignTasks),
  });
  const suppliersQuery = useQuery({
    queryKey: ["design", "outsource-suppliers", effectiveDepartmentId],
    queryFn: () => fetchRecentOutsourceSuppliers(effectiveDepartmentId),
    enabled: outsourceOpen,
  });
  const assignees = assigneesQuery.data ?? [];

  const definitions = useMemo(
    () => [...(state?.fixture_task_types ?? []), ...(state?.project_task_types ?? [])],
    [state],
  );
  const selectedDefinition = definitions.find((definition) => definition.code === selectedTaskCode);
  const assignmentLocked = selectedDefinition?.scope === "project" && state?.project_tasks_unlocked !== true;
  const canAssign = access.canAssignTasks && access.canCreateTasks;
  const canMarkNotRequired = canAssign
    && access.canApproveCompletedTasks
    && isOperationalControllerUser(user);

  useEffect(() => {
    setSelectedProjectId("");
  }, [departmentId]);

  useEffect(() => {
    setSelectedFixtureId(state?.fixtures[0]?.fixture_id || "");
    setAssignedTo("");
  }, [state?.project.project_id]);

  async function refreshCompletionState() {
    await Promise.all([
      stateQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
    ]);
  }

  function assignmentPayload(fixtureId = selectedFixtureId, supplier?: string): AssignDesign2DCompletionTaskPayload | null {
    if (!state || !selectedDefinition || !assignedTo || !deadline || assignmentLocked) {
      return null;
    }
    if (selectedDefinition.scope === "fixture" && !fixtureId) {
      return null;
    }
    return {
      department_id: effectiveDepartmentId,
      project_id: state.project.project_id,
      fixture_id: selectedDefinition.scope === "fixture" ? fixtureId : null,
      task_code: selectedDefinition.code,
      assigned_to: assignedTo,
      priority,
      deadline: new Date(deadline).toISOString(),
      outsource: Boolean(supplier),
      supplier_name: supplier || undefined,
    };
  }

  const assignMutation = useMutation({
    mutationFn: (payload: AssignDesign2DCompletionTaskPayload) => assignDesign2DCompletionTask(payload),
    onSuccess: async (task) => {
      await refreshCompletionState();
      setOutsourceOpen(false);
      setSupplierName("");
      toast({ title: "Task assigned", description: task.title });
    },
    onError: (error) => toast({
      title: "Assignment failed",
      description: error instanceof Error ? error.message : "Could not assign the task.",
      variant: "destructive",
    }),
  });

  const assignAllMutation = useMutation({
    mutationFn: async () => {
      if (!state || selectedDefinition?.scope !== "fixture") {
        throw new Error("Assign All is available only for fixture-level tasks");
      }
      const candidates = state.fixtures.filter((fixture) => {
        const current = latestTask(state.tasks, selectedDefinition.code, fixture.fixture_id);
        return !current || ["closed", "cancelled"].includes(current.status);
      });
      if (!candidates.length) {
        throw new Error("No fixture is available for a new revision");
      }
      const results = await Promise.allSettled(candidates.map((fixture) => {
        const payload = assignmentPayload(fixture.fixture_id);
        if (!payload) {
          throw new Error("Assignee, deadline and priority are required");
        }
        return assignDesign2DCompletionTask(payload);
      }));
      return {
        assigned: results.filter((result) => result.status === "fulfilled").length,
        failed: results.filter((result) => result.status === "rejected").length,
      };
    },
    onSuccess: async ({ assigned, failed }) => {
      await refreshCompletionState();
      toast({
        title: `Assigned ${assigned} fixture task${assigned === 1 ? "" : "s"}`,
        description: failed ? `${failed} fixture assignment${failed === 1 ? "" : "s"} failed.` : "Assign All completed.",
        variant: failed ? "destructive" : "default",
      });
    },
    onError: (error) => toast({
      title: "Assign All failed",
      description: error instanceof Error ? error.message : "Could not assign fixture tasks.",
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
      toast({ title: variables.action === "approve" ? "Task approved" : "Changes required" });
    },
    onError: (error) => toast({
      title: "Review failed",
      description: error instanceof Error ? error.message : "Could not review the task.",
      variant: "destructive",
    }),
  });

  const transferMutation = useMutation({
    mutationFn: ({ task, employeeId, reason }: { task: Task; employeeId: string; reason: string }) =>
      transferTask(task.id, {
        transfer_to: employeeId,
        transfer_reason: reason,
        completion_percent: task.completion_percent || 0,
      }),
    onSuccess: async () => {
      await refreshCompletionState();
      setTransferringTask(null);
      setTransferTo("");
      setTransferReason("");
      toast({ title: "Task transferred" });
    },
    onError: (error) => toast({
      title: "Transfer failed",
      description: error instanceof Error ? error.message : "Could not transfer the task.",
      variant: "destructive",
    }),
  });

  const notRequiredMutation = useMutation({
    mutationFn: () => markDesign2DMimicNotRequired({
      project_id: selectedProjectId,
      department_id: effectiveDepartmentId,
      reason: notRequiredReason.trim(),
    }),
    onSuccess: async (task) => {
      await refreshCompletionState();
      setNotRequiredOpen(false);
      setNotRequiredReason("");
      toast({ title: "Mimic marked Not Required", description: task.title });
    },
    onError: (error) => toast({
      title: "Could not mark Mimic Not Required",
      description: error instanceof Error ? error.message : "Request failed.",
      variant: "destructive",
    }),
  });

  function chooseAssignment(definition: Design2DCompletionTaskDefinition, fixtureId: string | null) {
    setSelectedTaskCode(definition.code);
    setSelectedFixtureId(fixtureId || "");
  }

  function taskExtraActions(task: Task) {
    const ownTask = task.assigned_to === user?.employee_id || task.assignee_ids?.includes(user?.employee_id || "");
    const canReview = task.status === "under_review"
      && task.verification_status === "pending"
      && access.canApproveCompletedTasks
      && (!ownTask || access.canSelfApprove);
    const canTransfer = !["closed", "cancelled", "under_review"].includes(task.status)
      && (access.canTransferTasks || access.canAssignTasks);

    return (
      <>
        {canReview ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-7 bg-success text-xs hover:bg-success/90"
              disabled={reviewMutation.isPending}
              onClick={() => reviewMutation.mutate({ task, action: "approve" })}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              disabled={reviewMutation.isPending}
              onClick={() => setRejectingTask(task)}
            >
              <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
          </>
        ) : null}
        {canTransfer ? (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTransferringTask(task)}>
            <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Transfer
          </Button>
        ) : null}
      </>
    );
  }

  function renderTaskType(definition: Design2DCompletionTaskDefinition, fixtureId: string | null) {
    if (!state) {
      return null;
    }
    const revisions = state.tasks.filter(
      (task) => task.completion_task_code === definition.code && (task.fixture_id || null) === fixtureId,
    );
    const locked = definition.scope === "project" && !state.project_tasks_unlocked;
    return (
      <div key={`${fixtureId || "project"}-${definition.code}`} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{definition.displayName}</h4>
            {definition.scope === "project" ? <Badge variant="outline">Project-level task</Badge> : null}
          </div>
          <div className="flex gap-2">
            {definition.code === "PROJECT_MIMIC" && canMarkNotRequired && !locked ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setNotRequiredOpen(true)}>
                Not Required
              </Button>
            ) : null}
            {canAssign && !locked ? (
              <Button type="button" size="sm" variant="outline" onClick={() => chooseAssignment(definition, fixtureId)}>
                Assign Now
              </Button>
            ) : null}
          </div>
        </div>
        {locked ? (
          <Card className="border-dashed">
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Lock className="h-4 w-4" /> Locked until all fixture-level task revisions are approved.
            </CardContent>
          </Card>
        ) : revisions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <span className="text-sm text-muted-foreground">Unassigned</span>
              <Badge variant="outline">Revision 00</Badge>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {revisions.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                extraActions={taskExtraActions(task)}
                onActionComplete={refreshCompletionState}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const assignmentReady = Boolean(
    assignmentPayload()
    && canAssign
    && !assignMutation.isPending
    && !assignAllMutation.isPending,
  );

  return (
    <section className="space-y-3" aria-labelledby="design-2d-completion-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary" />
          <h2 id="design-2d-completion-heading" className="text-lg font-semibold">2D Completion Tasks</h2>
        </div>
        <Select
          value={selectedProjectId || "__none__"}
          onValueChange={(value) => setSelectedProjectId(value === "__none__" ? "" : value)}
        >
          <SelectTrigger className="h-9 w-[260px] text-sm" aria-label="2D Completion Tasks project">
            <SelectValue placeholder="Select a project…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Select a project…</SelectItem>
            {(projectsQuery.data ?? []).map((project) => (
              <SelectItem key={project.project_id} value={project.project_id}>
                {formatProjectNumber(project)} — {project.project_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedProjectId ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Select a project with at least one completed original 2D fixture stage.
          </CardContent>
        </Card>
      ) : stateQuery.isLoading ? (
        <Card><CardContent className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
      ) : state ? (
        <>
          <Card>
            <CardHeader className="p-4 pb-2">
              <h3 className="font-semibold">Assignment</h3>
              <p className="text-sm text-muted-foreground">Fixture and project task revisions use the existing task lifecycle.</p>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-2 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1.5">
                <Label>Task</Label>
                <Select value={selectedTaskCode} onValueChange={(value) => setSelectedTaskCode(value as Design2DCompletionTaskCode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {definitions.map((definition) => (
                      <SelectItem key={definition.code} value={definition.code}>
                        {definition.scope === "project" ? "Project" : "Fixture"} — {definition.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fixture</Label>
                <Select
                  value={selectedFixtureId || "__none__"}
                  disabled={selectedDefinition?.scope === "project"}
                  onValueChange={(value) => setSelectedFixtureId(value === "__none__" ? "" : value)}
                >
                  <SelectTrigger><SelectValue placeholder={selectedDefinition?.scope === "project" ? "Project-level" : "Select fixture"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select fixture</SelectItem>
                    {state.fixtures.map((fixture) => (
                      <SelectItem key={fixture.fixture_id} value={fixture.fixture_id}>{fixture.fixture_no}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="Select assignee" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>No assignee selected</SelectItem>
                    {assignees.map((assignee) => (
                      <SelectItem key={assignee.employee_id} value={assignee.employee_id}>
                        {assignee.employee_id} — {assignee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Deadline</Label>
                <Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["low", "medium", "high", "critical"] as Priority[]).map((value) => (
                      <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-5">
                <Button
                  type="button"
                  disabled={!assignmentReady}
                  onClick={() => {
                    const payload = assignmentPayload();
                    if (payload) assignMutation.mutate(payload);
                  }}
                >
                  Assign Now
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!assignmentReady || selectedDefinition?.scope !== "fixture"}
                  onClick={() => assignAllMutation.mutate()}
                >
                  Assign All
                </Button>
                <Button type="button" variant="outline" disabled={!assignmentReady} onClick={() => setOutsourceOpen(true)}>
                  Outsource
                </Button>
                {assignmentLocked ? <span className="self-center text-sm text-muted-foreground">Project-level tasks are locked.</span> : null}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <h3 className="text-base font-semibold">Fixture-level tasks</h3>
            {state.fixtures.map((fixture) => (
              <Card key={fixture.fixture_id}>
                <CardHeader className="p-4 pb-2">
                  <h4 className="font-semibold">{fixture.fixture_no}</h4>
                  <p className="text-sm text-muted-foreground">{fixture.part_name}</p>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-2">
                  {state.fixture_task_types.map((definition) => renderTaskType(definition, fixture.fixture_id))}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="p-4 pb-2">
              <h3 className="font-semibold">Project-level tasks</h3>
              <p className="text-sm text-muted-foreground">These tasks belong once to the complete project and have no fixture ID.</p>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-2">
              {state.project_task_types.map((definition) => renderTaskType(definition, null))}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card><CardContent className="p-8 text-center text-sm text-destructive">Could not load 2D completion tasks.</CardContent></Card>
      )}

      <Dialog open={outsourceOpen} onOpenChange={setOutsourceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Outsource 2D Completion Task</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Supplier name" />
            </div>
            {(suppliersQuery.data ?? []).length ? (
              <div className="flex flex-wrap gap-2">
                {(suppliersQuery.data ?? []).map((supplier) => (
                  <Button key={supplier} type="button" size="sm" variant="outline" onClick={() => setSupplierName(supplier)}>{supplier}</Button>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOutsourceOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={!supplierName.trim() || assignMutation.isPending}
              onClick={() => {
                const payload = assignmentPayload(selectedFixtureId, supplierName.trim());
                if (payload) assignMutation.mutate(payload);
              }}
            >
              Confirm Outsource
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => !open && setRejectingTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Task Submission</DialogTitle></DialogHeader>
          <Textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Mandatory rejection reason" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectingTask(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectingTask || !rejectionReason.trim() || reviewMutation.isPending}
              onClick={() => rejectingTask && reviewMutation.mutate({ task: rejectingTask, action: "reject", remarks: rejectionReason.trim() })}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transferringTask)} onOpenChange={(open) => !open && setTransferringTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Task</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={transferTo || "__none__"} onValueChange={(value) => setTransferTo(value === "__none__" ? "" : value)}>
              <SelectTrigger><SelectValue placeholder="Transfer to" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>Select employee</SelectItem>
                {assignees.filter((assignee) => assignee.employee_id !== transferringTask?.assigned_to).map((assignee) => (
                  <SelectItem key={assignee.employee_id} value={assignee.employee_id}>{assignee.employee_id} — {assignee.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="Transfer reason" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransferringTask(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!transferringTask || !transferTo || !transferReason.trim() || transferMutation.isPending}
              onClick={() => transferringTask && transferMutation.mutate({ task: transferringTask, employeeId: transferTo, reason: transferReason.trim() })}
            >
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notRequiredOpen} onOpenChange={setNotRequiredOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Mimic Not Required</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea value={notRequiredReason} onChange={(event) => setNotRequiredReason(event.target.value)} placeholder="Mandatory reason" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNotRequiredOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={!notRequiredReason.trim() || notRequiredMutation.isPending}
              onClick={() => notRequiredMutation.mutate()}
            >
              Mark Not Required
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
