import { Task } from '@/types';
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
import { hasUserPermission } from '@/lib/permissions';
import { getTaskCardDisplay } from '@/lib/taskDisplay';

interface TaskCardProps {
  task: Task;
  showActions?: boolean;
  compact?: boolean;
}

const API_ROOT = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/api$/, "");

function toProofUrl(path: string) {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_ROOT}${path}`;
}

export function TaskCard({ task, showActions = true, compact = false }: TaskCardProps) {
  const { user } = useAuth();
  const { cancelTask, executeTaskAction } = useTasks();
  const taskDisplay = getTaskCardDisplay(task);
  const isOverdue = new Date(task.deadline) < new Date() && !['closed', 'cancelled'].includes(task.status);
  const isOwnTask = user ? task.assigned_to === user.employee_id || task.assignee_ids?.includes(user.employee_id) : false;
  const canCancel = hasUserPermission(user, 'can_delete_task') && !['closed', 'cancelled'].includes(task.status);
  const proofUrls = task.proof_url ?? [];

  const handleExecutionAction = async (action: "start" | "resume" | "hold" | "submit") => {
    if (action === 'submit' && proofUrls.length === 0) {
      toast({
        title: 'Upload proof first',
        description: 'Open Track -> Proof and upload an image before submitting this task.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await executeTaskAction(task.id, action);
    } catch (error) {
      toast({
        title: 'Task update failed',
        description: error instanceof Error ? error.message : 'Could not update the task',
        variant: 'destructive',
      });
    }
  };

  const handleCancel = async () => {
    try {
      await cancelTask(task.id);
    } catch (error) {
      toast({
        title: 'Task cancellation failed',
        description: error instanceof Error ? error.message : 'Could not cancel the task',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className={cn('transition-all hover:shadow-md', isOverdue && 'border-destructive/40', compact && 'shadow-sm')}>
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
          <StatusChip type="status" value={task.status} />
          {(task.status === 'under_review' || task.status === 'rework' || task.status === 'closed') && (
            <StatusChip type="verification" value={task.verification_status} />
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {task.assignee?.name || 'Unassigned'}
          </span>
          <span className={cn('flex items-center gap-1', isOverdue && 'text-destructive font-medium')}>
            <Calendar className="h-3 w-3" />
            {new Date(task.deadline).toLocaleString()}
          </span>
        </div>

        {!compact && (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {task.customer_name && <span>Customer: {task.customer_name}</span>}
            {(task.scope_name || (task.instance_count !== null && task.instance_count !== undefined)) && (
              <span>
                {task.scope_name || "Scope"}
                {task.instance_count !== null && task.instance_count !== undefined ? ` · Instance ${task.instance_count}` : ""}
              </span>
            )}
            <span>Stage: {task.workflow_stage || "—"}</span>
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
          </div>
        )}

        {task.remarks && (
          <p className="text-xs bg-warning/5 text-warning border border-warning/20 rounded p-2">
            {task.remarks}
          </p>
        )}

        {!compact && proofUrls.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            {proofUrls.map((url, i) => (
              <a
                key={i}
                href={toProofUrl(url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                View Proof {i + 1}
              </a>
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
            <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => { handleCancel().catch(() => undefined); }}>
              <Ban className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
