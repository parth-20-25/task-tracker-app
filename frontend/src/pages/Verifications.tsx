import { useState } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/StatusChip';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, Calendar, User, FileText } from 'lucide-react';

export default function Verifications() {
  const { user, role } = useAuth();
  const { tasks, verifyTask } = useTasks();
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const isAdmin = role?.hierarchy_level === 1;
  const isQuality = role?.id === 'r5' || role?.name?.toLowerCase().includes('quality');
  const pending = tasks.filter(t =>
    t.status === 'under_review' &&
    (t.verification_status === 'pending' || t.verification_status === 'quality_pending') &&
    (isAdmin || t.department_id === user?.department_id)
  ).filter(t =>
    t.verification_status !== 'quality_pending' || isAdmin || isQuality
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
            const handleVerify = async (status: 'approved' | 'rejected') => {
              try {
                await verifyTask(task.id, status, remarks[task.id]);
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
                    <div>
                      <h3 className="font-medium">{task.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                    </div>
                    <StatusChip type="priority" value={task.priority} />
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{task.assignee?.name}</span>
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Submitted {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : '—'}</span>
                    {task.proof_url && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />Proof attached ({task.proof_type})</span>}
                    {task.requires_quality_approval && <span>Quality approval required</span>}
                  </div>
                  <Textarea
                    placeholder="Add remarks (optional for approval, required for rejection)..."
                    className="text-sm"
                    rows={2}
                    value={remarks[task.id] || ''}
                    onChange={e => setRemarks(prev => ({ ...prev, [task.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { handleVerify('approved').catch(() => undefined); }}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => {
                      if (!remarks[task.id]?.trim()) return;
                      handleVerify('rejected').catch(() => undefined);
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
