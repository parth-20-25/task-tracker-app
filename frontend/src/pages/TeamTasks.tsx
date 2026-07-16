import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProjectDashboardSummary } from '@/api/designApi';
import { updateTask } from '@/api/taskApi';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { TaskCard } from '@/components/TaskCard';
import { SafeImage } from '@/components/SafeImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { toast } from '@/hooks/use-toast';
import { adminQueryKeys, analyticsQueryKeys, batchQueryKeys, projectQueryKeys, taskAssignmentQueryKeys, taskQueryKeys } from '@/lib/queryKeys';
import { formatEmployeeDisplay } from '@/lib/employeeDisplay';
import { resolveImageUrl } from '@/lib/imageUrl';
import { formatProjectNumber } from '@/lib/projectDisplay';
import { requiresTaskWorkProof } from '@/lib/taskProofPolicy';
import {
  isPendingVerificationTask,
  isTaskAssignedToEmployee,
  matchesTeamTaskStatusFilter,
  normalizeTeamTaskStatusFilter,
  type TeamTaskStatusFilter,
} from '@/lib/taskFilters';
import { CheckCircle2, ExternalLink, FileText, FolderOpen, Loader2, User, Users, XCircle } from 'lucide-react';
import type { Task } from '@/types';

const statusTabs: Array<{ value: TeamTaskStatusFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'pending_verification', label: 'Approval Pending' },
  { value: 'on_hold', label: 'Hold' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatRevision(task: Task) {
  const stageVersion = Number(task.workflow_stage_version ?? 0);
  const fixtureRevision = Number(task.fixture_revision_no ?? 0);

  if (fixtureRevision > 0 || stageVersion > 0) {
    return `Fixture rev ${fixtureRevision} · Stage rev ${stageVersion}`;
  }

  return 'Base revision';
}

function getTaskProofLinks(task: Task) {
  const proofUrls = task.proof_url ?? [];
  const links = proofUrls.map((url, index) => ({
    key: `${url}-${index}`,
    label: `Proof ${index + 1}`,
    url,
    resolvedUrl: resolveImageUrl(url),
  }));

  if (task.latest_proof?.file_url && !proofUrls.includes(task.latest_proof.file_url)) {
    links.push({
      key: `${task.latest_proof.file_url}-latest`,
      label: task.latest_proof.file_name || 'Latest proof',
      url: task.latest_proof.file_url,
      resolvedUrl: resolveImageUrl(task.latest_proof.file_url),
    });
  }

  return links;
}

function canReviewTask(task: Task, userEmployeeId: string | null | undefined, access: ReturnType<typeof useAuth>['access']) {
  if (!isPendingVerificationTask(task)) {
    return false;
  }

  if (!access.canViewVerifications) {
    return false;
  }

  const hasApprovalPermission = task.approval_stage === 'quality'
    ? access.canApproveQuality
    : access.canApproveCompletedTasks;

  if (!hasApprovalPermission) {
    return false;
  }

  return !isTaskAssignedToEmployee(task, userEmployeeId) || access.canSelfApprove;
}

function ReviewDetail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm text-foreground">{value || '-'}</div>
    </div>
  );
}

interface ApprovalPendingCardProps {
  task: Task;
  canReview: boolean;
  isSubmitting: boolean;
  onApprove: (task: Task) => void;
  onReject: (task: Task) => void;
}

