import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { useQuery } from '@tanstack/react-query';
import { fetchProjectDashboardSummary, fetchDesignFixtures } from '@/api/designApi';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { MetricCard } from '@/components/MetricCard';
import { DesignExcelUploadModal } from '@/components/DesignExcelUploadModal';
import { NativeFixtureIngestionLauncher } from '@/components/native-ingestion/NativeIngestionWorkspace';
import { ProjectFixtureOperationsGrid } from '@/components/ProjectFixtureOperations';
import { ClipboardList, PlayCircle, Clock, Layers3, PauseCircle, PackageCheck, FolderOpen, User, UserCheck, UserX } from 'lucide-react';
import { isProjectAuthorityUser } from '@/lib/permissions';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProjectDashboardSummary, ProjectStatus } from '@/types';

function statusLabel(status: ProjectStatus) {
  if (status === "on_hold") return "On Hold";
  if (status === "completed") return "Completed";
  return "Active";
}

function statusClass(status: ProjectStatus) {
  if (status === "on_hold") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function ProjectCard({ project }: { project: ProjectDashboardSummary }) {
  const hasCompletionTruth = typeof project.completion_percent === "number";

  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <CardHeader className="space-y-2 p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{project.project_name}</p>
            <p className="text-xs text-muted-foreground">{project.project_no}</p>
          </div>
          <Badge variant="outline" className={cn(statusClass(project.project_status))}>
            {statusLabel(project.project_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-semibold">
              {hasCompletionTruth ? `${project.completion_percent.toFixed(0)}%` : "Truth unavailable"}
            </span>
          </div>
          {hasCompletionTruth ? <Progress value={project.completion_percent} className="mt-2 h-2" /> : null}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="font-semibold">{project.total_fixtures}</div>
            <div className="text-muted-foreground">Fixtures</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="font-semibold">{project.active_tasks}</div>
            <div className="text-muted-foreground">Active</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="font-semibold">{project.pending_tasks}</div>
            <div className="text-muted-foreground">Pending</div>
          </div>
        </div>
        {/* Team lead + department context */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{project.department_name || project.department_id}</span>
          <span>{project.customer_name || "No customer"}</span>
        </div>
        {project.team_lead_name && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Team Leader: {project.team_lead_name}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user, role, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const canUploadDesignLegacy = access.canUploadLegacyDesignData;
  const canUploadDesignNative = access.canUploadNativeDesignData;
  const isProjectFirstRole = isProjectAuthorityUser(user);
  const canAccessProjectFixtures = access.canAccessProjectFixtures;

  // ── Backend-authoritative project data ────────────────────────────────────
  const projectSummaryQuery = useQuery({
    queryKey: ["projects", "summary", user?.employee_id || "anonymous"],
    queryFn: () => fetchProjectDashboardSummary(),
    enabled: !!user?.employee_id && canAccessProjectFixtures,
    staleTime: 60_000,
  });

  const projectSummaries = projectSummaryQuery.data ?? [];
  const selectedProject = projectSummaries.find((project) => project.project_id === selectedProjectId);
  const selectedProjectDepartmentId = selectedProject?.department_id || user?.department_id;

  const fixtureQuery = useQuery({
    queryKey: ["dashboard", "fixtures", selectedProjectId, selectedProjectDepartmentId],
    queryFn: () => fetchDesignFixtures(selectedProjectId, selectedProjectDepartmentId),
    enabled: !!selectedProjectId && canAccessProjectFixtures,
    staleTime: 60_000,
  });

  // ── Task data — only for project-authority users who need task-level metrics ─
  const taskContext = isProjectFirstRole ? null : undefined;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { tasks: rawTasks, isLoading: _tasksLoading } = isProjectFirstRole ? { tasks: [] as never[], isLoading: false } : useTasks();
  const safeTasks = rawTasks ?? [];

  const myTasks = safeTasks.filter(t => user && (t.assigned_to === user.employee_id || t.assignee_ids?.includes(user.employee_id)));
  const viewTasks = access.canViewAllTasks ? safeTasks : myTasks;
  const recentAssignedTasks = [...myTasks]
    .sort((a, b) => new Date(b.created_at || b.assigned_at || 0).getTime() - new Date(a.created_at || a.assigned_at || 0).getTime())
    .slice(0, 5);
  const activeAssignedTasks = myTasks.filter(t => ['assigned', 'in_progress', 'on_hold', 'rework'].includes(t.status));
  const pendingAssignedVerification = myTasks.filter(t => t.status === 'under_review');
  const upcomingDeadlines = [...myTasks]
    .filter(t => t.deadline && t.status !== 'closed')
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
    .slice(0, 5);

  const metrics = {
    total: viewTasks.length,
    inProgress: viewTasks.filter(t => t.status === 'in_progress').length,
    completed: viewTasks.filter(t => t.status === 'closed').length,
    overdue: viewTasks.filter(t => new Date(t.deadline) < new Date() && t.status !== 'closed').length,
    pendingVerification: viewTasks.filter(t => t.status === 'under_review').length,
  };

  const projectMetrics = {
    total: projectSummaries.length,
    active: projectSummaries.filter((project) => project.project_status === "active").length,
    onHold: projectSummaries.filter((project) => project.project_status === "on_hold").length,
    completed: projectSummaries.filter((project) => project.project_status === "completed").length,
    pendingFixtures: projectSummaries.reduce((sum, project) => sum + project.pending_tasks, 0),
  };

  const fixtures = fixtureQuery.data ?? [];

  const fixtureAssignmentSummary = useMemo(() => {
    const assigned = fixtures.filter((fixture) => ["ASSIGNED", "IN_PROGRESS", "VERIFICATION"].includes(String(fixture.operational_state || ""))).length;
    const complete = fixtures.filter((fixture) => fixture.operational_state === "WORKFLOW_COMPLETE").length;
    return { assigned, unassigned: fixtures.length - assigned - complete, total: fixtures.length };
  }, [fixtures]);

  const teamLeaderGroups = useMemo(() => {
    const groups = new Map<string, { leaderId: string | null; leaderName: string; projects: ProjectDashboardSummary[] }>();

    for (const project of projectSummaries) {
      const leaderId = project.team_lead_id || null;
      const leaderName = project.team_lead_name || 'No operational team leader assigned';
      const key = `${leaderId || '__none__'}::${leaderName}`;

      if (!groups.has(key)) {
        groups.set(key, { leaderId, leaderName, projects: [] });
      }

      groups.get(key)?.projects.push(project);
    }

    return [...groups.values()].sort((left, right) => left.leaderName.localeCompare(right.leaderName));
  }, [projectSummaries]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">{role?.name} · {user?.department?.name || 'All Departments'}</p>
      </div>

      {isProjectFirstRole ? (
        /* ── Project-authority users: project-level metrics ─────────────── */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Projects" value={projectMetrics.total} icon={Layers3} color="text-primary" />
          <MetricCard label="Active" value={projectMetrics.active} icon={PlayCircle} color="text-info" />
          <MetricCard label="On Hold" value={projectMetrics.onHold} icon={PauseCircle} color="text-warning" />
          <MetricCard label="Completed" value={projectMetrics.completed} icon={PackageCheck} color="text-success" />
          <MetricCard label="Pending Fixtures" value={projectMetrics.pendingFixtures} icon={Clock} color="text-muted-foreground" />
        </div>
      ) : (
        /* ── Operational users: project-aware compact summary ───────────── */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {canAccessProjectFixtures && <MetricCard label="Projects" value={projectMetrics.total} icon={Layers3} color="text-primary" />}
          {canAccessProjectFixtures && <MetricCard label="Active Projects" value={projectMetrics.active} icon={PlayCircle} color="text-info" />}
          <MetricCard label="My Tasks" value={myTasks.length} icon={ClipboardList} color="text-primary" />
          <MetricCard label="Active Tasks" value={activeAssignedTasks.length} icon={PlayCircle} color="text-info" />
          <MetricCard label="Pending Verification" value={pendingAssignedVerification.length} icon={Clock} color="text-warning" />
        </div>
      )}

      {(canUploadDesignLegacy || canUploadDesignNative) && (
        <div className="grid gap-3 md:grid-cols-2">
          {canUploadDesignNative ? (
            <NativeFixtureIngestionLauncher />
          ) : null}
          {canUploadDesignLegacy ? (
            <DesignExcelUploadModal
              useOperationalSpreadsheet={false}
              permissionMode="legacy"
              triggerLabel="Legacy Fixture Upload"
            />
          ) : null}
        </div>
      )}

      {!canAccessProjectFixtures ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="p-4 pb-2">
              <h2 className="text-base font-semibold">Recent Assigned Tasks</h2>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {recentAssignedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assigned tasks.</p>
              ) : recentAssignedTasks.map((task) => (
                <div key={task.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{task.title}</span>
                    <Badge variant="outline">{task.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <Progress value={task.completion_percent ?? (task.status === "closed" ? 100 : 0)} className="mt-2 h-2" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <h2 className="text-base font-semibold">Deadlines</h2>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active deadlines.</p>
              ) : upcomingDeadlines.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span className="font-medium">{task.title}</span>
                  <span className="text-xs text-muted-foreground">{new Date(task.deadline).toLocaleDateString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Project-Centric Operational View — controllers only ── */}
      {canAccessProjectFixtures ? <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Project Fixtures</h2>
          </div>
          <Select
            value={selectedProjectId || "__none__"}
            onValueChange={(v) => setSelectedProjectId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="w-[260px] h-9 text-sm">
              <SelectValue placeholder="Select a project…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Select a project…</SelectItem>
              {projectSummaries.map((p) => (
                <SelectItem key={p.project_id} value={p.project_id}>
                  {p.project_no} — {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedProjectId ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a project above to view fixture-level operational status.</p>
            </CardContent>
          </Card>
        ) : fixtureQuery.isLoading ? (
          <TaskGridSkeleton count={4} />
        ) : fixtures.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-sm">No fixtures found for this project.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {selectedProject && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {fixtures.length} fixture(s) · {selectedProject.customer_name || 'No customer'}
                </p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-emerald-700">
                    <UserCheck className="h-3 w-3" /> {fixtureAssignmentSummary.assigned} assigned
                  </span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <UserX className="h-3 w-3" /> {fixtureAssignmentSummary.unassigned} unassigned
                  </span>
                </div>
              </div>
            )}
            <ProjectFixtureOperationsGrid
              fixtures={fixtures}
              projectId={selectedProjectId}
              departmentId={selectedProjectDepartmentId}
            />
          </div>
        )}
      </div> : null}

      {/* ── Project Command Center — project-authority users only ───────── */}
      {isProjectFirstRole ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Project Command Center</h2>
            <p className="text-xs text-muted-foreground">
              Sorted Active → On Hold → Completed
            </p>
          </div>
          {projectSummaryQuery.isLoading ? (
            <TaskGridSkeleton count={6} />
          ) : (
            <div className="space-y-6">
              {teamLeaderGroups.map((group) => (
                <div key={`${group.leaderId || 'none'}-${group.leaderName}`} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Team Leader: {group.leaderName}
                  </h3>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.projects.map((project) => (
                      <ProjectCard key={project.project_id} project={project} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

    </div>
  );
}
