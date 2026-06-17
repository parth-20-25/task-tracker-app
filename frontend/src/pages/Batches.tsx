import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Eye, PauseCircle, Pencil, PlayCircle, RefreshCw, Rocket, RotateCcw, Route, Trash2, Wrench } from "lucide-react";
import { activateBatchProject, deleteBatch, fetchBatches, holdBatchProject, releaseBatchProject } from "@/api/batchApi";
import { assignProjectTo2D, fetchProject2DRouting, reactivateProject, updateProject2DAssignment, updateProjectModification } from "@/api/designApi";
import type { ReactivateProjectPayload } from "@/api/designApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { NativeProjectEditWorkspace } from "@/components/native-ingestion/NativeIngestionWorkspace";
import { ProjectReactivationDialog } from "@/components/ProjectReactivationDialog";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { isAdminUser, isProjectAuthorityUser } from "@/lib/permissions";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { batchQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import type { ProjectStatus, UploadBatch, User } from "@/types";

const projectStatusFilters: Array<{ value: "all" | ProjectStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "released", label: "Released" },
];

function normalizeProjectStatusFilter(value: string | null): "all" | ProjectStatus {
  return projectStatusFilters.some((filter) => filter.value === value)
    ? value as "all" | ProjectStatus
    : "all";
}

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
    case "released":
      return "Released";
    default:
      return "Active";
  }
}

