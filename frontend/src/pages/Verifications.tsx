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
import { CheckCircle2, XCircle, Calendar, User, FileText, Layers3 } from 'lucide-react';
import { getTaskCardDisplay } from '@/lib/taskDisplay';
import { taskQueryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { SafeImage } from '@/components/SafeImage';
import { resolveImageUrl } from '@/lib/imageUrl';
import { formatEmployeeDisplay } from '@/lib/employeeDisplay';
import type { Task } from '@/types';

function formatRevisionCode(task: Task) {
  const stage = task.workflow_stage;
  if (!stage) return null;
  const stageAbbrev = stage.replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase() || stage.slice(0, 3).toUpperCase();
  const rev = task.fixture_revision_no ?? 0;
  const ver = task.workflow_stage_version ?? 0;
  return `${stageAbbrev} ${String(rev).padStart(2, '0')}${ver > 0 ? `.${ver}` : ''}`;
}

function workflowStatusLabel(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case 'IN_PROGRESS': return 'In Progress';
    case 'PENDING': return 'Pending';
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    default: return status || 'Unknown';
  }
}

function workflowStatusColor(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case 'IN_PROGRESS': return 'border-sky-300 bg-sky-50 text-sky-800';
    case 'PENDING': return 'border-amber-300 bg-amber-50 text-amber-800';
    case 'APPROVED': return 'border-emerald-300 bg-emerald-50 text-emerald-800';
    case 'REJECTED': return 'border-red-300 bg-red-50 text-red-800';
    default: return 'border-slate-300 bg-slate-50 text-slate-700';
  }
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

  const pending = (verificationQuery.data ?? [])
    .filter(task => task.assigned_to !== user?.employee_id)
    .filter(t => t.verification_status !== 'quality_pending' || access.canApproveQuality);

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
            const revisionCode = formatRevisionCode(task);
            const proofUrl = task.latest_proof?.file_url || task.proof_url?.[task.proof_url.length - 1] || null;
            const resolvedProofUrl = resolveImageUrl(proofUrl);

            const handleVerify = async (action: 'approve' | 'reject') => {
              try {
                await verifyTask(task.id, action, remarks[task.id]);
              } catch (error) {
                toast({
                  title: 'Verification not saved',
                  description: error instanceof Error ? error.message : 'Task is not in verification state.',
                  variant: 'destructive',
                });
              }
            };

            return (
              <Card key={task.id} className="animate-fade-in">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <h3 className="font-medium">{taskDisplay.title}</h3>
                      {taskDisplay.subtitle && (
                        <p className="text-sm text-muted-foreground">{taskDisplay.subtitle}</p>
                      )}

                      {/* ── Operational approval context ─────────────────── */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {task.fixture_no && (
                          <Badge variant="outline" className="text-xs font-medium">
                            Fixture {task.fixture_no}
                          </Badge>
                        )}
                        {task.part_name && (
                          <Badge variant="outline" className="text-xs font-medium">
                            {task.part_name}
                          </Badge>
                        )}
                      </div>

                      {task.workflow_stage && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold text-xs gap-1">
                            <Layers3 className="h-3 w-3" />
                            {task.workflow_stage}
                            {revisionCode && <span className="ml-1 opacity-75">— {revisionCode}</span>}
                          </Badge>
                          {task.workflow_status && (
                            <Badge variant="outline" className={cn("text-xs font-medium", workflowStatusColor(task.workflow_status))}>
                              {workflowStatusLabel(task.workflow_status)}
                            </Badge>
                          )}
                          <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-800 text-xs">
                            Approval: {task.verification_status.replace(/_/g, ' ')}
                          </Badge>
                          {(task.fixture_revision_no ?? 0) > 0 && (
                            <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800 text-xs">
                              Rev {task.fixture_revision_no}
                            </Badge>
                          )}
                        </div>
                      )}

                      <p className="text-sm text-muted-foreground">{task.description}</p>
                    </div>
                    <StatusChip type="priority" value={task.priority} />
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Assignee: {task.assignee ? formatEmployeeDisplay(task.assignee) : formatEmployeeDisplay(task.assigned_to)}
                    </span>
                    {task.workflow_contributor_names && (
                      <span className="flex items-center gap-1">Contributors: {task.workflow_contributor_names}</span>
                    )}
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Submitted {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : '—'}</span>
                    {task.proof_url?.length ? <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{task.proof_url.length} proof file(s)</span> : null}
                    {task.requires_quality_approval && <span>Quality approval required</span>}
                  </div>
                  {task.proof_url?.length ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {resolvedProofUrl ? (
                        <a href={resolvedProofUrl} target="_blank" rel="noopener noreferrer" className="block h-20 w-28 overflow-hidden rounded-md border bg-slate-50">
                          <SafeImage src={proofUrl} alt="Work proof" className="h-full w-full object-cover" />
                        </a>
                      ) : (
                        <SafeImage src={proofUrl} alt="Work proof" className="h-20 w-28" />
                      )}
                      <div className="text-muted-foreground">
                        <p className="font-medium text-foreground">Work proof</p>
                        <p>{task.latest_proof?.uploaded_at ? new Date(task.latest_proof.uploaded_at).toLocaleString() : "Upload time unavailable"}</p>
                        <p>{formatEmployeeDisplay(task.latest_proof?.uploaded_by || null, task.latest_proof?.uploaded_by_name)}</p>
                      </div>
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
