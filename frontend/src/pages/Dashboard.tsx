import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProjectDashboardSummary, fetchDesignFixtures, reactivateProject, updateProjectModification } from '@/api/designApi';
import type { ReactivateProjectPayload } from '@/api/designApi';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { MetricCard } from '@/components/MetricCard';
import { NativeFixtureIngestionLauncher, NativeProjectEditWorkspace } from '@/components/native-ingestion/NativeIngestionWorkspace';
import { ProjectFixtureOperationsGrid } from '@/components/ProjectFixtureOperations';
import { ProjectReactivationDialog } from '@/components/ProjectReactivationDialog';
import { ClipboardList, PlayCircle, Clock, Layers3, PauseCircle, PackageCheck, FolderOpen, Pencil, User, UserCheck, UserX, Wrench, RotateCcw } from 'lucide-react';
import { isProjectAuthorityUser } from '@/lib/permissions';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { batchQueryKeys, projectQueryKeys, taskQueryKeys } from '@/lib/queryKeys';
import { formatProjectNumber } from '@/lib/projectDisplay';
import { formatEmployeeDisplay } from '@/lib/employeeDisplay';
import { TaskCard } from '@/components/TaskCard';
import { isMyActiveTask, isPendingVerificationTask, isTaskAssignedToEmployee } from '@/lib/taskFilters';
import { toast } from '@/hooks/use-toast';
import type { ProjectDashboardSummary, ProjectStatus, User } from '@/types';

function statusLabel(status: ProjectStatus) {
  if (status === "on_hold") return "On Hold";
  if (status === "completed") return "Completed";
  if (status === "released") return "Released";
  return "Active";
}

function statusClass(status: ProjectStatus) {
  if (status === "on_hold") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "completed" || status === "released") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function formatCompletionTruthIssue(errors: string[] | undefined) {
  const firstError = errors?.find(Boolean);
  if (!firstError) {
    return "Completion truth missing";
  }

  return firstError
    .replace(/^fixture:/, "Fixture ")
    .replace(/:/g, ": ")
    .replace(/_/g, " ");
}

function normalizeIdentifier(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function currentUserMatchesIdentifier(user: User | null | undefined, identifier: unknown) {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return false;
  }

  return [user?.employee_id, user?.id].some(
    (candidate) => normalizeIdentifier(candidate) === normalizedIdentifier,
  );
}

function isProjectUploaderOrCreator(user: User | null | undefined, project: ProjectDashboardSummary | null | undefined) {
  return [
    project?.project_created_by_user_id,
    project?.project_uploaded_by,
    project?.uploaded_by,
    project?.uploaded_by_user_id,
  ].some((identifier) => currentUserMatchesIdentifier(user, identifier));
}

