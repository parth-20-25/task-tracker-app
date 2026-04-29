import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { AdminDashboardDepartmentExperience } from '@/components/AdminDashboardDepartmentExperience';
import { DesignDepartmentTaskAssignmentBar } from '@/components/DesignDepartmentTaskAssignmentBar';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { MetricCard } from '@/components/MetricCard';
import { TaskCard } from '@/components/TaskCard';
import { DesignExcelUploadModal } from '@/components/DesignExcelUploadModal';
import { ClipboardList, PlayCircle, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { isDesignDepartment } from '@/lib/departments';
import React from "react";

const TaskAssignmentBar = React.lazy(() =>
  import('@/components/TaskAssignmentBar').then(module => ({
    default: module.TaskAssignmentBar
  }))
);

export default function Dashboard() {
  const { user, role, access } = useAuth();
  const { tasks, isLoading } = useTasks();

  const isDesignUser = isDesignDepartment(user);
  const canUploadProjectData = access.canUploadData && !!user?.department_id;
  const canUploadDesignProjectData = canUploadProjectData && isDesignUser;
  const isAdminUser = role?.hierarchy_level === 1;

  const myTasks = tasks.filter(t => user && (t.assigned_to === user.employee_id || t.assignee_ids?.includes(user.employee_id)));
  const viewTasks = access.canViewAllTasks ? tasks : myTasks;

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-muted-foreground">{role?.name} · {user?.department?.name || 'All Departments'}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Total Tasks" value={metrics.total} icon={ClipboardList} color="text-primary" />
        <MetricCard label="In Progress" value={metrics.inProgress} icon={PlayCircle} color="text-info" />
        <MetricCard label="Completed" value={metrics.completed} icon={CheckCircle2} color="text-success" />
        <MetricCard label="Overdue" value={metrics.overdue} icon={AlertTriangle} color="text-destructive" />
        {access.canViewVerifications && <MetricCard label="Pending Review" value={metrics.pendingVerification} icon={Clock} color="text-warning" />}
      </div>

      {canUploadDesignProjectData && <DesignExcelUploadModal />}

      {access.canAssignTasks && (
        isAdminUser
          ? <AdminDashboardDepartmentExperience />
          : (isDesignUser ? <DesignDepartmentTaskAssignmentBar /> : <TaskAssignmentBar />)
      )}

      <div>
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
      </div>
    </div>
  );
}
