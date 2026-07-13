import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import {
  bulkOutsourceFixtures,
  fetchDesignVendors,
  previewBulkFixtureOutsource,
  type BulkFixtureOutsourcePayload,
  type BulkFixtureOutsourceResult,
  type FixtureOutsourcePreview,
  type FixtureOutsourceScope,
} from "@/api/outsourceAssignmentsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatAssigneeOption } from "@/lib/employeeDisplay";

interface BulkOutsourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectLabel: string;
  workflowStage: string;
  scope: FixtureOutsourceScope;
  fixtureIds: string[];
  requestedCount: number;
  coordinators: Array<{ employee_id: string; name: string }>;
  onCompleted: (result: BulkFixtureOutsourceResult) => Promise<void> | void;
}

const PRIORITIES = [
  { value: "critical", label: "P1 - Critical" },
  { value: "high", label: "P2 - High" },
  { value: "medium", label: "P3 - Medium" },
  { value: "low", label: "P4 - Low" },
] as const;

function scopeLabel(scope: FixtureOutsourceScope) {
  return scope === "all_assignable" ? "All assignable fixtures" : "Selected fixtures";
}

function previewProjectLabel(
  project: FixtureOutsourcePreview["project"],
  fallback: string,
) {
  return [project.project_code, project.project_name].filter(Boolean).join(" — ") || fallback;
}

