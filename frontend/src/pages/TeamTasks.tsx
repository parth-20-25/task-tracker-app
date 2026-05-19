import { useAuth } from '@/contexts/useAuth';
import { useTasks } from '@/contexts/useTasks';
import { TaskGridSkeleton } from '@/components/LoadingSkeletons';
import { TaskCard } from '@/components/TaskCard';
import { TaskStatus } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const statusTabs: Array<{
  value: string;
  label: string;
  statuses: TaskStatus[];
}> = [
  { value: 'active', label: 'Active', statuses: ['created', 'assigned', 'in_progress'] },
  { value: 'on_hold', label: 'On Hold', statuses: ['on_hold'] },
  { value: 'review', label: 'Review', statuses: ['under_review'] },
  { value: 'rework', label: 'Rework', statuses: ['rework'] },
  { value: 'closed', label: 'Closed', statuses: ['closed'] },
];

export default function TeamTasks() {
  const { access } = useAuth();
  const { tasks, isLoading } = useTasks();

  const teamTasks = access.canViewAllTasks ? tasks : [];
  const groupedTasks = statusTabs.reduce((acc, tab) => {
    acc[tab.value] = teamTasks.filter(t => tab.statuses.includes(t.status));
    return acc;
  }, {} as Record<string, typeof tasks>);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Team Tasks</h1>
        <p className="text-sm text-muted-foreground">Review one operational state at a time.</p>
      </div>

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
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map(t => <TaskCard key={t.id} task={t} compact showActions={false} />)}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
