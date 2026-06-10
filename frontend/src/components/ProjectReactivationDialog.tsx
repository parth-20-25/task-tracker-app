import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { ProjectReactivationReason, ReactivateProjectPayload } from "@/api/designApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const REACTIVATION_REASON_OPTIONS: Array<{ value: ProjectReactivationReason; label: string }> = [
  { value: "customer_modification", label: "Customer modification" },
  { value: "internal_modification", label: "Internal modification" },
  { value: "drawing_update", label: "Drawing update" },
  { value: "fixture_correction", label: "Fixture correction" },
  { value: "other", label: "Other" },
];

interface ProjectReactivationDialogProps {
  open: boolean;
  projectLabel: string;
  projectName?: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: ReactivateProjectPayload) => void;
}

export function ProjectReactivationDialog({
  open,
  projectLabel,
  projectName,
  isPending,
  onOpenChange,
  onConfirm,
}: ProjectReactivationDialogProps) {
  const [reason, setReason] = useState<ProjectReactivationReason>("customer_modification");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (open) {
      setReason("customer_modification");
      setComment("");
    }
  }, [open]);

  const trimmedComment = comment.trim();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isPending && onOpenChange(nextOpen)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reactivate / Reopen for Modification</DialogTitle>
          <DialogDescription>
            This project is released/completed. Reactivating it will make it active again for modification work. Existing release history will be preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{projectLabel}</p>
            {projectName ? <p className="mt-1 text-xs text-muted-foreground">{projectName}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as ProjectReactivationReason)}>
              <SelectTrigger disabled={isPending}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REACTIVATION_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Comment (optional)</Label>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              maxLength={1000}
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => onConfirm({ reason, comment: trimmedComment || undefined })}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