function projectStatusClass(status: ProjectStatus | string | undefined) {
  switch (status) {
    case "on_hold":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "completed":
    case "released":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-sky-200 bg-sky-50 text-sky-800";
  }
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

function isProjectUploaderOrCreator(user: User | null | undefined, batch: UploadBatch | null | undefined) {
  return [
    batch?.project_created_by_user_id,
    batch?.project_uploaded_by,
    batch?.uploaded_by,
    batch?.uploaded_by_user_id,
  ].some((identifier) => currentUserMatchesIdentifier(user, identifier));
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
  const hasOperationalBatch = Boolean(batch.batch_id);
  const disabled = !hasOperationalBatch || !canDelete || batch.deletion_blocked;
  const reason = !hasOperationalBatch
      ? "No upload batch is recorded for this project."
    : !canDelete
      ? "Only the canonical project owner or an admin can delete it."
    : batch.delete_blocked_reason || "Cannot delete this project while active work exists.";

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
          disabled={isPending || !hasOperationalBatch}
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
  const { access, user } = useAuth();
  const isAdmin = isAdminUser(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const projectStatusFilter = normalizeProjectStatusFilter(searchParams.get("status"));
  const [selectedBatch, setSelectedBatch] = useState<UploadBatch | null>(null);
  const [routingBatch, setRoutingBatch] = useState<UploadBatch | null>(null);
  const [editingBatch, setEditingBatch] = useState<UploadBatch | null>(null);
  const [reactivatingBatch, setReactivatingBatch] = useState<UploadBatch | null>(null);
  const [selected2DLeader, setSelected2DLeader] = useState("");

  const batchesQuery = useQuery({
    queryKey: batchQueryKeys.all,
    queryFn: fetchBatches,
  });
  const batches = batchesQuery.data ?? [];
  const filteredBatches = useMemo(() => (
    projectStatusFilter === "all"
      ? batches
      : batches.filter((batch) => batch.project_status === projectStatusFilter)
  ), [batches, projectStatusFilter]);

  const routingQuery = useQuery({
    queryKey: ["project-2d-routing", routingBatch?.project_id || ""],
    queryFn: () => fetchProject2DRouting(routingBatch?.project_id || ""),
    enabled: Boolean(routingBatch?.project_id),
  });

  const canManageBatchLifecycle = (batch: UploadBatch) => {
    const isOwner = Boolean(user?.employee_id && batch.project_created_by_user_id === user.employee_id);
    return isProjectAuthorityUser(user) || access.canAssignTasks || (access.canDeleteWbsBatch && isOwner);
  };

  const canReactivateBatchProject = (batch: UploadBatch) => (
    canManageBatchLifecycle(batch) || isProjectUploaderOrCreator(user, batch)
  );

  const assign2DMutation = useMutation({
    mutationFn: () => assignProjectTo2D(routingBatch?.project_id || "", selected2DLeader),
    onSuccess: async () => {
      setSelected2DLeader("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-2d-routing", routingBatch?.project_id || ""] }),
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
      ]);
      toast({ title: "Project assigned to 2D" });
    },
    onError: (error) => {
      toast({
        title: "2D routing failed",
        description: error instanceof Error ? error.message : "Could not assign this project to 2D.",
        variant: "destructive",
      });
    },
  });

  const toggle2DMutation = useMutation({
    mutationFn: ({ assignmentId, isActive }: { assignmentId: string; isActive: boolean }) =>
      updateProject2DAssignment(routingBatch?.project_id || "", assignmentId, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-2d-routing", routingBatch?.project_id || ""] });
    },
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
        title: result.force ? "Project force deleted" : "Project deleted",
        description: result.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Could not delete the project.",
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

  const activateMutation = useMutation({
    mutationFn: (batchId: string) => activateBatchProject(batchId),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      ]);
      toast({ title: "Project active", description: result.message });
    },
    onError: (error) => {
      toast({
        title: "Activation failed",
        description: error instanceof Error ? error.message : "Could not activate the project.",
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

  const reactivateMutation = useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: ReactivateProjectPayload }) =>
      reactivateProject(projectId, payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures"] }),
      ]);
      setSelectedBatch((current) => (
        current?.project_id === result.project_id
          ? { ...current, project_status: "active", is_modified: result.is_modified }
          : current
      ));
      setReactivatingBatch(null);
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

  const modificationMutation = useMutation({
    mutationFn: ({ projectId, isModified }: { projectId: string; isModified: boolean }) =>
      updateProjectModification(projectId, isModified),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      ]);
      toast({ title: "Project marker updated" });
    },
    onError: (error) => {
      toast({
        title: "Marker update failed",
        description: error instanceof Error ? error.message : "Could not update project modification status.",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (batch: UploadBatch, force: boolean) => {
    const projectNumber = formatProjectNumber(batch);
    const confirmed = window.confirm(
      force
        ? `Force delete project ${projectNumber}? This bypasses workflow safety validation.`
        : `Delete project ${projectNumber}?`,
    );

    if (!confirmed) {
      return;
    }

    if (!batch.batch_id) {
      toast({ title: "No upload batch recorded", description: "This project can be viewed, but batch lifecycle actions are unavailable.", variant: "destructive" });
      return;
    }

    deleteMutation.mutate({ batchId: batch.batch_id, force });
  };

  const handleHold = (batch: UploadBatch) => {
    if (!batch.batch_id) {
      toast({ title: "No upload batch recorded", description: "This project can be viewed, but batch lifecycle actions are unavailable.", variant: "destructive" });
      return;
    }

    if (!window.confirm(`Place project ${formatProjectNumber(batch)} on hold? Active assignment workflow will stop for this project.`)) {
      return;
    }

    holdMutation.mutate(batch.batch_id);
  };

  const handleActivate = (batch: UploadBatch) => {
    if (!batch.batch_id) {
      toast({ title: "No upload batch recorded", description: "This project can be viewed, but batch lifecycle actions are unavailable.", variant: "destructive" });
      return;
    }

    if (!window.confirm(`Activate project ${formatProjectNumber(batch)}? Tasks and fixtures will reappear in active workflows.`)) {
      return;
    }

    activateMutation.mutate(batch.batch_id);
  };

  const handleRelease = (batch: UploadBatch) => {
    if (!batch.batch_id) {
      toast({ title: "No upload batch recorded", description: "This project can be viewed, but batch lifecycle actions are unavailable.", variant: "destructive" });
      return;
    }

    if (!window.confirm(`Release project ${formatProjectNumber(batch)}? This marks all fixtures and tasks completed.`)) {
      return;
    }

    releaseMutation.mutate(batch.batch_id);
  };

  const handleToggleModification = (batch: UploadBatch) => {
    modificationMutation.mutate({
      projectId: batch.project_id,
      isModified: !batch.is_modified,
    });
  };

  const handleConfirmReactivation = (payload: ReactivateProjectPayload) => {
    if (!reactivatingBatch) {
      return;
    }

    reactivateMutation.mutate({
      projectId: reactivatingBatch.project_id,
      payload,
    });
  };

  const handleProjectStatusFilterChange = (value: string) => {
    const nextStatus = normalizeProjectStatusFilter(value);
    const nextParams = new URLSearchParams(searchParams);

    if (nextStatus === "all") {
      nextParams.delete("status");
    } else {
      nextParams.set("status", nextStatus);
    }

    setSearchParams(nextParams, { replace: false });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">Review operational projects and safely remove only inactive work.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectStatusFilter} onValueChange={handleProjectStatusFilterChange}>
            <SelectTrigger className="h-9 w-[180px] text-sm">
              <SelectValue placeholder="Project status" />
            </SelectTrigger>
            <SelectContent>
              {projectStatusFilters.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <h2 className="font-semibold">Project List</h2>
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
                    Loading projects...
                  </TableCell>
                </TableRow>
              ) : null}

              {filteredBatches.map((batch) => {
                const hasCompletionTruth = typeof batch.project_completion_percent === "number";
                const isOwner = Boolean(
                  user?.employee_id
                  && batch.project_created_by_user_id === user.employee_id,
                );
                const canDelete = isAdmin || (access.canDeleteWbsBatch && isOwner);
                const hasOperationalBatch = Boolean(batch.batch_id);
                const canManageLifecycle = canManageBatchLifecycle(batch);
                const canReactivateLifecycle = canReactivateBatchProject(batch);
                const canManageProject = hasOperationalBatch && canManageLifecycle;
                const canManage2DRouting = batch.can_manage_2d_routing === true;
                const projectTerminal = batch.project_status === "completed" || batch.project_status === "released";
                const projectOnHold = batch.project_status === "on_hold";
                const lifecyclePending = holdMutation.isPending || activateMutation.isPending || releaseMutation.isPending || reactivateMutation.isPending;

                return (
                  <TableRow key={batch.project_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {batch.can_edit_project === true ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditingBatch(batch)}
                            title="Edit project in native workspace"
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        ) : null}
                        {batch.can_toggle_modification ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={projectTerminal || modificationMutation.isPending}
                            onClick={() => handleToggleModification(batch)}
                            title={batch.is_modified ? "Clear modification marker" : "Mark project modified"}
                          >
                            <Wrench className={cn("h-4 w-4", batch.is_modified ? "text-primary" : "text-muted-foreground")} />
                          </Button>
                        ) : batch.is_modified ? (
                          <Wrench className="h-4 w-4 text-primary" />
                        ) : null}
                        <div className="font-medium">{formatProjectNumber(batch)}</div>
                      </div>
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
                      <div className="mb-2 text-xs">
                        <span className="text-muted-foreground">Overall Stage: </span>
                        <span className="font-semibold" title={batch.overall_stage?.reason || undefined}>
                          {batch.overall_stage?.label || "Data incomplete"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold">
                          {hasCompletionTruth ? `${batch.project_completion_percent.toFixed(0)}%` : formatCompletionTruthIssue(batch.completion_truth_errors)}
                        </span>
                        <span className="text-muted-foreground">{batch.completed_tasks}/{batch.total_tasks} fixtures</span>
                      </div>
                      {hasCompletionTruth ? <Progress value={batch.project_completion_percent} className="mt-2 h-2" /> : null}
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
                        {canManage2DRouting ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={projectTerminal}
                            onClick={() => {
                              setRoutingBatch(batch);
                              setSelected2DLeader("");
                            }}
                          >
                            <Route className="h-4 w-4 mr-2" />
                            Assign to 2D
                          </Button>
                        ) : null}
                        {projectOnHold ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!canManageProject || projectTerminal || lifecyclePending}
                            onClick={() => handleActivate(batch)}
                          >
                            <PlayCircle className="h-4 w-4 mr-2" />
                            Activate
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!canManageProject || projectTerminal || lifecyclePending}
                            onClick={() => handleHold(batch)}
                          >
                            <PauseCircle className="h-4 w-4 mr-2" />
                            Hold
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canManageProject || projectTerminal || lifecyclePending}
                          onClick={() => handleRelease(batch)}
                        >
                          <Rocket className="h-4 w-4 mr-2" />
                          Release
                        </Button>
                        {projectTerminal && canReactivateLifecycle ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={lifecyclePending}
                            onClick={() => setReactivatingBatch(batch)}
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reactivate
                          </Button>
                        ) : null}
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

              {!batchesQuery.isLoading && filteredBatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {projectStatusFilter === "all" ? "No projects found." : "No matching projects."}
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
            <DialogTitle>Project Details</DialogTitle>
          </DialogHeader>
          {selectedBatch ? (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Project</span>
                <span>{formatProjectNumber(selectedBatch)}</span>
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
                <span>
                  {typeof selectedBatch.project_completion_percent === "number"
                    ? `${selectedBatch.project_completion_percent.toFixed(0)}%`
                    : formatCompletionTruthIssue(selectedBatch.completion_truth_errors)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Fixtures</span>
                <span>
                  {selectedBatch.total_fixtures} total · {selectedBatch.completed_tasks} completed / {selectedBatch.active_count} active / {selectedBatch.pending_tasks} pending
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Uploaded By</span>
                <span>{formatEmployeeDisplay(selectedBatch.uploaded_by_user_id || selectedBatch.uploaded_by || null, selectedBatch.uploaded_by_name)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Accepted / Rejected</span>
                <span>{selectedBatch.accepted_rows} / {selectedBatch.rejected_rows}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Deletion</span>
                <span>{selectedBatch.deletion_blocked ? selectedBatch.delete_blocked_reason : "Allowed"}</span>
              </div>
              {(selectedBatch.project_status === "completed" || selectedBatch.project_status === "released") && canReactivateBatchProject(selectedBatch) ? (
                <div className="flex justify-end border-t pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reactivateMutation.isPending}
                    onClick={() => setReactivatingBatch(selectedBatch)}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reactivate / Reopen for Modification
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {editingBatch ? (
        <NativeProjectEditWorkspace
          projectId={editingBatch.project_id}
          departmentId={editingBatch.department_id}
          onClose={() => setEditingBatch(null)}
        />
      ) : null}

      <Dialog open={Boolean(routingBatch)} onOpenChange={(open) => !open && setRoutingBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to 2D</DialogTitle>
            <DialogDescription>
              {routingBatch ? `${formatProjectNumber(routingBatch)} · ${routingBatch.project_name}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>2D Leader</Label>
              <Select value={selected2DLeader || "__none__"} onValueChange={(value) => setSelected2DLeader(value === "__none__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder={routingQuery.isLoading ? "Loading 2D leaders..." : "Select 2D leader"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select 2D leader</SelectItem>
                  {(routingQuery.data?.eligible_leaders ?? []).map((leader) => (
                    <SelectItem key={leader.employee_id} value={leader.employee_id}>
                      {formatEmployeeDisplay(leader)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!selected2DLeader || assign2DMutation.isPending}
                onClick={() => assign2DMutation.mutate()}
              >
                Assign
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Active routing</p>
              {(routingQuery.data?.assignments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No 2D leaders assigned.</p>
              ) : (
                <div className="space-y-2">
                  {(routingQuery.data?.assignments ?? []).map((assignment) => (
                    <div key={assignment.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span>
                        {formatEmployeeDisplay(assignment.assigned_leader_id, assignment.assigned_leader_name)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {assignment.is_active ? "Active" : "Inactive"}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={toggle2DMutation.isPending}
                        onClick={() => toggle2DMutation.mutate({ assignmentId: assignment.id, isActive: !assignment.is_active })}
                      >
                        {assignment.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ProjectReactivationDialog
        open={Boolean(reactivatingBatch)}
        projectLabel={reactivatingBatch ? formatProjectNumber(reactivatingBatch) : ""}
        projectName={reactivatingBatch?.project_name}
        isPending={reactivateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setReactivatingBatch(null);
          }
        }}
        onConfirm={handleConfirmReactivation}
      />
    </div>
  );
}
