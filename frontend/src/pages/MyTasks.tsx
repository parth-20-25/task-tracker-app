import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { TaskCard } from '@/components/TaskCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function MyTasks() {
  const { user } = useAuth();
  const { tasks, isLoading } = useTasks();
  const myTasks = tasks.filter(t => user && (t.assigned_to === user.employee_id || t.assignee_ids?.includes(user.employee_id)));

  const groups = {
    active: myTasks.filter(t => t.status === 'assigned' || t.status === 'in_progress' || t.status === 'created'),
    on_hold: myTasks.filter(t => t.status === 'on_hold'),
    review: myTasks.filter(t => t.status === 'under_review'),
    rework: myTasks.filter(t => t.status === 'rework'),
    closed: myTasks.filter(t => t.status === 'closed'),
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">My Tasks</h1>
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({groups.active.length})</TabsTrigger>
          <TabsTrigger value="on_hold">On Hold ({groups.on_hold.length})</TabsTrigger>
          <TabsTrigger value="review">Review ({groups.review.length})</TabsTrigger>
          <TabsTrigger value="rework">Rework ({groups.rework.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({groups.closed.length})</TabsTrigger>
        </TabsList>
        {Object.entries(groups).map(([key, list]) => (
          <TabsContent key={key} value={key} className="mt-4">
            {isLoading ? (
              <TaskGridSkeleton count={6} />
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No tasks here.</p>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map(t => <TaskCard key={t.id} task={t} />)}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
