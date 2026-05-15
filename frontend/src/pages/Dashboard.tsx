import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { useQuery } from '@tanstack/react-query';
import { fetchProjectDashboardSummary } from '@/api/designApi';
import { AdminDashboardDepartmentExperience } from '@/components/AdminDashboardDepartmentExperience';
import { DesignDepartmentTaskAssignmentBar } from '@/components/DesignDepartmentTaskAssignmentBar';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { MetricCard } from '@/components/MetricCard';
import { TaskCard } from '@/components/TaskCard';
import { DesignExcelUploadModal } from '@/components/DesignExcelUploadModal';
import { ClipboardList, PlayCircle, CheckCircle2, AlertTriangle, Clock, Layers3, PauseCircle, PackageCheck } from 'lucide-react';
import { isDesignDepartment } from '@/lib/departments';
import { isProjectAuthorityUser } from '@/lib/permissions';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ProjectDashboardSummary, ProjectStatus } from '@/types';
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
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{project.department_name || project.department_id}</span>
          <span>{project.customer_name || "No customer"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user, role, access } = useAuth();
  const { tasks, isLoading } = useTasks();
  const safeTasks = tasks ?? [];

  const isDesignUser = isDesignDepartment(user);
  const canUploadProjectData = access.canUploadData && !!user?.department_id;
  const canUploadDesignProjectData = canUploadProjectData && isDesignUser;
  const isProjectFirstRole = isProjectAuthorityUser(user);
  const canUseDesignWorkflowBar = isDesignUser && (access.canAssignTasks || access.canChangeFixtureStage);

  const projectSummaryQuery = useQuery({
    queryKey: ["projects", "summary", user?.employee_id || "anonymous"],
    queryFn: () => fetchProjectDashboardSummary(),
    enabled: isProjectFirstRole,
  });

  const myTasks = safeTasks.filter(t => user && (t.assigned_to === user.employee_id || t.assignee_ids?.includes(user.employee_id)));
  const viewTasks = access.canViewAllTasks ? safeTasks : myTasks;

  const metrics = {
    total: viewTasks.length,
    inProgress: viewTasks.filter(t => t.status === 'in_progress').length,
    completed: viewTasks.filter(t => t.status === 'closed').length,
    overdue: viewTasks.filter(t => new Date(t.deadline) < new Date() && t.status !== 'closed').length,
    pendingVerification: viewTasks.filter(t => t.status === 'under_review').length,
  };

  const recentTasks = [...viewTasks]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  const projectSummaries = projectSummaryQuery.data ?? [];
  const projectMetrics = {
    total: projectSummaries.length,
    active: projectSummaries.filter((project) => project.project_status === "active").length,
    onHold: projectSummaries.filter((project) => project.project_status === "on_hold").length,
    completed: projectSummaries.filter((project) => project.project_status === "completed").length,
    pendingTasks: projectSummaries.reduce((sum, project) => sum + project.pending_tasks, 0),
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">{role?.name} · {user?.department?.name || 'All Departments'}</p>
      </div>

      {isProjectFirstRole ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Projects" value={projectMetrics.total} icon={Layers3} color="text-primary" />
          <MetricCard label="Active" value={projectMetrics.active} icon={PlayCircle} color="text-info" />
          <MetricCard label="On Hold" value={projectMetrics.onHold} icon={PauseCircle} color="text-warning" />
          <MetricCard label="Completed" value={projectMetrics.completed} icon={PackageCheck} color="text-success" />
          <MetricCard label="Pending Tasks" value={projectMetrics.pendingTasks} icon={Clock} color="text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Total Tasks" value={metrics.total} icon={ClipboardList} color="text-primary" />
          <MetricCard label="In Progress" value={metrics.inProgress} icon={PlayCircle} color="text-info" />
          <MetricCard label="Completed" value={metrics.completed} icon={CheckCircle2} color="text-success" />
          <MetricCard label="Overdue" value={metrics.overdue} icon={AlertTriangle} color="text-destructive" />
          {access.canViewVerifications && <MetricCard label="Pending Review" value={metrics.pendingVerification} icon={Clock} color="text-warning" />}
        </div>
      )}

      {canUploadDesignProjectData && <DesignExcelUploadModal />}

      {isProjectFirstRole ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Project Command Center</h2>
            <p className="text-xs text-muted-foreground">Sorted Active -> On Hold -> Completed</p>
          </div>
          {projectSummaryQuery.isLoading ? (
            <TaskGridSkeleton count={6} />
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {projectSummaries.map((project) => (
                <ProjectCard key={project.project_id} project={project} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {isProjectFirstRole ? (
        access.canAssignTasks && <AdminDashboardDepartmentExperience />
      ) : isDesignUser ? (
        canUseDesignWorkflowBar && <DesignDepartmentTaskAssignmentBar />
      ) : (
        access.canAssignTasks && <TaskAssignmentBar />
      )}

      {!isProjectFirstRole && <div>
        <h2 className="text-lg font-semibold mb-3">Recent Tasks</h2>
        {isLoading ? (
          <TaskGridSkeleton count={6} />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentTasks.map(task => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>}
    </div>
  );
}
