import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { TaskCard } from '@/components/TaskCard';
import { TaskStatus } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';

const columns: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'assigned', label: 'Assigned', color: 'bg-muted-foreground' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-info' },
  { status: 'on_hold', label: 'On Hold', color: 'bg-warning' },
  { status: 'under_review', label: 'Review', color: 'bg-warning' },
  { status: 'rework', label: 'Rework', color: 'bg-destructive' },
  { status: 'closed', label: 'Closed', color: 'bg-success' },
];

export default function TeamTasks() {
  const { user, role } = useAuth();
  const { tasks } = useTasks();

  const isAdmin = role?.hierarchy_level === 1;
  const teamTasks = isAdmin ? tasks : tasks.filter(t => t.department_id === user?.department_id);
  const groupedTasks = columns.reduce((acc, col) => {
    acc[col.status] = teamTasks.filter(t => t.status === col.status);
    return acc;
  }, {} as Record<string, typeof tasks>);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Team Tasks — Kanban</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
        {columns.map(col => {
          const colTasks = groupedTasks[col.status] || [];
          return (
            <div key={col.status} className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${col.color}`} />
                <h3 className="text-sm font-medium">{col.label}</h3>
                <span className="text-xs text-muted-foreground ml-auto">{colTasks.length}</span>
              </div>
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-2 pr-2">
                  {colTasks.map(t => <TaskCard key={t.id} task={t} compact showActions={false} />)}
                  {colTasks.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8 border border-dashed rounded-lg">
                      No tasks
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}
