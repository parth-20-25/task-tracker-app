import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, PauseCircle, RefreshCw, Rocket, Trash2 } from "lucide-react";
import { deleteBatch, fetchBatches, holdBatchProject, releaseBatchProject } from "@/api/batchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { isProjectAuthorityUser } from "@/lib/permissions";
import { batchQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { ProjectStatus, UploadBatch } from "@/types";

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function projectStatusLabel(status: ProjectStatus | string | undefined) {
  switch (status) {
    case "on_hold":
      return "On Hold";
    case "completed":
      return "Completed";
    default:
      return "Active";
  }
}

function projectStatusClass(status: ProjectStatus | string | undefined) {
  switch (status) {
    case "on_hold":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-sky-200 bg-sky-50 text-sky-800";
  }
}

function DeleteAction({
  batch,
  isAdmin,
  canDelete,
  onDelete,
  isPending,
}: {
  batch: UploadBatch;
  isAdmin: boolean;
  canDelete: boolean;
  onDelete: (batch: UploadBatch, force: boolean) => void;
  isPending: boolean;
}) {
  const disabled = !canDelete || batch.deletion_blocked;
  const reason = !canDelete
    ? "Only the uploader of this batch or an admin can delete it."
    : batch.delete_blocked_reason || "Cannot delete this batch while active work exists.";

  return (
    <div className="flex items-center justify-end gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={disabled || isPending}
              onClick={() => onDelete(batch, false)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </span>
        </TooltipTrigger>
        {disabled ? <TooltipContent>{reason}</TooltipContent> : null}
      </Tooltip>

      {isAdmin && disabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => onDelete(batch, true)}
        >
          Force
        </Button>
      ) : null}
    </div>
  );
}

export default function Batches() {
  const queryClient = useQueryClient();
  const { access, role, user } = useAuth();
  const isAdmin = role?.hierarchy_level === 1;
  const isProjectAuthority = isProjectAuthorityUser(user);
  const [selectedBatch, setSelectedBatch] = useState<UploadBatch | null>(null);

  const batchesQuery = useQuery({
    queryKey: batchQueryKeys.all,
    queryFn: fetchBatches,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ batchId, force }: { batchId: string; force: boolean }) => deleteBatch(batchId, force),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      ]);
      toast({
        title: result.force ? "Batch force deleted" : "Batch deleted",
        description: result.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Could not delete the batch.",
        variant: "destructive",
      });
    },
  });

  const holdMutation = useMutation({
    mutationFn: (batchId: string) => holdBatchProject(batchId),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      ]);
      toast({ title: "Project on hold", description: result.message });
    },
    onError: (error) => {
      toast({
        title: "On Hold failed",
        description: error instanceof Error ? error.message : "Could not place the project on hold.",
        variant: "destructive",
      });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: (batchId: string) => releaseBatchProject(batchId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: batchQueryKeys.all });
      toast({ title: "Project released", description: result.message });
    },
    onError: (error) => {
      toast({
        title: "Release failed",
        description: error instanceof Error ? error.message : "Could not release the project.",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (batch: UploadBatch, force: boolean) => {
    const confirmed = window.confirm(
      force
        ? `Force delete project ${batch.project_no}? This bypasses workflow safety validation.`
        : `Delete project ${batch.project_no}?`,
    );

    if (!confirmed) {
      return;
    }

    deleteMutation.mutate({ batchId: batch.id, force });
  };

  const handleHold = (batch: UploadBatch) => {
    if (!window.confirm(`Place project ${batch.project_no} on hold? Active assignment workflow will stop for this project.`)) {
      return;
    }

    holdMutation.mutate(batch.id);
  };

  const handleRelease = (batch: UploadBatch) => {
    if (!window.confirm(`Release project ${batch.project_no}? This marks all fixtures and tasks completed.`)) {
      return;
    }

    releaseMutation.mutate(batch.id);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Upload Batches</h1>
          <p className="text-sm text-muted-foreground">Review uploaded fixture batches and safely remove only inactive work.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => batchesQuery.refetch()}
          disabled={batchesQuery.isFetching}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", batchesQuery.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <h2 className="font-semibold">Batch List</h2>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Total Fixtures</TableHead>
                <TableHead>Project Status</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead>Workflow Summary</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchesQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading batches...
                  </TableCell>
                </TableRow>
              ) : null}

              {batchesQuery.data?.map((batch) => {
                const isOwner = Boolean(
                  user?.employee_id
                  && ((batch.uploaded_by_user_id || batch.uploaded_by) === user.employee_id),
                );
                const canDelete = isAdmin || (access.canDeleteWbsBatch && isOwner);
                const canManageProject = isProjectAuthority || access.canAssignTasks || (access.canDeleteWbsBatch && isOwner);
                const projectCompleted = batch.project_status === "completed";
                const projectOnHold = batch.project_status === "on_hold";
                const lifecyclePending = holdMutation.isPending || releaseMutation.isPending;

                return (
                  <TableRow key={batch.project_id}>
                    <TableCell>
                      <div className="font-medium">{batch.project_no}</div>
                      <div className="text-xs text-muted-foreground">{batch.project_name}</div>
                    </TableCell>
                    <TableCell>{formatDateTime(batch.uploaded_at)}</TableCell>
                    <TableCell>{batch.total_fixtures}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(projectStatusClass(batch.project_status))}>
                        {projectStatusLabel(batch.project_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold">{batch.project_completion_percent.toFixed(0)}%</span>
                        <span className="text-muted-foreground">{batch.completed_tasks}/{batch.total_tasks} tasks</span>
                      </div>
                      <Progress value={batch.project_completion_percent} className="mt-2 h-2" />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          batch.deletion_blocked
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800",
                        )}
                      >
                        {batch.status_summary}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setSelectedBatch(batch)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canManageProject || projectOnHold || projectCompleted || lifecyclePending}
                          onClick={() => handleHold(batch)}
                        >
                          <PauseCircle className="h-4 w-4 mr-2" />
                          On Hold
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canManageProject || projectCompleted || lifecyclePending}
                          onClick={() => handleRelease(batch)}
                        >
                          <Rocket className="h-4 w-4 mr-2" />
                          Release
                        </Button>
                        <DeleteAction
                          batch={batch}
                          canDelete={canDelete}
                          isAdmin={isAdmin}
                          isPending={deleteMutation.isPending}
                          onDelete={handleDelete}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}

              {!batchesQuery.isLoading && batchesQuery.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No upload batches found.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedBatch)} onOpenChange={(open) => !open && setSelectedBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batch Details</DialogTitle>
          </DialogHeader>
          {selectedBatch ? (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Project</span>
                <span>{selectedBatch.project_no}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Project Name</span>
                <span>{selectedBatch.project_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Project Status</span>
                <span>{projectStatusLabel(selectedBatch.project_status)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Completion</span>
                <span>{selectedBatch.project_completion_percent.toFixed(0)}%</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Tasks</span>
                <span>{selectedBatch.completed_tasks} completed / {selectedBatch.pending_tasks} pending</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Uploaded By</span>
                <span>{selectedBatch.uploaded_by_user_id || selectedBatch.uploaded_by || "-"}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Accepted / Rejected</span>
                <span>{selectedBatch.accepted_rows} / {selectedBatch.rejected_rows}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Deletion</span>
                <span>{selectedBatch.deletion_blocked ? selectedBatch.delete_blocked_reason : "Allowed"}</span>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
