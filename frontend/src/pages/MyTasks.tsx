import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { TaskCard } from '@/components/TaskCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'react-router-dom';
import {
  isTaskAssignedToEmployee,
  matchesMyTaskStatusFilter,
  normalizeMyTaskStatusFilter,
  type MyTaskStatusFilter,
} from '@/lib/taskFilters';

const myTaskTabs: Array<{ value: MyTaskStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'review', label: 'Review' },
  { value: 'rework', label: 'Rework' },
  { value: 'closed', label: 'Closed' },
];

export default function MyTasks() {
  const { user } = useAuth();
  const { tasks, isLoading } = useTasks();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStatus = normalizeMyTaskStatusFilter(searchParams.get('status'));
  const myTasks = tasks.filter(t => isTaskAssignedToEmployee(t, user?.employee_id));

  const groups = Object.fromEntries(
    myTaskTabs.map((tab) => [
      tab.value,
      myTasks.filter((task) => matchesMyTaskStatusFilter(task, tab.value)),
    ]),
  ) as Record<MyTaskStatusFilter, typeof tasks>;

  const handleStatusChange = (value: string) => {
    const nextStatus = normalizeMyTaskStatusFilter(value);
    const nextParams = new URLSearchParams(searchParams);

    if (nextStatus === 'all') {
      nextParams.delete('status');
    } else {
      nextParams.set('status', nextStatus);
    }

    setSearchParams(nextParams, { replace: false });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">My Tasks</h1>
      <Tabs value={selectedStatus} onValueChange={handleStatusChange}>
        <TabsList className="h-auto flex w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          {myTaskTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 basis-[calc(50%-0.25rem)] sm:flex-none sm:basis-auto">
              {tab.label} ({groups[tab.value].length})
            </TabsTrigger>
          ))}
        </TabsList>
        {myTaskTabs.map((tab) => {
          const list = groups[tab.value];

          return (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            {isLoading ? (
              <TaskGridSkeleton count={6} />
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No matching tasks.</p>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map(t => <TaskCard key={t.id} task={t} />)}
              </div>
            )}
          </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