function ProjectCard({
  project,
  canEditProject,
  canReactivateProject,
  onEditProject,
  onReactivateProject,
  onToggleModification,
  isToggling,
  isReactivating,
}: {
  project: ProjectDashboardSummary;
  canEditProject: boolean;
  canReactivateProject: boolean;
  onEditProject: (project: ProjectDashboardSummary) => void;
  onReactivateProject: (project: ProjectDashboardSummary) => void;
  onToggleModification: (project: ProjectDashboardSummary) => void;
  isToggling: boolean;
  isReactivating: boolean;
}) {
  const hasCompletionTruth = typeof project.completion_percent === "number";
  const projectTerminal = project.project_status === "completed" || project.project_status === "released";
  const canToggleModification = project.can_toggle_modification === true && !projectTerminal;

  return (
    <Card className="relative overflow-hidden border-slate-200 shadow-sm">
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
        {canEditProject ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEditProject(project)}
            title="Edit project in native workspace"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </Button>
        ) : null}
        {canToggleModification ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isToggling}
            onClick={() => onToggleModification(project)}
            title={project.is_modified ? "Clear modification marker" : "Mark project modified"}
          >
            <Wrench className={cn("h-4 w-4", project.is_modified ? "text-primary" : "text-muted-foreground")} />
          </Button>
        ) : (
          <Wrench className={cn("m-1.5 h-4 w-4", project.is_modified ? "text-primary" : "text-muted-foreground/50")} />
        )}
      </div>
      <CardHeader className="space-y-2 p-4 pb-3 pl-16">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{project.project_name}</p>
            <p className="text-xs text-muted-foreground">{formatProjectNumber(project)}</p>
          </div>
          <Badge variant="outline" className={cn(statusClass(project.project_status))}>
            {statusLabel(project.project_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div>
          <div className="mb-2 text-sm">
            <span className="text-muted-foreground">Overall Stage: </span>
            <span className="font-semibold" title={project.overall_stage?.reason || undefined}>
              {project.overall_stage?.label || "Data incomplete"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-semibold">
              {hasCompletionTruth ? `${project.completion_percent.toFixed(0)}%` : formatCompletionTruthIssue(project.completion_truth_errors)}
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
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <User className="h-3 w-3" />
          <span>Team Leader: {formatEmployeeDisplay(project.team_lead_id || null, project.team_lead_name)}</span>
        </div>
        {projectTerminal && canReactivateProject ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isReactivating}
              onClick={() => onReactivateProject(project)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reactivate
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { user, role, access } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get("project_id") || "";
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editingProject, setEditingProject] = useState<ProjectDashboardSummary | null>(null);
  const [reactivatingProject, setReactivatingProject] = useState<ProjectDashboardSummary | null>(null);

  const isProjectFirstRole = isProjectAuthorityUser(user);
  const canAccessProjectFixtures = access.canAccessProjectFixtures;
  const canUploadDesignNative = access.canUploadNativeDesignData;

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
  const selectedProjectActive = selectedProject?.project_status === "active";

  useEffect(() => {
    if (!requestedProjectId || !canAccessProjectFixtures) {
      return;
    }

    if (projectSummaries.some((project) => project.project_id === requestedProjectId)) {
      setSelectedProjectId(requestedProjectId);
    }
  }, [canAccessProjectFixtures, projectSummaries, requestedProjectId]);

  const fixtureQuery = useQuery({
    queryKey: ["dashboard", "fixtures", selectedProjectId, selectedProjectDepartmentId],
    queryFn: () => fetchDesignFixtures(selectedProjectId, selectedProjectDepartmentId, { activeOnly: true }),
    enabled: !!selectedProjectId && selectedProjectActive && canAccessProjectFixtures,
    staleTime: 60_000,
  });

  const modificationMutation = useMutation({
    mutationFn: ({ projectId, isModified }: { projectId: string; isModified: boolean }) =>
      updateProjectModification(projectId, isModified),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      ]);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: ReactivateProjectPayload }) =>
      reactivateProject(projectId, payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures"] }),
      ]);
      setReactivatingProject(null);
      toast({ title: "Project reactivated", description: result.message });
    },
    onError: (error) => {
      toast({
        title: "Reactivation failed",
        description: error instanceof Error ? error.message : "Could not reactivate the project.",
        variant: "destructive",
      });
    },
  });

  const handleToggleProjectModification = (project: ProjectDashboardSummary) => {
    modificationMutation.mutate({
      projectId: project.project_id,
      isModified: !project.is_modified,
    });
  };

  const canManageProjectLifecycle = (project: ProjectDashboardSummary | null | undefined) => {
    if (!project) {
      return false;
    }

    return isProjectAuthorityUser(user) || access.canAssignTasks;
  };

  const canReactivateProject = (project: ProjectDashboardSummary | null | undefined) => {
    if (!project) {
      return false;
    }

    return canManageProjectLifecycle(project) || isProjectUploaderOrCreator(user, project);
  };

  const handleConfirmReactivation = (payload: ReactivateProjectPayload) => {
    if (!reactivatingProject) {
      return;
    }

    reactivateMutation.mutate({
      projectId: reactivatingProject.project_id,
      payload,
    });
  };

  // ── Task data — project-authority users keep the project-first dashboard.
  const { tasks: rawTasks, isLoading: _tasksLoading } = useTasks();
  const myAdditionalDesignTasks = (rawTasks ?? [])
    .filter((task) => task.task_type === "additional_design" && isTaskAssignedToEmployee(task, user?.employee_id))
    .filter((task) => !["closed", "cancelled"].includes(task.status))
    .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime());
  const safeTasks = isProjectFirstRole ? [] : rawTasks ?? [];

  const myTasks = safeTasks.filter(t => isTaskAssignedToEmployee(t, user?.employee_id));
  const viewTasks = access.canViewAllTasks ? safeTasks : myTasks;
  const teamTasks = access.canViewTeamTasks ? safeTasks : [];
  const recentAssignedTasks = myTasks.filter((task) => task.task_type !== "additional_design")
    .sort((a, b) => new Date(b.created_at || b.assigned_at || 0).getTime() - new Date(a.created_at || a.assigned_at || 0).getTime())
    .slice(0, 5);
  const activeAssignedTasks = myTasks.filter(isMyActiveTask);
  const pendingVerificationTasks = teamTasks.filter(isPendingVerificationTask);
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
      const leaderName = formatEmployeeDisplay(leaderId, project.team_lead_name);
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
          <MetricCard label="Projects" value={projectMetrics.total} icon={Layers3} color="text-primary" to="/batches" />
          <MetricCard label="Active Projects" value={projectMetrics.active} icon={PlayCircle} color="text-info" to="/batches?status=active" />
          <MetricCard label="On Hold" value={projectMetrics.onHold} icon={PauseCircle} color="text-warning" />
          <MetricCard label="Completed" value={projectMetrics.completed} icon={PackageCheck} color="text-success" />
          <MetricCard label="Pending Fixtures" value={projectMetrics.pendingFixtures} icon={Clock} color="text-muted-foreground" />
        </div>
      ) : (
        /* ── Operational users: project-aware compact summary ───────────── */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {canAccessProjectFixtures && <MetricCard label="Projects" value={projectMetrics.total} icon={Layers3} color="text-primary" to="/batches" />}
          {canAccessProjectFixtures && <MetricCard label="Active Projects" value={projectMetrics.active} icon={PlayCircle} color="text-info" to="/batches?status=active" />}
          {(access.canViewSelfTasks || access.canViewAllTasks) && <MetricCard label="My Tasks" value={myTasks.length} icon={ClipboardList} color="text-primary" to="/tasks" />}
          {(access.canViewSelfTasks || access.canViewAllTasks) && <MetricCard label="Active Tasks" value={activeAssignedTasks.length} icon={PlayCircle} color="text-info" to="/tasks?status=active" />}
          {access.canViewTeamTasks && <MetricCard label="Pending Verification" value={pendingVerificationTasks.length} icon={Clock} color="text-warning" to="/team-tasks?status=pending_verification" />}
        </div>
      )}

      {myAdditionalDesignTasks.length > 0 ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <h2 className="text-base font-semibold">My Additional Design Tasks</h2>
            <p className="text-sm text-muted-foreground">Start assigned work here before uploading proof or deliverable files.</p>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0 lg:grid-cols-2">
            {myAdditionalDesignTasks.map((task) => <TaskCard key={task.id} task={task} compact />)}
          </CardContent>
        </Card>
      ) : null}

      {canUploadDesignNative ? (
        <div className="grid gap-3 md:grid-cols-2">
          <NativeFixtureIngestionLauncher />
        </div>
      ) : null}

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
                  {formatProjectNumber(p)} — {p.project_name}
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
        ) : selectedProject && !selectedProjectActive ? (
          <Card>
            <CardContent className="space-y-4 p-8 text-center text-muted-foreground">
              <p className="text-sm">
                {selectedProject.project_status === "on_hold"
                  ? "This project is on hold. Fixtures are hidden from active workflows until it is activated."
                  : "This project is released or completed. Fixtures are hidden from active workflows."}
              </p>
              {(selectedProject.project_status === "completed" || selectedProject.project_status === "released") && canReactivateProject(selectedProject) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={reactivateMutation.isPending}
                  onClick={() => setReactivatingProject(selectedProject)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reactivate / Reopen for Modification
                </Button>
              ) : null}
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
                      <ProjectCard
                        key={project.project_id}
                        project={project}
                        canEditProject={project.can_edit_project === true}
                        canReactivateProject={canReactivateProject(project)}
                        onEditProject={setEditingProject}
                        onReactivateProject={setReactivatingProject}
                        onToggleModification={handleToggleProjectModification}
                        isToggling={modificationMutation.isPending}
                        isReactivating={reactivateMutation.isPending}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {editingProject ? (
        <NativeProjectEditWorkspace
          projectId={editingProject.project_id}
          departmentId={editingProject.department_id}
          onClose={() => setEditingProject(null)}
        />
      ) : null}

      <ProjectReactivationDialog
        open={Boolean(reactivatingProject)}
        projectLabel={reactivatingProject ? formatProjectNumber(reactivatingProject) : ""}
        projectName={reactivatingProject?.project_name}
        isPending={reactivateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setReactivatingProject(null);
          }
        }}
        onConfirm={handleConfirmReactivation}
      />

    </div>
  );
}