export function BulkOutsourceDialog({
  open,
  onOpenChange,
  projectId,
  projectLabel,
  workflowStage,
  scope,
  fixtureIds,
  requestedCount,
  coordinators,
  onCompleted,
}: BulkOutsourceDialogProps) {
  const [vendorId, setVendorId] = useState("");
  const [coordinatorId, setCoordinatorId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("high");
  const [instructions, setInstructions] = useState("");
  const [workOrderReference, setWorkOrderReference] = useState("");
  const [expectedDeliverables, setExpectedDeliverables] = useState("");
  const [referencePath, setReferencePath] = useState("");
  const [preview, setPreview] = useState<FixtureOutsourcePreview | null>(null);
  const [result, setResult] = useState<BulkFixtureOutsourceResult | null>(null);

  const vendorsQuery = useQuery({
    queryKey: ["design", "outsource", "vendors"],
    queryFn: fetchDesignVendors,
    enabled: open,
    retry: false,
  });

  const reset = () => {
    setVendorId("");
    setCoordinatorId("");
    setDeadline("");
    setPriority("high");
    setInstructions("");
    setWorkOrderReference("");
    setExpectedDeliverables("");
    setReferencePath("");
    setPreview(null);
    setResult(null);
  };

  const payload = useMemo<BulkFixtureOutsourcePayload>(() => ({
    project_id: projectId,
    workflow_stage: workflowStage,
    scope,
    fixture_ids: scope === "selected" ? fixtureIds : [],
    vendor_id: vendorId,
    internal_coordinator_id: coordinatorId,
    deadline,
    priority,
    instructions: instructions.trim(),
    work_order_reference: workOrderReference.trim() || undefined,
    expected_deliverables: expectedDeliverables.trim() || undefined,
    reference_path: referencePath.trim() || undefined,
  }), [
    coordinatorId,
    deadline,
    expectedDeliverables,
    fixtureIds,
    instructions,
    priority,
    projectId,
    referencePath,
    scope,
    vendorId,
    workflowStage,
    workOrderReference,
  ]);

  const requiredReady = Boolean(
    workflowStage
    && vendorId
    && coordinatorId
    && deadline
    && instructions.trim()
    && (scope !== "selected" || fixtureIds.length > 0),
  );

  const previewMutation = useMutation({
    mutationFn: () => previewBulkFixtureOutsource(payload),
    onSuccess: (nextPreview) => setPreview(nextPreview),
  });
  const outsourceMutation = useMutation({
    mutationFn: () => bulkOutsourceFixtures(payload),
    onSuccess: async (nextResult) => {
      setResult(nextResult);
      await onCompleted(nextResult);
    },
  });

  const busy = previewMutation.isPending || outsourceMutation.isPending;
  const close = () => {
    if (busy) return;
    reset();
    onOpenChange(false);
  };
  const error = previewMutation.error || outsourceMutation.error;
  const selectedVendor = vendorsQuery.data?.find((vendor) => vendor.id === vendorId);
  const selectedCoordinator = coordinators.find((coordinator) => coordinator.employee_id === coordinatorId);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && busy) {
        return;
      }
      if (!nextOpen) {
        reset();
      }
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Outsource fixture workflow stage</DialogTitle>
          <DialogDescription>
            Creates separate vendor assignments for the selected workflow stage only. Vendors are never employee assignees.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4" data-testid="bulk-outsource-result">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Requested</p><p className="text-xl font-semibold">{result.requested}</p></div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Successfully outsourced</p><p className="text-xl font-semibold text-emerald-900">{result.outsourced}</p></div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-800">Skipped</p><p className="text-xl font-semibold text-amber-900">{result.skipped.length}</p></div>
            </div>
            {result.outsourced > 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Outsourcing records were created transactionally.</p>
            ) : null}
            {result.skipped.length ? (
              <div className="rounded-md border border-amber-200">
                <div className="border-b bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Skipped fixtures</div>
                <ul className="divide-y text-sm">
                  {result.skipped.map((item, index) => (
                    <li key={item.fixture_id + "-" + item.code + "-" + index} className="px-3 py-2">
                      <span className="font-medium">{item.fixture_no || item.fixture_id}</span>
                      <Badge variant="outline" className="ml-2">{item.code}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : preview ? (
          <div className="space-y-4" data-testid="bulk-outsource-review">
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Project</p><p className="font-medium">{previewProjectLabel(preview.project, projectLabel)}</p></div>
              <div><p className="text-xs text-muted-foreground">Workflow stage</p><p className="font-medium">{preview.workflow_stage}</p></div>
              <div><p className="text-xs text-muted-foreground">Assignment scope</p><p className="font-medium">{scopeLabel(preview.scope)}</p></div>
              <div><p className="text-xs text-muted-foreground">External vendor</p><p className="font-medium">{selectedVendor?.name || vendorId}</p></div>
              <div><p className="text-xs text-muted-foreground">Internal coordinator</p><p className="font-medium">{selectedCoordinator ? formatAssigneeOption(selectedCoordinator) : coordinatorId}</p></div>
              <div><p className="text-xs text-muted-foreground">Deadline</p><p className="font-medium">{deadline}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Requested by backend</p><p className="text-xl font-semibold">{preview.requested}</p></div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Eligible</p><p className="text-xl font-semibold text-emerald-900">{preview.eligible}</p></div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-800">Will be skipped</p><p className="text-xl font-semibold text-amber-900">{preview.skipped.length}</p></div>
            </div>
            {preview.skipped.length ? (
              <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {preview.skipped.map((item, index) => <li key={item.fixture_id + item.code + index}>{item.fixture_no || item.fixture_id}: {item.message}</li>)}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Project</p><p className="font-medium">{projectLabel}</p></div>
              <div><p className="text-xs text-muted-foreground">Workflow stage</p><p className="font-medium">{workflowStage || "Select a workflow first"}</p></div>
              <div><p className="text-xs text-muted-foreground">Assignment scope</p><p className="font-medium">{scopeLabel(scope)}</p></div>
              <div><p className="text-xs text-muted-foreground">Fixtures requested</p><p className="font-medium">{requestedCount}</p></div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>External vendor *</Label>
                <Select value={vendorId || "__none__"} onValueChange={(value) => setVendorId(value === "__none__" ? "" : value)}>
                  <SelectTrigger disabled={vendorsQuery.isLoading}><SelectValue placeholder={vendorsQuery.isLoading ? "Loading vendors..." : "Select vendor"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select vendor</SelectItem>
                    {(vendorsQuery.data || []).map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.code ? vendor.code + " — " : ""}{vendor.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {vendorsQuery.isError ? <p className="text-xs text-destructive">Could not load vendors.</p> : null}
                {!vendorsQuery.isLoading && !vendorsQuery.isError && vendorsQuery.data?.length === 0 ? <p className="text-xs text-amber-700">No active vendors are configured.</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label>Internal coordinator *</Label>
                <Select value={coordinatorId || "__none__"} onValueChange={(value) => setCoordinatorId(value === "__none__" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="Select coordinator" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select coordinator</SelectItem>
                    {coordinators.map((coordinator) => <SelectItem key={coordinator.employee_id} value={coordinator.employee_id}>{formatAssigneeOption(coordinator)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Deadline *</Label><Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Priority *</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Instructions *</Label><Textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>PO / Work Order Reference</Label><Input value={workOrderReference} onChange={(event) => setWorkOrderReference(event.target.value)} /></div>
              <div className="space-y-1.5"><Label>Reference / File Path</Label><Input value={referencePath} onChange={(event) => setReferencePath(event.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Expected Deliverables</Label><Textarea rows={3} value={expectedDeliverables} onChange={(event) => setExpectedDeliverables(event.target.value)} /></div>
          </div>
        )}

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error instanceof Error ? error.message : "Outsourcing request failed."}</span>
          </div>
        ) : null}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={close}>Close</Button>
          ) : preview ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(null)}>Back</Button>
              <Button type="button" disabled={busy || preview.eligible === 0} onClick={() => outsourceMutation.mutate()}>
                {outsourceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm Outsource ({preview.eligible})
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
              <Button type="button" disabled={!requiredReady || busy || vendorsQuery.isError} onClick={() => previewMutation.mutate()}>
                {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Review Eligibility
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
