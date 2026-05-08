import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { History, RotateCcw, ShieldAlert } from "lucide-react";
import {
  manipulateFixtureStage,
  reopenFixtureStage,
  type FixtureFullProgress,
  type FixtureProgressStage,
  type FixtureRevisionType,
  type FixtureStageStatus,
} from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

const REVISION_TYPES: Array<{ value: FixtureRevisionType; label: string }> = [
  { value: "CUSTOMER_CHANGE", label: "Customer change" },
  { value: "INTERNAL_DESIGN_CHANGE", label: "Internal design change" },
  { value: "MANUFACTURING_ISSUE", label: "Manufacturing issue" },
  { value: "QUALITY_CORRECTION", label: "Quality correction" },
  { value: "COST_OPTIMIZATION", label: "Cost optimization" },
  { value: "APPROVAL_REJECTION", label: "Approval rejection" },
  { value: "PROCUREMENT_CONSTRAINT", label: "Procurement constraint" },
  { value: "MANUAL_OVERRIDE", label: "Manual override" },
  { value: "OTHER", label: "Other" },
];

const MANUAL_STATUSES: FixtureStageStatus[] = ["PENDING", "IN_PROGRESS", "APPROVED", "REJECTED"];

function formatRevisionDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRevisionLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function getDefaultTargetStage(stages: FixtureProgressStage[]) {
  const active = stages.find((stage) => stage.status !== "APPROVED");
  return active?.stage_name || stages[0]?.stage_name || "";
}

interface FixtureRevisionPanelProps {
  fixtureId: string;
  departmentId?: string;
  progress?: FixtureFullProgress;
  canReopen: boolean;
  canManipulate: boolean;
  onChanged: () => void;
}

export function FixtureRevisionPanel({
  fixtureId,
  departmentId,
  progress,
  canReopen,
  canManipulate,
  onChanged,
}: FixtureRevisionPanelProps) {
  const stages = progress?.stages ?? [];
  const [targetStage, setTargetStage] = useState(() => getDefaultTargetStage(stages));
  const [revisionType, setRevisionType] = useState<FixtureRevisionType>("OTHER");
  const [manualStatus, setManualStatus] = useState<FixtureStageStatus>("PENDING");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");

  const effectiveTargetStage = useMemo(() => {
    if (stages.some((stage) => stage.stage_name === targetStage)) {
      return targetStage;
    }
    return getDefaultTargetStage(stages);
  }, [stages, targetStage]);

  const reopenMutation = useMutation({
    mutationFn: () => reopenFixtureStage({
      fixture_id: fixtureId,
      department_id: departmentId,
      target_stage_name: effectiveTargetStage,
      revision_type: revisionType,
      revision_reason: reason.trim(),
      remarks: remarks.trim() || undefined,
    }),
    onSuccess: () => {
      setReason("");
      setRemarks("");
      toast({ title: "Fixture stage reopened", description: "Revision history was preserved." });
      onChanged();
    },
    onError: (error) => {
      toast({
        title: "Revision failed",
        description: error instanceof Error ? error.message : "Could not reopen the fixture stage.",
        variant: "destructive",
      });
    },
  });

  const manualMutation = useMutation({
    mutationFn: () => manipulateFixtureStage({
      fixture_id: fixtureId,
      department_id: departmentId,
      target_stage_name: effectiveTargetStage,
      target_status: manualStatus,
      revision_reason: reason.trim(),
      remarks: remarks.trim() || undefined,
    }),
    onSuccess: () => {
      setReason("");
      setRemarks("");
      toast({ title: "Legacy stage adjusted", description: "Manual override was recorded in the revision timeline." });
      onChanged();
    },
    onError: (error) => {
      toast({
        title: "Manual override failed",
        description: error instanceof Error ? error.message : "Could not manipulate the fixture stage.",
        variant: "destructive",
      });
    },
  });

  if (!progress) {
    return null;
  }

  const hasActions = canReopen || (canManipulate && progress.is_legacy_workflow);
  const actionDisabled = !effectiveTargetStage || !reason.trim() || reopenMutation.isPending || manualMutation.isPending;

  return (
    <div className="space-y-3 rounded-xl border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            Revision Timeline
          </p>
          <p className="text-xs text-muted-foreground">
            Current revision: R{progress.revision_no || 0}
            {progress.is_legacy_workflow ? " · Legacy fixture" : " · Strict workflow fixture"}
          </p>
        </div>
      </div>

      {progress.revisions.length > 0 ? (
        <div className="space-y-2">
          {progress.revisions.map((revision) => (
            <div key={revision.id} className="rounded-lg border bg-muted/20 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  R{revision.revision_no} · {formatRevisionLabel(revision.revision_type)}
                </span>
                <span className="text-muted-foreground">{formatRevisionDate(revision.changed_at)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {revision.reverted_from_stage} -> {revision.reverted_to_stage}
              </p>
              <p className="mt-1 font-medium text-foreground">{revision.revision_reason}</p>
              {revision.revision_remarks ? <p className="mt-1 text-muted-foreground">{revision.revision_remarks}</p> : null}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Changed by {revision.changed_by_name || revision.changed_by}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No revisions recorded yet.
        </p>
      )}

      {hasActions ? (
        <div className="grid gap-3 border-t pt-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Target stage</Label>
            <Select value={effectiveTargetStage} onValueChange={setTargetStage}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Choose stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.stage_name} value={stage.stage_name}>
                    {stage.stage_order}. {stage.stage_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Revision type</Label>
            <Select value={revisionType} onValueChange={(value) => setRevisionType(value as FixtureRevisionType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVISION_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {canManipulate && progress.is_legacy_workflow ? (
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Manual target status</Label>
              <Select value={manualStatus} onValueChange={(value) => setManualStatus(value as FixtureStageStatus)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2 md:col-span-2">
            <Label className="text-xs font-semibold">Reason *</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this stage needs revision or controlled correction."
              rows={2}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label className="text-xs font-semibold">Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Optional supporting context."
              rows={2}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            {canReopen ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionDisabled}
                onClick={() => reopenMutation.mutate()}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reopen Stage
              </Button>
            ) : null}
            {canManipulate && progress.is_legacy_workflow ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={actionDisabled}
                onClick={() => manualMutation.mutate()}
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                Legacy Override
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
