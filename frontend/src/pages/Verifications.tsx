import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVerificationTasks } from '@/api/taskApi';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/StatusChip';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, Calendar, User, FileText, Layers } from 'lucide-react';
import { getTaskCardDisplay } from '@/lib/taskDisplay';
import { taskQueryKeys } from '@/lib/queryKeys';
import { API_ROOT_URL } from '@/api/config';
import {
  formatStageRevisionCode,
  getWorkflowStageDisplayLabel,
  getWorkflowStatusLabel,
} from '@/lib/workflowStageDisplay';

function toProofUrl(path: string) {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_ROOT_URL}${path}`;
}

export default function Verifications() {
  const { user, access } = useAuth();
  const { verifyTask } = useTasks();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const verificationQuery = useQuery({
    queryKey: taskQueryKeys.verificationQueue,
    queryFn: fetchVerificationTasks,
    enabled: !!user?.employee_id,
  });

  const pending = (verificationQuery.data ?? []).filter(task => task.assigned_to !== user?.employee_id).filter(t =>
    t.status === 'under_review' &&
    (t.verification_status === 'pending' || t.verification_status === 'quality_pending') &&
    (access.canViewAllTasks || t.department_id === user?.department_id)
  ).filter(t =>
    t.verification_status !== 'quality_pending' || access.canApproveQuality
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Verification Queue</h1>
      <p className="text-sm text-muted-foreground">{pending.length} task(s) awaiting review</p>

      {pending.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>All caught up! No pending verifications.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map(task => {
            const taskDisplay = getTaskCardDisplay(task);
            const stageLabel = getWorkflowStageDisplayLabel(task.workflow_stage);
            const revisionCode = task.workflow_revision_code
              || formatStageRevisionCode(task.workflow_stage, task.workflow_stage_version ?? 0);
            const statusLabel = getWorkflowStatusLabel(task.workflow_status);
            const hasWorkflowContext = Boolean(stageLabel || revisionCode || statusLabel);

            const handleVerify = async (action: 'approve' | 'reject') => {
              try {
                await verifyTask(task.id, action, remarks[task.id]);
              } catch (error) {
                toast({
                  title: 'Verification failed',
                  description: error instanceof Error ? error.message : 'Could not update verification',
                  variant: 'destructive',
                });
              }
            };

            return (
              <Card key={task.id} className="animate-fade-in">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {hasWorkflowContext ? (
                        <div
                          data-testid="verification-stage-banner"
                          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                        >
                          <Layers className="h-4 w-4 text-primary" />
                          {stageLabel && (
                            <span
                              data-testid="verification-stage-label"
                              className="text-sm font-semibold uppercase tracking-wide text-primary"
                            >
                              {stageLabel}
                            </span>
                          )}
                          {revisionCode && (
                            <>
                              <span aria-hidden="true" className="text-primary/40">—</span>
                              <span
                                data-testid="verification-revision-code"
                                className="text-sm font-semibold uppercase tracking-wide text-primary"
                              >
                                {revisionCode}
                              </span>
                            </>
                          )}
                          {statusLabel && (
                            <Badge
                              data-testid="verification-workflow-status"
                              variant="outline"
                              className="border-primary/40 bg-background text-xs font-medium uppercase tracking-wide text-primary"
                            >
                              {statusLabel}
                            </Badge>
                          )}
                        </div>
                      ) : null}
                      <h3 className="font-medium">{taskDisplay.title}</h3>
                      {taskDisplay.subtitle && (
                        <p className="text-sm text-muted-foreground mt-1">{taskDisplay.subtitle}</p>
                      )}
                      <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                    </div>
                    <StatusChip type="priority" value={task.priority} />
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{task.assignee?.name}</span>
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Submitted {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : '—'}</span>
                    {task.proof_url?.length ? <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{task.proof_url.length} proof file(s)</span> : null}
                    {task.requires_quality_approval && <span>Quality approval required</span>}
                  </div>
                  {task.proof_url?.length ? (
                    <div className="flex flex-wrap gap-3 text-xs">
                      {task.proof_url.map((url, i) => (
                        <a key={i} href={toProofUrl(url)} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                          View Proof {i + 1}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <Textarea
                    placeholder="Add remarks (optional for approval, required for rejection)..."
                    className="text-sm"
                    rows={2}
                    value={remarks[task.id] || ''}
                    onChange={e => setRemarks(prev => ({ ...prev, [task.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { handleVerify('approve').catch(() => undefined); }}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => {
                      if (!remarks[task.id]?.trim()) return;
                      handleVerify('reject').catch(() => undefined);
                    }}>
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
