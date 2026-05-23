import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { useQuery } from '@tanstack/react-query';
import { fetchProjectDashboardSummary } from '@/api/designApi';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { TaskCard } from '@/components/TaskCard';
import { TaskStatus } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Users, FolderOpen, User } from 'lucide-react';
import type { Task } from '@/types';

const statusTabs: Array<{
  value: string;
  label: string;
  statuses: TaskStatus[];
  verificationStatuses?: Array<Task['verification_status']>;
}> = [
  { value: 'active', label: 'Active', statuses: ['in_progress'] },
  { value: 'pending', label: 'Pending', statuses: ['created', 'assigned'] },
  { value: 'review', label: 'Review', statuses: ['under_review'], verificationStatuses: ['pending'] },
  { value: 'on_hold', label: 'Hold', statuses: ['on_hold'] },
  { value: 'rejected', label: 'Rejected', statuses: ['rework'], verificationStatuses: ['rejected'] },
  { value: 'closed', label: 'Completed', statuses: ['closed'] },
  { value: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
];

export default function TeamTasks() {
  const { user, access } = useAuth();
  const { tasks, isLoading } = useTasks();
  const [projectFilter, setProjectFilter] = useState('__all__');
  const [groupByAssignee, setGroupByAssignee] = useState(false);

  const teamTasks = access.canViewAllTasks ? tasks : [];

  // ── Backend-authoritative project list for filter dropdown ─────────
  const projectSummaryQuery = useQuery({
    queryKey: ["projects", "summary", user?.employee_id || "anonymous"],
    queryFn: () => fetchProjectDashboardSummary(),
    enabled: !!user?.employee_id,
    staleTime: 60_000,
  });
  const projectSummaries = projectSummaryQuery.data ?? [];

  // ── Filter by project (frontend presentation over backend data) ────
  const filteredTasks = useMemo(() => {
    if (projectFilter === '__all__') return teamTasks;
    return teamTasks.filter((task) => task.project_id === projectFilter);
  }, [teamTasks, projectFilter]);

  // ── Group tasks by status tab ──────────────────────────────────────
  const groupedTasks = useMemo(() => {
    return statusTabs.reduce((acc, tab) => {
      acc[tab.value] = filteredTasks.filter((task) =>
        tab.verificationStatuses
          ? tab.statuses.includes(task.status) && tab.verificationStatuses.includes(task.verification_status)
          : tab.statuses.includes(task.status),
      );
      return acc;
    }, {} as Record<string, typeof tasks>);
  }, [filteredTasks]);

  // ── Group tasks by assignee within a list ──────────────────────────
  const groupByAssigneeMap = useMemo(() => {
    if (!groupByAssignee) return null;
    const map = new Map<string, { name: string; tasks: Task[] }>();
    for (const task of filteredTasks) {
      const key = task.assigned_to || '__unassigned__';
      const name = task.assignee?.name || task.assigned_to || 'Unassigned';
      if (!map.has(key)) {
        map.set(key, { name, tasks: [] });
      }
      map.get(key)!.tasks.push(task);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredTasks, groupByAssignee]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Team Tasks</h1>
        <p className="text-sm text-muted-foreground">Review one operational state at a time.</p>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
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
                  {p.project_no} — {p.project_name}
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

      {/* ── Status tabs ──────────────────────────────────────────────── */}
      <Tabs defaultValue="active" className="space-y-4">
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
                  No {tab.label.toLowerCase()} team tasks.
                </div>
              ) : groupByAssignee ? (
                /* ── Assignee-grouped view ──────────────────────────── */
                <div className="space-y-6">
                  {(() => {
                    const assigneeGroups = new Map<string, { name: string; tasks: Task[] }>();
                    for (const task of list) {
                      const key = task.assigned_to || '__unassigned__';
                      const name = task.assignee?.name || task.assigned_to || 'Unassigned';
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
                /* ── Flat grid view ─────────────────────────────────── */
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map(t => <TaskCard key={t.id} task={t} showActions={false} />)}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
