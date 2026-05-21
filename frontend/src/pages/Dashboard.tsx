import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { useQuery } from '@tanstack/react-query';
import { fetchProjectDashboardSummary, fetchDesignFixtures, type FixtureStageStatus } from '@/api/designApi';
import { AdminDashboardDepartmentExperience } from '@/components/AdminDashboardDepartmentExperience';
import { DesignDepartmentTaskAssignmentBar } from '@/components/DesignDepartmentTaskAssignmentBar';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { MetricCard } from '@/components/MetricCard';
import { DesignExcelUploadModal } from '@/components/DesignExcelUploadModal';
import { ClipboardList, PlayCircle, CheckCircle2, AlertTriangle, Clock, Layers3, PauseCircle, PackageCheck, FolderOpen, User, UserCheck, UserX } from 'lucide-react';
import { isDesignDepartment } from '@/lib/departments';
import { isProjectAuthorityUser } from '@/lib/permissions';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProjectDashboardSummary, ProjectStatus, DesignFixtureOption } from '@/types';
import React from "react";

const TaskAssignmentBar = React.lazy(() =>
  import('@/components/TaskAssignmentBar').then(module => ({
    default: module.TaskAssignmentBar
  }))
);

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

function fixtureStageStatusLabel(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case 'IN_PROGRESS': return 'In Progress';
    case 'PENDING': return 'Pending';
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    case 'COMPLETED': return 'Under Review';
    default: return status || 'Pending';
  }
}

function fixtureStageStatusColor(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case 'IN_PROGRESS': return 'border-sky-300 bg-sky-50 text-sky-800';
    case 'PENDING': return 'border-amber-300 bg-amber-50 text-amber-800';
    case 'APPROVED': return 'border-emerald-300 bg-emerald-50 text-emerald-800';
    case 'REJECTED': return 'border-red-300 bg-red-50 text-red-800';
    case 'COMPLETED': return 'border-violet-300 bg-violet-50 text-violet-800';
    default: return 'border-slate-300 bg-slate-50 text-slate-700';
  }
}

function formatFixtureRevisionCode(fixture: DesignFixtureOption) {
  const stage = fixture.workflow_stage;
  if (!stage) return null;
  const stageAbbrev = stage.replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase() || stage.slice(0, 3).toUpperCase();
  const rev = fixture.revision_no ?? 0;
  const ver = fixture.workflow_stage_version ?? 0;
  return `${stageAbbrev} ${String(rev).padStart(2, '0')}${ver > 0 ? `.${ver}` : ''}`;
}

function computeFixtureProgress(fixture: DesignFixtureOption): number {
  if (fixture.is_workflow_complete) return 100;
  const stageOrder = fixture.workflow_stage_order;
  if (stageOrder == null || stageOrder <= 0) return 0;
  // Rough heuristic: each completed stage adds progress. Stage order 1 = early, higher = later.
  // Typically workflows have 3–6 stages; use stage_order as multiplier
  const statusBonus = fixture.workflow_status?.toUpperCase() === 'APPROVED' ? 1 : fixture.workflow_status?.toUpperCase() === 'IN_PROGRESS' ? 0.5 : 0;
  const totalStages = Math.max(stageOrder + 2, 5); // rough estimate
  return Math.min(95, Math.round(((stageOrder - 1 + statusBonus) / totalStages) * 100));
}