function ApprovalPendingCard({ task, canReview, isSubmitting, onApprove, onReject }: ApprovalPendingCardProps) {
  const proofLinks = getTaskProofLinks(task);
  const showProofPanel = requiresTaskWorkProof(task) || proofLinks.length > 0;
  const submittedAt = task.submitted_at || task.completed_at || task.updated_at;
  const projectLabel = [formatProjectNumber({ project_no: task.project_no, project_is_modified: task.project_is_modified }), task.project_name]
    .filter(Boolean)
    .join(' - ');
  const viewInProjectUrl = task.project_id
    ? `/?project_id=${encodeURIComponent(task.project_id)}${task.fixture_id ? `&fixture_id=${encodeURIComponent(task.fixture_id)}` : ''}${task.workflow_stage ? `&stage=${encodeURIComponent(task.workflow_stage)}` : ''}`
    : null;

  return (
    <Card className="border-slate-200">
      <CardHeader className="space-y-2 p-4 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-semibold leading-tight">{task.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
          </div>
          <Badge variant="outline" className="w-fit border-amber-200 bg-amber-50 text-amber-900">
            Approval pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="grid gap-3 rounded-md border bg-slate-50/60 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <ReviewDetail label="Project" value={projectLabel || task.project_id || '-'} />
          <ReviewDetail label="Fixture" value={task.fixture_no || task.quantity_index || '-'} />
          <ReviewDetail label="Part / Fixture Name" value={task.part_name || task.description || '-'} />
          <ReviewDetail label="Current Stage" value={task.workflow_stage || task.current_stage_id || '-'} />
          <ReviewDetail label="Revision" value={formatRevision(task)} />
          <ReviewDetail
            label="Assigned Employees"
            value={task.assignee_names || (task.assignee ? formatEmployeeDisplay(task.assignee) : formatEmployeeDisplay(task.assigned_to))}
          />
          <ReviewDetail label="Submitted" value={formatDateTime(submittedAt)} />
          <ReviewDetail label="Employee Credits" value={task.workflow_contributor_names || 'Not recorded'} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {showProofPanel ? <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Work Proofs
            </div>
            {proofLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No uploaded work proofs.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {proofLinks.map((proof) => (
                  <a
                    key={proof.key}
                    href={proof.resolvedUrl || proof.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block w-28 overflow-hidden rounded-md border bg-background text-xs text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <div className="flex h-20 items-center justify-center bg-slate-50">
                      {proof.resolvedUrl ? (
                        <SafeImage src={proof.url} alt={proof.label} className="h-full w-full object-cover" />
                      ) : (
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <span className="block truncate px-2 py-1">{proof.label}</span>
                  </a>
                ))}
              </div>
            )}
          </div> : null}

          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Completion Notes</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {task.remarks || 'No completion notes recorded.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {viewInProjectUrl ? (
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to={viewInProjectUrl}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                View in Project
              </Link>
            </Button>
          ) : null}
          {canReview ? (
            <>
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={isSubmitting}
                onClick={() => onApprove(task)}
              >
                {isSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isSubmitting}
                onClick={() => onReject(task)}
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                Reject
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeamTasks() {
  const queryClient = useQueryClient();
  const { user, access } = useAuth();
  const { tasks, isLoading, refreshTasks } = useTasks();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTeamTaskStatusFilter(searchParams.get('status'));
  const [projectFilter, setProjectFilter] = useState('__all__');
  const [groupByAssignee, setGroupByAssignee] = useState(false);
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const teamTasks = access.canViewAllTasks ? tasks : [];

  const projectSummaryQuery = useQuery({
    queryKey: ["projects", "summary", user?.employee_id || "anonymous"],
    queryFn: () => fetchProjectDashboardSummary(),
    enabled: !!user?.employee_id,
    staleTime: 60_000,
  });
  const projectSummaries = projectSummaryQuery.data ?? [];

  const filteredTasks = useMemo(() => {
    if (projectFilter === '__all__') return teamTasks;
    return teamTasks.filter((task) => task.project_id === projectFilter);
  }, [teamTasks, projectFilter]);

  const groupedTasks = useMemo(() => {
    return statusTabs.reduce((acc, tab) => {
      acc[tab.value] = filteredTasks.filter((task) => matchesTeamTaskStatusFilter(task, tab.value));
      return acc;
    }, {} as Record<TeamTaskStatusFilter, Task[]>);
  }, [filteredTasks]);

  const reviewMutation = useMutation({
    mutationFn: async ({ task, action, remarks }: { task: Task; action: 'approve' | 'reject'; remarks?: string }) => {
      return updateTask(task.id, {
        verification_action: action,
        remarks,
      });
    },
    onSuccess: async (result, variables) => {
      await Promise.all([
        refreshTasks(),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.verificationQueue }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskAssignmentQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.users('assignable') }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow"] }),
      ]);
      setRejectingTask(null);
      setRejectionReason('');
      toast({
        title: variables.action === 'approve' ? 'Task approved' : 'Task rejected',
        description: `Backend saved task ${result.id}: ${result.status.replace(/_/g, ' ')} / ${result.verification_status.replace(/_/g, ' ')}.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Review not saved',
        description: error instanceof Error ? error.message : 'Task is not in verification state.',
        variant: 'destructive',
      });
    },
  });

  const handleStatusChange = (value: string) => {
    const nextStatus = normalizeTeamTaskStatusFilter(value);
    const nextParams = new URLSearchParams(searchParams);

    if (nextStatus === 'active') {
      nextParams.delete('status');
    } else {
      nextParams.set('status', nextStatus);
    }

    setSearchParams(nextParams, { replace: false });
  };

  const submitRejection = () => {
    if (!rejectingTask || !rejectionReason.trim()) {
      return;
    }

    reviewMutation.mutate({
      task: rejectingTask,
      action: 'reject',
      remarks: rejectionReason.trim(),
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Team Tasks</h1>
        <p className="text-sm text-muted-foreground">Review one operational state at a time.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All projects</SelectItem>
              {projectSummaries.map((p) => (
                <SelectItem key={p.project_id} value={p.project_id}>
                  {formatProjectNumber(p)} - {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            groupByAssignee
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-slate-200 bg-white text-muted-foreground hover:bg-slate-50'
          }`}
          onClick={() => setGroupByAssignee((v) => !v)}
        >
          <Users className="h-3.5 w-3.5" />
          Group by assignee
        </button>
        {projectFilter !== '__all__' && (
          <Badge variant="outline" className="text-xs">
            Filtered: {projectSummaries.find(p => p.project_id === projectFilter)?.project_name || projectFilter}
          </Badge>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleStatusChange} className="space-y-4">
        <TabsList className="h-auto flex w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          {statusTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 basis-[calc(50%-0.25rem)] sm:flex-none sm:basis-auto">
              {tab.label} ({groupedTasks[tab.value]?.length || 0})
            </TabsTrigger>
          ))}
        </TabsList>

        {statusTabs.map((tab) => {
          const list = groupedTasks[tab.value] || [];

          return (
            <TabsContent key={tab.value} value={tab.value} className="mt-0">
              {isLoading ? (
                <TaskGridSkeleton count={6} />
              ) : list.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No matching team tasks.
                </div>
              ) : tab.value === 'pending_verification' ? (
                <div className="space-y-3">
                  {list.map((task) => (
                    <ApprovalPendingCard
                      key={task.id}
                      task={task}
                      canReview={canReviewTask(task, user?.employee_id, access)}
                      isSubmitting={reviewMutation.isPending && reviewMutation.variables?.task.id === task.id}
                      onApprove={(reviewTask) => reviewMutation.mutate({ task: reviewTask, action: 'approve' })}
                      onReject={(reviewTask) => {
                        setRejectingTask(reviewTask);
                        setRejectionReason('');
                      }}
                    />
                  ))}
                </div>
              ) : groupByAssignee ? (
                <div className="space-y-6">
                  {(() => {
                    const assigneeGroups = new Map<string, { name: string; tasks: Task[] }>();
                    for (const task of list) {
                      const key = task.assigned_to || '__unassigned__';
                      const name = task.assignee ? formatEmployeeDisplay(task.assignee) : formatEmployeeDisplay(task.assigned_to);
                      if (!assigneeGroups.has(key)) {
                        assigneeGroups.set(key, { name, tasks: [] });
                      }
                      assigneeGroups.get(key)!.tasks.push(task);
                    }
                    return [...assigneeGroups.values()]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((group) => (
                        <div key={group.name} className="space-y-2">
                          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                            <User className="h-3.5 w-3.5" />
                            {group.name}
                            <Badge variant="outline" className="ml-1 text-[10px]">{group.tasks.length}</Badge>
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {group.tasks.map(t => <TaskCard key={t.id} task={t} showActions={false} />)}
                          </div>
                        </div>
                      ));
                  })()}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map(t => <TaskCard key={t.id} task={t} showActions={false} />)}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => {
        if (!open && !reviewMutation.isPending) {
          setRejectingTask(null);
          setRejectionReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Task Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Rejection uses the same rework workflow as Project Fixtures and requires a reason.
            </p>
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Rejection reason"
              rows={4}
              disabled={reviewMutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reviewMutation.isPending}
              onClick={() => {
                setRejectingTask(null);
                setRejectionReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectingTask || !rejectionReason.trim() || reviewMutation.isPending}
              onClick={submitRejection}
            >
              {reviewMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
