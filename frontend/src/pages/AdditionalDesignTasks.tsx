import { useMemo, useState } from "react";
import { ClipboardCheck, Layers3 } from "lucide-react";
import { AdditionalDesignTaskAssignment } from "@/components/AdditionalDesignTaskAssignment";
import { TaskCard } from "@/components/TaskCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { useTasks } from "@/contexts/useTasks";
import { toast } from "@/hooks/use-toast";
import { isTaskAssignedToEmployee } from "@/lib/taskFilters";
import type { Task } from "@/types";

function EmptyQueue({ children }: { children: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export default function AdditionalDesignTasks() {
  const { access, user } = useAuth();
  const { tasks, verifyTask } = useTasks();
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reviewingTaskId, setReviewingTaskId] = useState<number | null>(null);

  const additionalTasks = useMemo(() => tasks.filter((task) => task.task_type === "additional_design"), [tasks]);
  const myTasks = additionalTasks.filter((task) => isTaskAssignedToEmployee(task, user?.employee_id));
  const teamTasks = additionalTasks.filter((task) => !isTaskAssignedToEmployee(task, user?.employee_id));
  const approvalTasks = additionalTasks.filter((task) => (
    task.status === "under_review"
    && task.verification_status === "pending"
    && (access.canSelfApprove || !isTaskAssignedToEmployee(task, user?.employee_id))
  ));

  const review = async (task: Task, action: "approve" | "reject", remarks?: string) => {
    try {
      setReviewingTaskId(task.id);
      await verifyTask(task.id, action, remarks);
      setRejectingTask(null);
      setRejectionReason("");
      toast({ title: action === "approve" ? "Task approved" : "Task returned for correction" });
    } catch (error) {
      toast({ title: "Review failed", description: error instanceof Error ? error.message : "Could not review task.", variant: "destructive" });
    } finally {
      setReviewingTaskId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary"><Layers3 className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold">Additional Design Tasks</h1>
          <p className="text-sm text-muted-foreground">Historical 2D tasks remain visible here. New additional work is 3D-only; new 2D work uses fixture Release Deliverables.</p>
        </div>
      </div>

      <AdditionalDesignTaskAssignment />

      <Tabs defaultValue="mine" className="space-y-4">
        <TabsList className="h-auto flex w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          <TabsTrigger value="mine">My Tasks ({myTasks.length})</TabsTrigger>
          {access.canViewTeamTasks ? <TabsTrigger value="team">Team ({teamTasks.length})</TabsTrigger> : null}
          {access.canApproveCompletedTasks ? <TabsTrigger value="approval">Approval ({approvalTasks.length})</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="mine">
          {myTasks.length === 0 ? <EmptyQueue>No additional tasks assigned to you.</EmptyQueue> : (
            <div className="grid gap-3 lg:grid-cols-2">{myTasks.map((task) => <TaskCard key={task.id} task={task} />)}</div>
          )}
        </TabsContent>

        {access.canViewTeamTasks ? (
          <TabsContent value="team">
            {teamTasks.length === 0 ? <EmptyQueue>No additional team tasks in your scope.</EmptyQueue> : (
              <div className="grid gap-3 lg:grid-cols-2">{teamTasks.map((task) => <TaskCard key={task.id} task={task} showActions={false} />)}</div>
            )}
          </TabsContent>
        ) : null}

        {access.canApproveCompletedTasks ? (
          <TabsContent value="approval">
            {approvalTasks.length === 0 ? <EmptyQueue>No additional tasks awaiting approval.</EmptyQueue> : (
              <div className="space-y-3">
                {approvalTasks.map((task) => (
                  <div key={task.id} className="space-y-3 rounded-lg border p-3">
                    <TaskCard task={task} showActions={false} compact />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setRejectingTask(task)} disabled={reviewingTaskId === task.id}>Return</Button>
                      <Button onClick={() => { review(task, "approve").catch(() => undefined); }} disabled={reviewingTaskId === task.id}>
                        <ClipboardCheck className="mr-2 h-4 w-4" /> Approve
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => { if (!open) { setRejectingTask(null); setRejectionReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Return Task for Correction</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Explain what must be corrected" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingTask(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectingTask || !rejectionReason.trim() || reviewingTaskId === rejectingTask?.id}
              onClick={() => { if (rejectingTask) review(rejectingTask, "reject", rejectionReason.trim()).catch(() => undefined); }}
            >
              Return Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
