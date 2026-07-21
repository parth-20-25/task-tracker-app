import { useId } from "react";
import type { Task } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { getTaskCardDisplay } from "@/lib/taskDisplay";

interface TaskCancelDialogProps {
  open: boolean;
  tasks: Task[];
  reason: string;
  isPending: boolean;
  onReasonChange: (reason: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function formatStatus(value?: string | null) {
  return String(value || "-")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function taskAssignee(task: Task) {
  if (task.assignee_names) return task.assignee_names;
  if (task.assignee) return formatEmployeeDisplay(task.assignee);
  return formatEmployeeDisplay(task.assigned_to || task.assigned_user_id || null);
}

function taskProject(task: Task) {
  return task.project_name || task.project_no || task.project_code || "-";
}

export function TaskCancelDialog({
  open,
  tasks,
  reason,
  isPending,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: TaskCancelDialogProps) {
  const reasonId = useId();
  const visibleTasks = tasks.filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isPending && onOpenChange(nextOpen)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{visibleTasks.length > 1 ? "Cancel Tasks" : "Cancel Task"}</DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel this task? The assignment will be removed, but the task history will remain available.
          </DialogDescription>
        </DialogHeader>

        {visibleTasks.length ? (
          <div className="max-h-72 space-y-3 overflow-auto rounded-md border bg-slate-50 p-3 text-sm">
            {visibleTasks.map((task) => {
              const display = getTaskCardDisplay(task);
              return (
                <dl key={task.id} className="grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]">
                  <dt className="font-medium text-muted-foreground">Task name</dt>
                  <dd>{display.title || task.title}</dd>
                  <dt className="font-medium text-muted-foreground">Project</dt>
                  <dd>{taskProject(task)}</dd>
                  {task.fixture_no ? (
                    <>
                      <dt className="font-medium text-muted-foreground">Fixture</dt>
                      <dd>{task.fixture_no}</dd>
                    </>
                  ) : null}
                  <dt className="font-medium text-muted-foreground">Assigned employee</dt>
                  <dd>{taskAssignee(task)}</dd>
                  <dt className="font-medium text-muted-foreground">Current status</dt>
                  <dd>{formatStatus(task.status)}</dd>
                </dl>
              );
            })}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={reasonId}>Cancellation reason</Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Task assigned by mistake"
            className="min-h-24"
            disabled={isPending}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Keep Task
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={!visibleTasks.length || !reason.trim() || isPending}>
            Cancel Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}