function ProjectCard({ project }: { project: ProjectDashboardSummary }) {
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
            <span className="font-semibold">{project.completion_percent.toFixed(0)}%</span>
          </div>
          <Progress value={project.completion_percent} className="mt-2 h-2" />
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
              <span>Team Leader: {project.team_lead_name || project.project_leader_name || 'No operational team leader assigned'}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FixtureOperationalRow({ fixture }: { fixture: DesignFixtureOption }) {
  const revCode = formatFixtureRevisionCode(fixture);
  const progress = computeFixtureProgress(fixture);
  const isAssigned = Boolean(fixture.workflow_assigned_to);
  const isOutsourced = Boolean(fixture.remark && /outsourc/i.test(fixture.remark));
  const displayStage = fixture.workflow_stage_label || fixture.workflow_stage;

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
          <p className="text-xs text-muted-foreground">
            {fixture.part_name}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {fixture.is_workflow_complete ? (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-0.5" /> Complete
            </Badge>
          ) : fixture.review_pending ? (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 text-xs">
              Under Review
            </Badge>
          ) : null}
          {isOutsourced && (
            <Badge variant="outline" className="border-purple-300 bg-purple-50 text-purple-800 text-xs">
              Outsourced
            </Badge>
          )}
        </div>
      </div>

      {/* Workflow stage + revision */}
      {displayStage && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold text-xs gap-1">
            <Layers3 className="h-3 w-3" />
            {displayStage}
            {revCode && <span className="ml-0.5 opacity-75">— {revCode}</span>}
          </Badge>
          {fixture.workflow_status && (
            <Badge variant="outline" className={cn("text-xs font-medium", fixtureStageStatusColor(fixture.workflow_status))}>
              {fixtureStageStatusLabel(fixture.workflow_status)}
            </Badge>
          )}
          {(fixture.revision_no ?? 0) > 0 && (
            <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800 text-xs">
              Rev {fixture.revision_no}
            </Badge>
          )}
          {/* Assignment state */}
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-medium gap-0.5",
              isAssigned
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-300 bg-slate-50 text-slate-500"
            )}
          >
            {isAssigned ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
            {isAssigned ? 'Assigned' : 'Unassigned'}
          </Badge>
        </div>
      )}

      {/* Assignee + progress */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {fixture.workflow_assigned_to_name || fixture.workflow_assigned_to || 'Unassigned'}
        </span>
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5 w-16" />
          <span className="font-medium">{progress}%</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, role, access } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const isDesignUser = isDesignDepartment(user);
  const canUploadDesignLegacy = access.canUploadLegacyDesignData && !!user?.department_id && isDesignUser;
  const canUploadDesignNative = access.canUploadNativeDesignData && !!user?.department_id && isDesignUser;
  const isProjectFirstRole = isProjectAuthorityUser(user);
  const canUseDesignWorkflowBar = isDesignUser && (access.canAssignTasks || access.canChangeFixtureStage);

  // ── Backend-authoritative project data ────────────────────────────────────
  const projectSummaryQuery = useQuery({
    queryKey: ["projects", "summary", user?.employee_id || "anonymous"],
    queryFn: () => fetchProjectDashboardSummary(),
    enabled: !!user?.employee_id,
    staleTime: 60_000,
  });

  const projectSummaries = projectSummaryQuery.data ?? [];
  const selectedProject = projectSummaries.find((project) => project.project_id === selectedProjectId);
  const selectedProjectDepartmentId = selectedProject?.department_id || user?.department_id;

  const fixtureQuery = useQuery({
    queryKey: ["dashboard", "fixtures", selectedProjectId, selectedProjectDepartmentId],
    queryFn: () => fetchDesignFixtures(selectedProjectId, selectedProjectDepartmentId),
    enabled: !!selectedProjectId,
    staleTime: 60_000,
  });

  // ── Task data — only for project-authority users who need task-level metrics ─
  const taskContext = isProjectFirstRole ? null : undefined;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { tasks: rawTasks, isLoading: _tasksLoading } = isProjectFirstRole ? { tasks: [] as never[], isLoading: false } : useTasks();
  const safeTasks = rawTasks ?? [];

  const myTasks = safeTasks.filter(t => user && (t.assigned_to === user.employee_id || t.assignee_ids?.includes(user.employee_id)));
  const viewTasks = access.canViewAllTasks ? safeTasks : myTasks;

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
    pendingTasks: projectSummaries.reduce((sum, project) => sum + project.pending_tasks, 0),
  };

  const fixtures = fixtureQuery.data ?? [];

  const fixtureAssignmentSummary = useMemo(() => {
    const assigned = fixtures.filter(f => Boolean(f.workflow_assigned_to)).length;
    return { assigned, unassigned: fixtures.length - assigned, total: fixtures.length };
  }, [fixtures]);

  const teamLeaderGroups = useMemo(() => {
    const groups = new Map<string, { leaderId: string | null; leaderName: string; projects: ProjectDashboardSummary[] }>();

    for (const project of projectSummaries) {
      const leaderId = project.team_lead_id || project.project_leader_id || null;
      const leaderName = project.team_lead_name || project.project_leader_name || 'No operational team leader assigned';
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
          <MetricCard label="Pending Tasks" value={projectMetrics.pendingTasks} icon={Clock} color="text-muted-foreground" />
        </div>
      ) : (
        /* ── Operational users: project-aware compact summary ───────────── */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Projects" value={projectMetrics.total} icon={Layers3} color="text-primary" />
          <MetricCard label="Active Projects" value={projectMetrics.active} icon={PlayCircle} color="text-info" />
          <MetricCard label="My Tasks" value={myTasks.length} icon={ClipboardList} color="text-primary" />
          <MetricCard label="In Progress" value={metrics.inProgress} icon={PlayCircle} color="text-info" />
          {access.canViewVerifications && <MetricCard label="Pending Review" value={metrics.pendingVerification} icon={Clock} color="text-warning" />}
        </div>
      )}

      {(canUploadDesignLegacy || canUploadDesignNative) && (
        <DesignExcelUploadModal useOperationalSpreadsheet={canUploadDesignNative} />
      )}

      {/* ── Project-Centric Operational View — promoted to top for all users ── */}
      <div className="space-y-3">
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
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {fixtures.map((fixture) => (
                <FixtureOperationalRow key={fixture.fixture_id} fixture={fixture} />
              ))}
            </div>
          </div>
        )}
      </div>

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

      {/* ── Assignment Bars ────────────────────────────────────────────── */}
      {isProjectFirstRole ? (
        access.canAssignTasks && <AdminDashboardDepartmentExperience />
      ) : isDesignUser ? (
        canUseDesignWorkflowBar && <DesignDepartmentTaskAssignmentBar />
      ) : (
        access.canAssignTasks && <TaskAssignmentBar />
      )}
    </div>
  );
}
