import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, RefreshCw, Trash2 } from "lucide-react";
import { deleteBatch, fetchBatches } from "@/api/batchApi";
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
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { batchQueryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { UploadBatch } from "@/types";

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function DeleteAction({
  batch,
  isAdmin,
  onDelete,
  isPending,
}: {
  batch: UploadBatch;
  isAdmin: boolean;
  onDelete: (batch: UploadBatch, force: boolean) => void;
  isPending: boolean;
}) {
  const disabled = batch.deletion_blocked;
  const reason = batch.delete_blocked_reason || "Cannot delete this batch while active work exists.";

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
  const { role } = useAuth();
  const isAdmin = role?.hierarchy_level === 1;
  const [selectedBatch, setSelectedBatch] = useState<UploadBatch | null>(null);

  const batchesQuery = useQuery({
    queryKey: batchQueryKeys.all,
    queryFn: fetchBatches,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ batchId, force }: { batchId: string; force: boolean }) => deleteBatch(batchId, force),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: batchQueryKeys.all });
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

  const handleDelete = (batch: UploadBatch, force: boolean) => {
    const confirmed = window.confirm(
      force
        ? `Force delete batch ${batch.batch_id}? This bypasses workflow safety validation.`
        : `Delete batch ${batch.batch_id}?`,
    );

    if (!confirmed) {
      return;
    }

    deleteMutation.mutate({ batchId: batch.id, force });
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
                <TableHead>Batch ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Total Fixtures</TableHead>
                <TableHead>Status Summary</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchesQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Loading batches...
                  </TableCell>
                </TableRow>
              ) : null}

              {batchesQuery.data?.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-mono text-xs">{batch.batch_id}</TableCell>
                  <TableCell>{formatDateTime(batch.created_at)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{batch.project_no}</div>
                    <div className="text-xs text-muted-foreground">{batch.scope_name}</div>
                  </TableCell>
                  <TableCell>{batch.total_fixtures}</TableCell>
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
                      <DeleteAction
                        batch={batch}
                        isAdmin={isAdmin}
                        isPending={deleteMutation.isPending}
                        onDelete={handleDelete}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!batchesQuery.isLoading && batchesQuery.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
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
            <DialogDescription>{selectedBatch?.batch_id}</DialogDescription>
          </DialogHeader>
          {selectedBatch ? (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Project</span>
                <span>{selectedBatch.project_no}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Scope</span>
                <span>{selectedBatch.scope_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <span className="text-muted-foreground">Uploaded By</span>
                <span>{selectedBatch.uploaded_by || "-"}</span>
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
