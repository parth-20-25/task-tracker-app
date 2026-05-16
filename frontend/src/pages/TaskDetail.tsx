import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchTask } from "@/api/taskApi";
import { TaskCard } from "@/components/TaskCard";
import { Button } from "@/components/ui/button";

export default function TaskDetail() {
  const { taskId } = useParams();
  const taskQuery = useQuery({
    queryKey: ["tasks", taskId],
    queryFn: () => fetchTask(taskId || ""),
    enabled: Boolean(taskId),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-fade-in">
      <Button asChild variant="ghost" size="sm">
        <Link to="/tasks">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Tasks
        </Link>
      </Button>

      {taskQuery.isLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading task...
        </div>
      )}

      {taskQuery.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {taskQuery.error instanceof Error ? taskQuery.error.message : "Could not load this task."}
        </div>
      )}

      {taskQuery.data && <TaskCard task={taskQuery.data} />}
    </div>
  );
}
