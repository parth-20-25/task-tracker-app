import { Task } from '@/types';
import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusChip } from './StatusChip';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { toast } from '@/hooks/use-toast';
import { Calendar, User, PlayCircle, CheckCircle2, RotateCcw, MapPin, Timer, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDurationMinutes } from '@/lib/formatDuration';
import { TaskExecutionDialog } from '@/components/TaskExecutionDialog';
import { isOperationalControllerUser, isProjectAuthorityUser } from '@/lib/permissions';
import { formatEmployeeDisplay } from '@/lib/employeeDisplay';
import { getTaskCardDisplay } from '@/lib/taskDisplay';
import { resolveImageUrl } from '@/lib/imageUrl';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface TaskCardProps {
  task: Task;
  showActions?: boolean;
  compact?: boolean;
  extraActions?: ReactNode;
  onActionComplete?: () => void | Promise<void>;
}

function isDapTask(task: Task) {
  const normalized = String(task.workflow_stage || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized === "dap" || normalized === "d_a_p";
}

export function TaskCard({ task, showActions = true, compact = false, extraActions, onActionComplete }: TaskCardProps) {
  const { user } = useAuth();
  const { cancelTask, executeTaskAction } = useTasks();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const taskDisplay = getTaskCardDisplay(task);
  const isOverdue = new Date(task.deadline) < new Date() && !['closed', 'cancelled'].includes(task.status);
  const isOwnTask = user ? task.assigned_to === user.employee_id || task.assignee_ids?.includes(user.employee_id) : false;
  const isOriginalAssigner = Boolean(user?.employee_id && user.employee_id === task.assigned_by);
  const taskCompletion = Number(task.completion_percent ?? 0);
  const canCancel = Boolean(user)
    && task.status === 'assigned'
    && taskCompletion === 0
    && task.verification_status !== 'approved'
    && !task.approved_at
    && task.operational_state !== 'WORKFLOW_COMPLETE'
    && (isOperationalControllerUser(user) || isProjectAuthorityUser(user) || isOriginalAssigner);
  const proofUrls = task.proof_url ?? [];
  const isCompletionTask = task.task_type === 'design_2d_completion';
  const isCompletedRevision = isCompletionTask
    && task.status === 'closed'
    && task.verification_status === 'approved';

  const handleExecutionAction = async (action: "start" | "resume" | "hold" | "submit") => {
    if (action === 'submit' && proofUrls.length === 0 && !isDapTask(task)) {
      toast({
        title: 'Work proof required',
        description: 'Upload proof or a work file before verification submission',
        variant: 'destructive',
      });
      return;
    }

    try {
      await executeTaskAction(task.id, action);
      await onActionComplete?.();
    } catch (error) {
      toast({
        title: 'Task update failed',
        description: error instanceof Error ? error.message : 'Could not update the task',
        variant: 'destructive',
      });
    }
  };

  const handleCancel = async () => {
    const reason = cancelReason.trim();
    if (!reason) {
      toast({
        title: 'Cancellation reason required',
        description: 'Add a reason before cancelling this task.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsCancelling(true);
      await cancelTask(task.id, reason);
      await onActionComplete?.();
      setCancelDialogOpen(false);
      setCancelReason('');
      toast({
        title: 'Task cancelled',
        description: task.task_type === 'additional_design'
          ? 'The additional design task was cancelled.'
          : isCompletionTask
            ? 'The completion task revision was cancelled and remains in history.'
          : 'The fixture is back in Unassigned.',
      });
    } catch (error) {
      toast({
        title: 'Task cancellation failed',
        description: error instanceof Error ? error.message : 'Could not cancel the task',
        variant: 'destructive',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <>
    <Card className={cn(
      'transition-all hover:shadow-md',
      isOverdue && 'border-destructive/40',
      compact && 'shadow-sm',
      isCompletedRevision && 'border-success/40 bg-success/5',
    )}>
      <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm leading-tight truncate">{taskDisplay.title}</h4>
          {taskDisplay.subtitle && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{taskDisplay.subtitle}</p>
          )}
          {!compact && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
        </div>
        <StatusChip type="priority" value={task.priority} />
      </CardHeader>
      <CardContent className="p-4 pt-2 space-y-3">
        <div className="flex flex-wrap gap-2">
          {isCompletionTask && task.status === 'under_review' ? (
            <span className="status-chip bg-warning/10 text-warning">Pending Approval</span>
          ) : isCompletionTask && task.status === 'rework' ? (
            <span className="status-chip bg-destructive/10 text-destructive">Changes Required</span>
          ) : isCompletedRevision ? (
            <span className="status-chip bg-success/10 text-success">Completed</span>
          ) : (
            <StatusChip type="status" value={task.status} />
          )}
          {(task.status === 'under_review' || task.status === 'rework' || task.status === 'closed') && (
            <StatusChip type="verification" value={task.verification_status} />
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Completion</span>
            <span className="font-medium text-foreground">{task.completion_percent ?? 0}%</span>
          </div>
          <Progress value={task.completion_percent ?? 0} className="h-2" />
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {task.assignee_names || (task.assignee ? formatEmployeeDisplay(task.assignee) : formatEmployeeDisplay(task.assigned_to))}
          </span>
          <span className={cn('flex items-center gap-1', isOverdue && 'text-destructive font-medium')}>
            <Calendar className="h-3 w-3" />
            {new Date(task.deadline).toLocaleString()}
          </span>
        </div>

        {!compact && (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {task.customer_name && <span>Customer: {task.customer_name}</span>}
            {(task.project_name || (task.instance_count !== null && task.instance_count !== undefined)) && (
              <span>
                {task.project_name || "Project"}
                {task.instance_count !== null && task.instance_count !== undefined ? ` · Instance ${task.instance_count}` : ""}
              </span>
            )}
            <span>
              {task.task_type === 'additional_design'
                ? `Team: ${task.design_team || "—"}`
                : isCompletionTask
                  ? `Scope: ${task.scope_type === 'project' ? 'Project-level' : 'Fixture-level'}`
                : `Stage: ${task.workflow_stage || "—"}`}
            </span>
            {task.assigner && <span>Assigned by: {formatEmployeeDisplay(task.assigner)}</span>}
            {task.rework_date && <span>Rework: {new Date(task.rework_date).toLocaleDateString("en-GB")}</span>}
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatDurationMinutes(task.actual_minutes)}/{formatDurationMinutes(task.planned_minutes)}
            </span>
            {(task.machine_name || task.location_tag) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {task.machine_name || task.location_tag}
              </span>
            )}
            {task.requires_quality_approval && <span>Quality approval required</span>}
            {task.completion_task_outsource_supplier && <span>Outsourced to: {task.completion_task_outsource_supplier}</span>}
          </div>
        )}

        {task.remarks && (
          <p className="text-xs bg-warning/5 text-warning border border-warning/20 rounded p-2">
            {task.remarks}
          </p>
        )}

        {task.completion_task_not_required_at && (
          <p className="text-xs rounded border border-success/20 bg-success/5 p-2 text-success">
            Not Required — {task.completion_task_not_required_reason}
          </p>
        )}

        {!compact && proofUrls.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            {proofUrls.map((url, i) => (
              resolveImageUrl(url) ? (
                <a
                  key={i}
                  href={resolveImageUrl(url) || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  View Proof {i + 1}
                </a>
              ) : null
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1 flex-wrap">
          <TaskExecutionDialog task={task} />
          {showActions && isOwnTask && (
            <>
            {(task.status === 'assigned' || task.status === 'rework') && (
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { handleExecutionAction(task.status === 'rework' ? 'resume' : 'start').catch(() => undefined); }}>
                {task.status === 'rework' ? <RotateCcw className="h-3.5 w-3.5 mr-1" /> : <PlayCircle className="h-3.5 w-3.5 mr-1" />}
                {task.status === 'rework' ? 'Resume Rework' : 'Start'}
              </Button>
            )}
            {task.status === 'in_progress' && (
              <>
                <Button size="sm" className="text-xs h-7" onClick={() => { handleExecutionAction('submit').catch(() => undefined); }}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Submit
                </Button>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { handleExecutionAction('hold').catch(() => undefined); }}>
                  On Hold
                </Button>
              </>
            )}
            {task.status === 'on_hold' && (
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { handleExecutionAction('resume').catch(() => undefined); }}>
                <PlayCircle className="h-3.5 w-3.5 mr-1" /> Resume
              </Button>
            )}
            </>
          )}
          {showActions && canCancel && (
            <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => setCancelDialogOpen(true)}>
              <Ban className="h-3.5 w-3.5 mr-1" /> Cancel Task
            </Button>
          )}
          {extraActions}
        </div>
      </CardContent>
    </Card>
    <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`cancel-reason-${task.id}`}>Reason</Label>
          <Textarea
            id={`cancel-reason-${task.id}`}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Why is this task being cancelled?"
            className="min-h-24"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={isCancelling}>
            Keep Task
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => { handleCancel().catch(() => undefined); }}
            disabled={isCancelling || !cancelReason.trim()}
          >
            {isCancelling ? 'Cancelling...' : 'Cancel Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
