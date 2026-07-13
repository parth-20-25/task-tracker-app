import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Clock3, FileCheck2, Loader2 } from "lucide-react";

import {
  assignFixtureReleaseDeliverable,
  fetchFixtureReleasePackage,
  reviewFixtureReleaseDeliverable,
  setMimicReleaseDeliverableApplicability,
  startFixtureReleaseDeliverable,
  submitFixtureReleaseDeliverable,
  type FixtureReleaseDeliverable,
  type FixtureReleasePackageResponse,
  type ReleaseDeliverableAction,
} from "@/api/releaseDeliverablesApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatAssigneeOption } from "@/lib/employeeDisplay";
import { releaseDeliverableStatusLabel } from "@/lib/releaseDeliverables";
import { cn } from "@/lib/utils";

type DialogAction = {
  type: ReleaseDeliverableAction;
  deliverable: FixtureReleaseDeliverable;
} | null;

interface ReleaseDeliverablesPanelProps {
  fixtureId: string;
  departmentId?: string;
  assignableUsers?: Array<{ employee_id: string; name: string }>;
  readOnly?: boolean;
  onStatusChange?: (response: FixtureReleasePackageResponse | null) => void;
}

function formatDateTime(value: string | null | undefined, fallback = "Not set") {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionLabel(action: ReleaseDeliverableAction) {
  switch (action) {
    case "ASSIGN":
      return "Assign";
    case "START":
      return "Start";
    case "SUBMIT":
      return "Submit";
    case "REVIEW":
      return "Review";
    case "SET_APPLICABILITY":
      return "Set applicability";
    default:
      return action;
  }
}

function actionTitle(action: ReleaseDeliverableAction) {
  switch (action) {
    case "ASSIGN":
      return "Assign release deliverable";
    case "SUBMIT":
      return "Submit release deliverable";
    case "REVIEW":
      return "Review release deliverable";
    case "SET_APPLICABILITY":
      return "Mimic Display applicability";
    default:
      return actionLabel(action);
  }
}

export function ReleaseDeliverablesPanel({
  fixtureId,
  departmentId,
  assignableUsers = [],
  readOnly = false,
  onStatusChange,
}: ReleaseDeliverablesPanelProps) {
  const queryClient = useQueryClient();
  const [dialogAction, setDialogAction] = useState<DialogAction>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [comment, setComment] = useState("");
  const [reviewDecision, setReviewDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [applicability, setApplicability] = useState<"REQUIRED" | "NOT_APPLICABLE">("REQUIRED");

  const queryKey = useMemo(
    () => ["workflow", "release-package", fixtureId, departmentId || "self"],
    [departmentId, fixtureId],
  );
  const releaseQuery = useQuery({
    queryKey,
    queryFn: () => fetchFixtureReleasePackage(fixtureId, departmentId),
    enabled: Boolean(fixtureId),
    retry: false,
  });

  useEffect(() => {
    onStatusChange?.(releaseQuery.data || null);
  }, [onStatusChange, releaseQuery.data]);

  const resetDialog = () => {
    setDialogAction(null);
    setAssigneeId("");
    setDueAt("");
    setComment("");
    setReviewDecision("APPROVE");
    setApplicability("REQUIRED");
  };

  const actionMutation = useMutation({
    mutationFn: async (action: NonNullable<DialogAction>) => {
      if (action.type === "ASSIGN") {
        return assignFixtureReleaseDeliverable(fixtureId, action.deliverable.id, {
          assignee_id: assigneeId,
          due_at: new Date(dueAt).toISOString(),
        });
      }
      if (action.type === "START") {
        return startFixtureReleaseDeliverable(fixtureId, action.deliverable.id);
      }
      if (action.type === "SUBMIT") {
        return submitFixtureReleaseDeliverable(fixtureId, action.deliverable.id, comment.trim() || undefined);
      }
      if (action.type === "REVIEW") {
        return reviewFixtureReleaseDeliverable(fixtureId, action.deliverable.id, {
          decision: reviewDecision,
          reason: comment.trim() || undefined,
        });
      }
      return setMimicReleaseDeliverableApplicability(fixtureId, action.deliverable.id, {
        applicability,
        reason: comment.trim() || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      resetDialog();
      toast({ title: "Release deliverable updated" });
    },
    onError: (error) => {
      toast({
        title: "Release deliverable update failed",
        description: error instanceof Error ? error.message : "Could not update the release deliverable.",
        variant: "destructive",
      });
    },
  });

  const runAction = (action: ReleaseDeliverableAction, deliverable: FixtureReleaseDeliverable) => {
    const next = { type: action, deliverable } as NonNullable<DialogAction>;
    if (action === "START") {
      actionMutation.mutate(next);
      return;
    }
    setDialogAction(next);
  };

  const response = releaseQuery.data;
  const releasePackage = response?.release_package || null;
  const effectiveReadOnly = readOnly || response?.statuses.release.code === "RELEASED";
  const approved = Number(response?.statuses.release_deliverables.approved || 0);
  const total = Number(response?.statuses.release_deliverables.total || 0);
  const progressPercent = total > 0 ? Math.round((approved / total) * 100) : 0;
  const dialogReady = dialogAction?.type === "ASSIGN"
    ? Boolean(assigneeId && dueAt)
    : dialogAction?.type === "REVIEW" && reviewDecision === "REJECT"
      ? Boolean(comment.trim())
      : dialogAction?.type === "SET_APPLICABILITY" && applicability === "NOT_APPLICABLE"
        ? Boolean(comment.trim())
        : true;

  return (
    <Card data-testid="release-deliverables-panel" className="border-cyan-200 bg-cyan-50/30 shadow-sm">
      <CardHeader className="space-y-3 p-4 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-cyan-700" />
              <h3 className="text-sm font-semibold">2D Release Deliverables</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Separate from the main fixture workflow.</p>
          </div>
          {releasePackage ? <Badge variant="outline">Package v{releasePackage.version}</Badge> : null}
        </div>

        {response ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border bg-background p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Main Workflow</div>
              <div className="text-sm font-semibold">{response.statuses.main_workflow.label}</div>
            </div>
            <div className="rounded-md border bg-background p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">2D Deliverables</div>
              <div className="text-sm font-semibold">{response.statuses.release_deliverables.label}</div>
            </div>
            <div className="rounded-md border bg-background p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Release Status</div>
              <div className="text-sm font-semibold">{response.statuses.release.label}</div>
            </div>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        {releaseQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading release deliverables...
          </div>
        ) : releaseQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p>{releaseQuery.error instanceof Error ? releaseQuery.error.message : "Could not load release deliverables."}</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => releaseQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {response?.blockers.length ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3" role="status">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Release blockers
                </div>
                <ul className="mt-1 space-y-1 text-xs text-amber-900">
                  {response.blockers.map((blocker, index) => (
                    <li key={blocker.code + "-" + index}>{blocker.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>Overall deliverables progress</span>
                <span className="font-semibold">{approved}/{total} approved</span>
              </div>
              <Progress value={progressPercent} aria-label="Release deliverables progress" />
            </div>

            {!releasePackage ? (
              <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
                The release package is created automatically after the fixture 2D stage is approved.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border bg-background">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[70px]">Seq.</TableHead>
                      <TableHead className="min-w-[220px]">Deliverable</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-[170px]">Assignee</TableHead>
                      <TableHead className="min-w-[150px]">Due date</TableHead>
                      <TableHead className="min-w-[220px]">Latest comment</TableHead>
                      <TableHead className="min-w-[210px] text-right">Available action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {releasePackage.deliverables.map((deliverable) => (
                      <TableRow
                        key={deliverable.id}
                        className={cn(deliverable.is_current_actionable && "bg-cyan-50")}
                      >
                        <TableCell className="align-top font-medium">{deliverable.sequence}</TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{deliverable.deliverable_label}</span>
                            {deliverable.is_current_actionable ? <Badge>Current actionable</Badge> : null}
                            {!deliverable.is_required ? <Badge variant="outline">Optional</Badge> : null}
                          </div>
                          <details className="mt-2 text-xs text-muted-foreground">
                            <summary className="flex cursor-pointer list-none items-center gap-1 font-medium">
                              <ChevronDown className="h-3 w-3" /> History ({deliverable.events.length})
                            </summary>
                            {deliverable.events.length ? (
                              <ul className="mt-2 space-y-1 border-l pl-3">
                                {deliverable.events.map((event, index) => (
                                  <li key={(event.id || event.event_type) + "-" + index}>
                                    <span className="font-medium text-foreground">{event.event_type.replace(/_/g, " ")}</span>
                                    {" · "}{formatDateTime(event.created_at)}
                                    {event.actor_name || event.actor_id ? " · " + (event.actor_name || event.actor_id) : ""}
                                    {event.reason ? " · " + event.reason : ""}
                                  </li>
                                ))}
                              </ul>
                            ) : <p className="mt-1">No history yet.</p>}
                          </details>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline">{releaseDeliverableStatusLabel(deliverable.status)}</Badge>
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          {deliverable.assignee_name || deliverable.assignee_id || "Unassigned"}
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          <div>{formatDateTime(deliverable.due_at)}</div>
                          {deliverable.is_overdue ? (
                            <Badge variant="destructive" className="mt-1">
                              <Clock3 className="mr-1 h-3 w-3" /> Overdue
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[260px] whitespace-normal align-top text-xs">
                          {deliverable.latest_comment || "No comment"}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {!effectiveReadOnly && deliverable.available_actions.map((action) => (
                              <Button
                                key={action}
                                type="button"
                                size="sm"
                                variant={action === "START" || action === "SUBMIT" ? "default" : "outline"}
                                className="h-7 px-2 text-[11px]"
                                disabled={actionMutation.isPending}
                                onClick={() => runAction(action, deliverable)}
                              >
                                {actionMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                {actionLabel(action)}
                              </Button>
                            ))}
                            {effectiveReadOnly || deliverable.available_actions.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No action</span>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={Boolean(dialogAction)} onOpenChange={(open) => {
        if (!open && !actionMutation.isPending) {
          resetDialog();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogAction ? actionTitle(dialogAction.type) : "Release deliverable"}</DialogTitle>
          </DialogHeader>

          {dialogAction?.type === "ASSIGN" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select value={assigneeId || "__none__"} onValueChange={(value) => setAssigneeId(value === "__none__" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="Select assignee" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select assignee</SelectItem>
                    {assignableUsers.map((user) => (
                      <SelectItem key={user.employee_id} value={user.employee_id}>{formatAssigneeOption(user)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
              </div>
            </div>
          ) : null}

          {dialogAction?.type === "SUBMIT" ? (
            <div className="space-y-1.5">
              <Label>Submission comment</Label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
            </div>
          ) : null}

          {dialogAction?.type === "REVIEW" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Decision</Label>
                <Select value={reviewDecision} onValueChange={(value) => setReviewDecision(value as "APPROVE" | "REJECT")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="APPROVE">Approve</SelectItem>
                    <SelectItem value="REJECT">Changes required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{reviewDecision === "REJECT" ? "Reason" : "Comment"}</Label>
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
              </div>
            </div>
          ) : null}

          {dialogAction?.type === "SET_APPLICABILITY" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Applicability</Label>
                <Select value={applicability} onValueChange={(value) => setApplicability(value as "REQUIRED" | "NOT_APPLICABLE")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REQUIRED">Required</SelectItem>
                    <SelectItem value="NOT_APPLICABLE">Not Applicable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {applicability === "NOT_APPLICABLE" ? (
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetDialog} disabled={actionMutation.isPending}>Cancel</Button>
            <Button
              type="button"
              disabled={!dialogAction || !dialogReady || actionMutation.isPending}
              onClick={() => {
                if (dialogAction) {
                  actionMutation.mutate(dialogAction);
                }
              }}
            >
              {actionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
