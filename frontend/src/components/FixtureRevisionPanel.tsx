import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, History, RotateCcw, ShieldAlert } from "lucide-react";
import {
  manipulateFixtureStage,
  reopenFixtureStage,
  type FixtureFullProgress,
  type FixtureProgressStage,
  type FixtureRevisionType,
  type FixtureStageStatus,
} from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDesignRevisionReasonLabel } from "@/lib/designRevisionDisplay";

const REVISION_TYPES: Array<{ value: FixtureRevisionType; label: string }> = [
  { value: "CUSTOMER_CHANGE", label: "Customer change" },
  { value: "CUSTOMER_TRIAL_CHANGE", label: "Customer trial change" },
  { value: "CUSTOMER_REVISION", label: "Customer revision" },
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

function getApprovedStages(stages: FixtureProgressStage[]) {
  return stages.filter((stage) => stage.status === "APPROVED");
}

function getDefaultTargetStage(stages: FixtureProgressStage[]) {
  const approved = getApprovedStages(stages);
  return approved[approved.length - 1]?.stage_name || "";
}

interface FixtureRevisionPanelProps {
  fixtureId: string;
  departmentId?: string;
  progress?: FixtureFullProgress;
  canChangeStage: boolean;
  permissionTrace?: {
    currentUserId?: string | null;
    currentRole?: string | null;
    resolvedPermissions: string[];
    source: string;
  };
  onChanged: () => void;
}

export function FixtureRevisionPanel({
  fixtureId,
  departmentId,
  progress,
  canChangeStage,
  permissionTrace,
  onChanged,
}: FixtureRevisionPanelProps) {
  const stages = progress?.stages ?? [];
  const revisions = progress?.revisions ?? [];
  const [targetStage, setTargetStage] = useState(() => getDefaultTargetStage(stages));
  const [revisionType, setRevisionType] = useState<FixtureRevisionType | "">("");
  const [manualStatus, setManualStatus] = useState<FixtureStageStatus>("PENDING");
  const [remarks, setRemarks] = useState("");
  const [expanded, setExpanded] = useState(false);

  const effectiveTargetStage = useMemo(() => {
    if (stages.some((stage) => stage.stage_name === targetStage)) {
      return targetStage;
    }
    return getDefaultTargetStage(stages);
  }, [stages, targetStage]);

  useEffect(() => {
    console.info("[permissions][change_fixture_stage][frontend]", {
      component: "FixtureRevisionPanel",
      source: permissionTrace?.source || "unknown",
      current_user_id: permissionTrace?.currentUserId || null,
      current_role: permissionTrace?.currentRole || null,
      resolved_permissions: permissionTrace?.resolvedPermissions || [],
      permission_check_result: canChangeStage,
      fixture_id: fixtureId || null,
      stage_dropdown_visible: Boolean(progress && canChangeStage),
      hidden_reason: canChangeStage ? null : "missing change_fixture_stage",
    });
  }, [
    canChangeStage,
    fixtureId,
    permissionTrace?.currentRole,
    permissionTrace?.currentUserId,
    permissionTrace?.resolvedPermissions,
    permissionTrace?.source,
    progress,
  ]);

  const reopenMutation = useMutation({
    mutationFn: () => {
      if (!revisionType) {
        throw new Error("Reason type is required");
      }
      if (revisionType === "MANUAL_OVERRIDE") {
        const overrideReason = remarks.trim();
        if (!overrideReason) {
          throw new Error("Manual override reason is required");
        }
        return manipulateFixtureStage({
          fixture_id: fixtureId,
          department_id: departmentId,
          target_stage_name: effectiveTargetStage,
          target_status: manualStatus,
          reason_type: "MANUAL_OVERRIDE",
          revision_type: "MANUAL_OVERRIDE",
          revision_reason: overrideReason,
          remarks: overrideReason,
        });
      }
      return reopenFixtureStage({
        fixture_id: fixtureId,
        department_id: departmentId,
        target_stage_name: effectiveTargetStage,
        revision_type: revisionType,
        revision_reason: remarks.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
    },
    onSuccess: () => {
      setRemarks("");
      toast({ title: "Fixture stage updated", description: "The controlled stage change was saved." });
      onChanged();
    },
    onError: (error) => {
      toast({
        title: "Stage update failed",
        description: error instanceof Error ? error.message : "Could not update the fixture stage.",
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
      reason_type: "MANUAL_OVERRIDE",
      revision_type: "MANUAL_OVERRIDE",
      revision_reason: remarks.trim() || undefined,
      remarks: remarks.trim() || undefined,
    }),
    onSuccess: () => {
      setRemarks("");
      toast({ title: "Fixture stage updated", description: "The legacy stage change was saved." });
      onChanged();
    },
    onError: (error) => {
      toast({
        title: "Stage update failed",
        description: error instanceof Error ? error.message : "Could not update the fixture stage.",
        variant: "destructive",
      });
    },
  });

  if (!progress) {
    return null;
  }

  if (!canChangeStage) {
    return null;
  }

  const targetStageRow = stages.find((stage) => stage.stage_name === effectiveTargetStage) || null;
  const canReworkTarget = Boolean(targetStageRow);
  const actionDisabled =
    !effectiveTargetStage
    || !revisionType
    || !canReworkTarget
    || reopenMutation.isPending
    || manualMutation.isPending;
  const currentRevisionStage = stages.find((stage) => stage.status !== "APPROVED") || stages[stages.length - 1] || null;
  const currentRevision = currentRevisionStage?.revision_code || `R${progress.revision_no || 0}`;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="rounded-xl border bg-background">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              Change Fixture Stage
            </p>
            <p className="text-xs text-muted-foreground">
              Current Revision: {currentRevision}
              {progress.is_legacy_workflow ? " · Legacy fixture" : " · Strict workflow fixture"}
            </p>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 px-3 pb-3">
        {revisions.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            {revisions.map((revision) => (
              <div key={revision.id} className="rounded-lg border bg-muted/20 p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {revision.revision || revision.revision_code || `R${revision.revision_no}`}
                    {" · "}
                    {revision.reason_type_label || formatDesignRevisionReasonLabel(String(revision.reason_type || revision.revision_type))}
                  </span>
                  <span className="text-muted-foreground">{formatRevisionDate(revision.changed_at)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {revision.reverted_from_stage} {"→"}  {revision.reverted_to_stage}
                </p>
                <p className="mt-1 font-medium text-foreground">
                  Stage: {revision.stage || revision.stage_name}
                  {revision.previous_revision ? ` · Previous: ${revision.previous_revision}` : ""}
                  {revision.approval_state ? ` · Was: ${revision.approval_state}` : ""}
                </p>
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
                    {stage.stage_order}. {stage.stage_label || stage.stage_name} ({stage.revision_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Reason Type</Label>
            <Select value={revisionType} onValueChange={(value) => setRevisionType(value as FixtureRevisionType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select reason type" />
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

          {progress.is_legacy_workflow ? (
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
          ) : revisionType === "MANUAL_OVERRIDE" ? (
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
            <Label className="text-xs font-semibold">Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Optional supporting context."
              rows={2}
            />
          </div>

          {!canReworkTarget && effectiveTargetStage ? (
            <p className="text-xs text-amber-700 md:col-span-2">
              Choose a configured workflow stage.
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionDisabled}
              onClick={() => reopenMutation.mutate()}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Update Stage
            </Button>
            {progress.is_legacy_workflow ? (
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
      </CollapsibleContent>
    </Collapsible>
  );
}
