import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Copy,
  Clock3,
  FilePenLine,
  GitBranch,
  Loader2,
  LockKeyhole,
  MessageSquare,
  PencilLine,
  Play,
  RefreshCw,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import {
  addControlWorkflowStageComment,
  approveControlWorkflowRevision,
  approveControlWorkflowStage,
  createControlProjectWorkflow,
  fetchControlDesignAssignableUsers,
  fetchControlProjectWorkflow,
  fetchControlSubDepartments,
  fetchControlWorkflowTemplate,
  markControlWorkflowDispatched,
  markControlWorkflowRevisionChangesRequired,
  markControlWorkflowStagePreCompleted,
  markControlWorkflowStageRevisionRequired,
  overrideUnlockControlWorkflowStage,
  skipControlWorkflowStageByOverride,
  raiseControlWorkflowRevision,
  reassignControlProjectWorkflowOwner,
  startControlWorkflowRevision,
  startControlWorkflowStage,
  submitControlWorkflowRevision,
  submitControlWorkflowStage,
  updateControlWorkflowDocumentPath,
  type ControlDesignCapabilities,
  type ControlProjectWorkflow,
  type ControlRevisionReason,
  type ControlWorkflowRevision,
  type ControlWorkflowStage,
} from "@/api/controlWorkflowApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatAssigneeOption, formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { hasUserPermission, PERMISSIONS } from "@/lib/permissions";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { cn } from "@/lib/utils";
import type { ProjectDashboardSummary } from "@/types";

const CONTROL_DESIGN_NAME = "Control Design";

const REVISION_REASONS: ControlRevisionReason[] = [
  "ECN",
  "Customer Change",
  "Mechanical Design Change",
  "Internal Correction",
  "Scope Addition",
  "Scope Deletion",
  "Standardization Change",
  "Drawing Error Correction",
  "Vendor/Availability Issue",
  "Material Substitution",
  "Trial/Commissioning Feedback",
  "Site Feedback",
  "Other",
];

const stageStatusLabels: Record<ControlWorkflowStage["status"], string> = {
  locked: "Locked",
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted_for_approval: "Submitted for Approval",
  revision_required: "Revision Required",
  approved: "Approved",
  blocked: "Blocked",
  pre_completed: "Pre-Completed",
  skipped_by_override: "Skipped by Override",
};

const stageStatusClasses: Record<ControlWorkflowStage["status"], string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  in_progress: "border-sky-200 bg-sky-50 text-sky-800",
  submitted_for_approval: "border-amber-200 bg-amber-50 text-amber-900",
  revision_required: "border-orange-200 bg-orange-50 text-orange-900",
  locked: "border-slate-200 bg-slate-50 text-slate-500",
  not_started: "border-slate-200 bg-white text-slate-700",
  pre_completed: "border-violet-200 bg-violet-50 text-violet-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
  skipped_by_override: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

type ModalState =
  | { type: "submit"; stage: ControlWorkflowStage }
  | { type: "review"; stage: ControlWorkflowStage }
  | { type: "revisionRequired"; stage: ControlWorkflowStage }
  | { type: "raiseRevision"; stage: ControlWorkflowStage | null }
  | { type: "override"; stage: ControlWorkflowStage }
  | { type: "skipOverride"; stage: ControlWorkflowStage }
  | { type: "dispatch" }
  | { type: "revisionChangesRequired"; revision: ControlWorkflowRevision }
  | { type: "preCompleted"; stage: ControlWorkflowStage }
  | { type: "document"; stage: ControlWorkflowStage }
  | { type: "submitRevision"; revision: ControlWorkflowRevision }
  | null;

function defaultDateTimeLocal(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value: string | null | undefined, fallback = "Not set") {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pendingSubmission(stage: ControlWorkflowStage) {
  return stage.submissions.find((submission) => submission.status === "pending") || null;
}

function latestRevision(stage: ControlWorkflowStage) {
  return [...stage.revisions]
    .filter((revision) => revision.status !== "approved")
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] || null;
}

function isOwner(userId: string | undefined, workflow: ControlProjectWorkflow | null | undefined) {
  return Boolean(userId && workflow?.assigned_user_id === userId);
}

interface ControlWorkflowSectionProps {
  project: ProjectDashboardSummary;
  capabilities: ControlDesignCapabilities;
}

type StageHistoryEntry = {
  id: string;
  type: string;
  actorId?: string | null;
  actorName?: string | null;
  details?: string | null;
  createdAt: string;
};

const EVENT_LABELS: Record<string, string> = {
  stage_initialized: "Stage initialized",
  stage_unlocked: "Stage unlocked",
  stage_started: "Stage started",
  path_updated: "Document path updated",
  stage_submitted: "Submitted for approval",
  stage_approved: "Stage approved",
  changes_required: "Changes required",
  update_requested: "Update requested",
  update_started: "Update started",
  revision_submitted: "Updated work submitted",
  revision_approved: "Update approved",
  revision_changes_required: "Further changes required",
  comment_added: "Comment",
  assignment_changed: "Assignment changed",
  stage_pre_completed: "Stage pre-completed",
  override_performed: "Override performed",
};

function formatEventLabel(type: string) {
  return EVENT_LABELS[type] || type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageHistory(stage: ControlWorkflowStage): StageHistoryEntry[] {
  if ((stage.events || []).length > 0) {
    return (stage.events || [])
      .map((event) => ({
        id: event.id,
        type: event.event_type,
        actorId: event.actor_id,
        actorName: event.actor_name,
        details: event.details,
        createdAt: event.created_at,
      }))
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }

  const entries: StageHistoryEntry[] = [{
    id: stage.id + "-created",
    type: "stage_initialized",
    details: stage.sequence_order === 1 ? "Available when the workflow was created." : "Locked when the workflow was created.",
    createdAt: stage.created_at,
  }];
  if (stage.started_at) entries.push({ id: stage.id + "-started", type: "stage_started", createdAt: stage.started_at });
  stage.document_history.forEach((item) => entries.push({
    id: item.id,
    type: "path_updated",
    actorId: item.changed_by,
    actorName: item.changed_by_name,
    details: item.new_path,
    createdAt: item.created_at,
  }));
  stage.submissions.forEach((item) => entries.push({
    id: item.id,
    type: item.status === "approved" ? "stage_approved" : item.status === "revision_required" ? "changes_required" : "stage_submitted",
    actorId: item.status === "pending" ? item.submitted_by : item.reviewed_by,
    actorName: item.status === "pending" ? item.submitted_by_name : item.reviewed_by_name,
    details: item.review_remarks || item.remarks || item.submitted_document_path,
    createdAt: item.reviewed_at || item.created_at,
  }));
  stage.revisions.forEach((item) => entries.push({
    id: item.id,
    type: item.status === "approved" ? "revision_approved" : item.status === "submitted_for_approval" ? "revision_submitted" : "update_requested",
    actorId: item.approved_by || item.raised_by,
    actorName: item.approved_by_name || item.raised_by_name,
    details: item.description,
    createdAt: item.approved_at || item.submitted_at || item.created_at,
  }));
  return entries.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  stage.override_history.forEach((item) => entries.push({
    id: item.id,
    type: "override_performed",
    actorId: item.unlocked_by,
    actorName: item.unlocked_by_name,
    details: item.reason + (item.remarks ? " - " + item.remarks : ""),
    createdAt: item.created_at,
  }));

}

function stageView(stage: ControlWorkflowStage) {
  const revision = latestRevision(stage);
  if (revision?.status === "submitted_for_approval") {
    return { label: "Pending Approval", className: stageStatusClasses.submitted_for_approval, icon: Clock3, helper: "Updated work is waiting for approval." };
  }
  if (revision?.status === "in_progress") {
    return { label: "Update In Progress", className: stageStatusClasses.in_progress, icon: FilePenLine, helper: "The requested update is being prepared." };
  }
  if (revision && ["not_started", "changes_required"].includes(revision.status)) {
    return { label: "Update Required", className: stageStatusClasses.revision_required, icon: RefreshCw, helper: "Approved work needs an update before this revision can close." };
  }
  const Icon = stage.status === "approved" ? CheckCircle2
    : stage.status === "in_progress" ? FilePenLine
      : stage.status === "submitted_for_approval" ? Clock3
        : stage.status === "locked" ? LockKeyhole
          : stage.status === "revision_required" ? RefreshCw
            : Circle;
  return {
    label: stageStatusLabels[stage.status],
    className: stageStatusClasses[stage.status],
    icon: Icon,
    helper: stage.status === "locked" ? "Locked until the previous stage is approved." : null,
  };
}


export function ControlWorkflowSection({ project, capabilities }: ControlWorkflowSectionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ownerId, setOwnerId] = useState("");
  const [ownerReason, setOwnerReason] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});

  const controlSubDepartmentsQuery = useQuery({
    queryKey: ["control-workflow", "sub-departments"],
    queryFn: fetchControlSubDepartments,
    enabled: Boolean(user?.employee_id && capabilities.canViewWorkspace),
  });

  const controlDesignSubDepartment = (controlSubDepartmentsQuery.data ?? []).find(
    (subDepartment) => subDepartment.subdivision_name.toLowerCase() === CONTROL_DESIGN_NAME.toLowerCase(),
  ) || null;

  const templateQuery = useQuery({
    queryKey: ["control-workflow", "template", controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlWorkflowTemplate(controlDesignSubDepartment?.id || ""),
    enabled: Boolean(capabilities.canViewWorkspace && controlDesignSubDepartment?.id),
  });

  const workflowQuery = useQuery({
    queryKey: ["control-workflow", "project", project.project_id, controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlProjectWorkflow(project.project_id, controlDesignSubDepartment?.id || ""),
    enabled: Boolean(capabilities.canViewWorkspace && project.project_id && controlDesignSubDepartment?.id),
  });


  const workflow = workflowQuery.data || null;
  const owner = isOwner(user?.employee_id, workflow);
  const canAssignOwner = workflow ? capabilities.canReassignProject : capabilities.canAssignProject;
  const workflowClosed = workflow?.status === "cancelled" || workflow?.project_status === "dispatched";
  const ownerReasonRequired = Boolean(workflow?.assigned_user_id && ownerId && ownerId !== workflow.assigned_user_id);
  const canSelfApprove = hasUserPermission(user, PERMISSIONS.SELF_APPROVE);
  const selectedStage = workflow?.stages.find((stage) => stage.id === selectedStageId) || null;

  const assigneesQuery = useQuery({
    queryKey: ["control-workflow", "assignable-users", "control-design"],
    queryFn: fetchControlDesignAssignableUsers,
    enabled: Boolean(user?.employee_id && canAssignOwner),
  });

  const assignees = assigneesQuery.data ?? [];

  const invalidateControlWorkflow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["control-workflow"] }),
      queryClient.invalidateQueries({ queryKey: ["control-design", "projects"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
    ]);
  };

  const workflowMutation = useMutation({
    mutationFn: async (action: () => Promise<ControlProjectWorkflow>) => action(),
    onSuccess: async () => {
      setModal(null);
      setForm({});
      setOwnerId("");
      setOwnerReason("");
      await invalidateControlWorkflow();
    },
    onError: (error) => {
      toast({
        title: "Control workflow update failed",
        description: error instanceof Error ? error.message : "The workflow action could not be completed.",
        variant: "destructive",
      });
    },
  });
  const commentMutation = useMutation({
    mutationFn: ({ stageId, value }: { stageId: string; value: string }) => addControlWorkflowStageComment(stageId, value),
    onSuccess: async () => {
      setComment("");
      await invalidateControlWorkflow();
    },
    onError: (error) => {
      toast({
        title: "Comment could not be added",
        description: error instanceof Error ? error.message : "The comment was not saved.",
        variant: "destructive",
      });
    },
  });



  const createMutation = useMutation({
    mutationFn: () => createControlProjectWorkflow({
      project_id: project.project_id,
      sub_department_id: controlDesignSubDepartment?.id || "",
      template_id: templateQuery.data?.id,
      assigned_user_id: ownerId,
    }),
    onSuccess: async () => {
      setOwnerId("");
      setOwnerReason("");
      await invalidateControlWorkflow();
      toast({ title: "Control Design workflow assigned" });
    },
    onError: (error) => {
      toast({
        title: "Could not assign Control Design workflow",
        description: error instanceof Error ? error.message : "Workflow creation failed.",
        variant: "destructive",
      });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: () => reassignControlProjectWorkflowOwner(workflow?.id || "", ownerId, ownerReason.trim() || undefined),
    onSuccess: async () => {
      setOwnerId("");
      setOwnerReason("");
      await invalidateControlWorkflow();
      toast({ title: "Control Design owner updated" });
    },
    onError: (error) => {
      toast({
        title: "Could not reassign owner",
        description: error instanceof Error ? error.message : "Owner update failed.",
        variant: "destructive",
      });
    },
  });

  const openModal = (nextModal: ModalState) => {
    setModal(nextModal);
    if (!nextModal) {
      setForm({});
      return;
    }

    if (nextModal.type === "submit") {
      setForm({ submitted_document_path: nextModal.stage.current_document_path || "", remarks: "" });
    } else if (nextModal.type === "document") {
      setForm({ document_path: nextModal.stage.current_document_path || "", remarks: "" });
    } else if (nextModal.type === "revisionRequired") {
      setForm({ description: "", due_date: defaultDateTimeLocal(), remarks: "" });
    } else if (nextModal.type === "raiseRevision") {
      setForm({
        stage_id: nextModal.stage?.id || workflow?.current_stage_id || "",
        revision_reason: "Internal Correction",
        manual_reason: "",
        description: "",
        due_date: defaultDateTimeLocal(),
        priority: "medium",
        remarks: "",
      });
    } else if (nextModal.type === "override") {
      setForm({ reason: "", remarks: "", confirm_history_record: false });
    } else if (nextModal.type === "skipOverride") {
      setForm({ reason: "", supporting_document_path: nextModal.stage.current_document_path || "", approved_by: user?.employee_id || "", remarks: "" });
    } else if (nextModal.type === "dispatch") {
      setForm({ dispatch_date: defaultDateTimeLocal(0), remarks: "" });
    } else if (nextModal.type === "revisionChangesRequired") {
      setForm({ review_remarks: "" });
    } else if (nextModal.type === "preCompleted") {
      setForm({
        completion_date: defaultDateTimeLocal(0),
        document_path: nextModal.stage.current_document_path || "",
        approved_by: user?.employee_id || "",
        remarks: "",
      });
    } else if (nextModal.type === "submitRevision") {
      const stage = workflow?.stages.find((item) => item.id === nextModal.revision.workflow_stage_id);
      setForm({ submitted_document_path: stage?.current_document_path || "", remarks: "" });
    } else {
      setForm({ review_remarks: "" });
    }
  };

  const selectedAffectedStageIds = () => Object.entries(form)
    .filter(([key, value]) => key.startsWith("affected_stage_") && value === true)
    .map(([key]) => key.slice("affected_stage_".length));

  const runModalAction = () => {
    if (!modal) return;

    if (modal.type === "submit") {
      workflowMutation.mutate(() => submitControlWorkflowStage(modal.stage.id, {
        submitted_document_path: String(form.submitted_document_path || ""),
        remarks: String(form.remarks || ""),
      }));
    } else if (modal.type === "document") {
      workflowMutation.mutate(() => updateControlWorkflowDocumentPath(modal.stage.id, {
        document_path: String(form.document_path || ""),
        remarks: String(form.remarks || ""),
      }));
    } else if (modal.type === "review") {
      workflowMutation.mutate(() => approveControlWorkflowStage(modal.stage.id, {
        review_remarks: String(form.review_remarks || ""),
      }));
    } else if (modal.type === "revisionRequired") {
      workflowMutation.mutate(() => markControlWorkflowStageRevisionRequired(modal.stage.id, {
        review_remarks: String(form.description || ""),
        revision_reason: "Internal Correction",
        description: String(form.description || ""),
        due_date: new Date(String(form.due_date)).toISOString(),
        remarks: String(form.remarks || ""),
      }));
    } else if (modal.type === "raiseRevision") {
      const stageId = String(form.stage_id || modal.stage?.id || "");
      workflowMutation.mutate(() => raiseControlWorkflowRevision(stageId, {
        revision_reason: form.revision_reason as ControlRevisionReason,
        manual_reason: String(form.manual_reason || ""),
        description: String(form.description || ""),
        due_date: new Date(String(form.due_date)).toISOString(),
        priority: String(form.priority || ""),
        remarks: String(form.remarks || ""),
        affected_stage_ids: selectedAffectedStageIds(),
      }));
    } else if (modal.type === "override") {
      workflowMutation.mutate(() => overrideUnlockControlWorkflowStage(modal.stage.id, {
        reason: String(form.reason || ""),
        remarks: String(form.remarks || ""),
        confirm_history_record: form.confirm_history_record === true,
      }));
    } else if (modal.type === "skipOverride") {
      workflowMutation.mutate(() => skipControlWorkflowStageByOverride(modal.stage.id, {
        reason: String(form.reason || ""),
        supporting_document_path: String(form.supporting_document_path || ""),
        approved_by: String(form.approved_by || user?.employee_id || ""),
        remarks: String(form.remarks || ""),
      }));
    } else if (modal.type === "preCompleted") {
      workflowMutation.mutate(() => markControlWorkflowStagePreCompleted(modal.stage.id, {
        completion_date: new Date(String(form.completion_date)).toISOString(),
        document_path: String(form.document_path || ""),
        approved_by: String(form.approved_by || user?.employee_id || ""),
        remarks: String(form.remarks || ""),
      }));
    } else if (modal.type === "submitRevision") {
      workflowMutation.mutate(() => submitControlWorkflowRevision(modal.revision.id, {
        submitted_document_path: String(form.submitted_document_path || ""),
        remarks: String(form.remarks || ""),
      }));
    } else if (modal.type === "revisionChangesRequired") {
      workflowMutation.mutate(() => markControlWorkflowRevisionChangesRequired(modal.revision.id, {
        review_remarks: String(form.review_remarks || ""),
      }));
    } else if (modal.type === "dispatch" && workflow) {
      workflowMutation.mutate(() => markControlWorkflowDispatched(workflow.id, {
        dispatch_date: new Date(String(form.dispatch_date)).toISOString(),
        remarks: String(form.remarks || ""),
      }));
    }
  };

  const canRunModalAction = Boolean(!workflowMutation.isPending && (
    !modal
    || (modal.type === "review" && capabilities.canApprove)
    || (modal.type === "submit" && capabilities.canSubmitStage && String(form.submitted_document_path || "").trim())
    || (modal.type === "document" && capabilities.canUpdatePath && String(form.document_path || "").trim())
    || (modal.type === "revisionRequired" && capabilities.canRequestChanges && String(form.description || "").trim() && String(form.due_date || "").trim() && String(form.remarks || "").trim())
    || (
      modal.type === "raiseRevision"
      && capabilities.canRaiseRevision
      && String(form.stage_id || modal.stage?.id || "").trim()
      && String(form.revision_reason || "").trim()
      && String(form.description || "").trim()
      && String(form.due_date || "").trim()
      && (form.revision_reason !== "Other" || String(form.manual_reason || "").trim())
    )
    || (modal.type === "override" && capabilities.canOverrideUnlock && String(form.reason || "").trim() && String(form.remarks || "").trim() && form.confirm_history_record === true)
    || (modal.type === "skipOverride" && capabilities.canSkipStage && String(form.reason || "").trim() && String(form.supporting_document_path || "").trim() && String(form.approved_by || "").trim() && String(form.remarks || "").trim())
    || (modal.type === "dispatch" && capabilities.canMarkDispatched && String(form.dispatch_date || "").trim() && String(form.remarks || "").trim())
    || (modal.type === "revisionChangesRequired" && capabilities.canReviewRevision && String(form.review_remarks || "").trim())
    || (modal.type === "preCompleted" && capabilities.canMarkPreCompleted && String(form.completion_date || "").trim() && String(form.document_path || "").trim() && String(form.approved_by || "").trim())
    || (modal.type === "submitRevision" && capabilities.canExecuteRevision && String(form.submitted_document_path || "").trim())
  ));

  const startStage = (stage: ControlWorkflowStage) => {
    workflowMutation.mutate(() => startControlWorkflowStage(stage.id));
  };

  const startRevision = (revision: ControlWorkflowRevision) => {
    workflowMutation.mutate(() => startControlWorkflowRevision(revision.id));
  };

  const approveRevision = (revision: ControlWorkflowRevision) => {
    workflowMutation.mutate(() => approveControlWorkflowRevision(revision.id));
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast({ title: "Path copied" });
    } catch {
      toast({ title: "Could not copy path", variant: "destructive" });
    }
  };


  if (!controlDesignSubDepartment && controlSubDepartmentsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Control workflow
        </CardContent>
      </Card>
    );
  }

  if (!controlDesignSubDepartment) return null;

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="space-y-3 p-4 md:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-blue-700" />
              <h2 className="text-xl font-semibold text-blue-950">Project Lifecycle</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {formatProjectNumber(project)} · Stages unlock only after the previous stage is approved.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {workflow && canAssignOwner ? (
              <>
                <Select value={ownerId || "__none__"} onValueChange={(value) => setOwnerId(value === "__none__" ? "" : value)}>
                  <SelectTrigger className="h-9 w-[240px] text-xs">
                    <SelectValue placeholder={assigneesQuery.isLoading ? "Loading members..." : "Reassign member"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Reassign member</SelectItem>
                    {assignees.map((candidate) => (
                      <SelectItem key={candidate.employee_id} value={candidate.employee_id}>{formatAssigneeOption(candidate)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ownerReasonRequired ? (
                  <Input className="h-9 w-[240px] text-xs" value={ownerReason} placeholder="Reassignment reason" onChange={(event) => setOwnerReason(event.target.value)} />
                ) : null}
                <Button size="sm" variant="outline" disabled={!ownerId || reassignMutation.isPending || (ownerReasonRequired && !ownerReason.trim())} onClick={() => reassignMutation.mutate()}>
                  {reassignMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Reassign
                </Button>
              </>
            ) : null}
            {workflow && capabilities.canMarkDispatched && workflow.project_status === "ready_for_dispatch" && !workflowClosed ? (
              <Button size="sm" onClick={() => openModal({ type: "dispatch" })}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Mark Dispatched
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4 pt-0 md:p-6 md:pt-0">
        {workflowQuery.isLoading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading project lifecycle
          </div>
        ) : !workflow ? (
          <div className="rounded-lg border border-dashed p-4">
            <p className="mb-3 text-sm text-slate-600">The project exists, but its Control Design workflow has not been initialized.</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label>Assigned member</Label>
                <Select value={ownerId || "__none__"} onValueChange={(value) => setOwnerId(value === "__none__" ? "" : value)} disabled={!canAssignOwner || assigneesQuery.isLoading}>
                  <SelectTrigger><SelectValue placeholder="Select project owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select project owner</SelectItem>
                    {assignees.map((candidate) => (
                      <SelectItem key={candidate.employee_id} value={candidate.employee_id}>{formatAssigneeOption(candidate)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={!canAssignOwner || !ownerId || createMutation.isPending || !templateQuery.data} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Initialize Lifecycle
              </Button>
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {workflow.stages.map((stage, index) => {
              const pending = pendingSubmission(stage);
              const revision = latestRevision(stage);
              const view = stageView(stage);
              const Icon = view.icon;
              const locked = stage.status === "locked";
              const previousStage = index > 0 ? workflow.stages[index - 1] : null;
              const deadline = revision?.due_date || stage.due_date;
              const instruction = revision?.description || stage.remarks;
              const actionReady = !workflowMutation.isPending && !workflowClosed;
              const ownerActions = owner && actionReady;
              const canReviewSubmission = actionReady
                && Boolean(pending)
                && (pending?.submitted_by !== user?.employee_id || canSelfApprove);
              const canReviewRevision = actionReady
                && Boolean(pending)
                && revision?.status === "submitted_for_approval"
                && (pending?.submitted_by !== user?.employee_id || canSelfApprove);

              return (
                <li key={stage.id} className="grid grid-cols-[42px_minmax(0,1fr)] gap-3">
                  <div className="relative flex justify-center">
                    {index < workflow.stages.length - 1 ? <span className="absolute top-10 h-[calc(100%+12px)] w-px bg-slate-200" aria-hidden="true" /> : null}
                    <span className={cn("relative z-10 flex h-10 w-10 items-center justify-center rounded-full border bg-white", view.className)}>
                      <Icon className="h-5 w-5" />
                    </span>
                  </div>
                  <div className={cn("rounded-lg border bg-white p-4", stage.id === workflow.current_stage_id ? "border-blue-300 bg-blue-50/30" : "border-slate-200", locked && "bg-slate-50/70")}>
                    <button type="button" className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-start sm:justify-between" onClick={() => setSelectedStageId(stage.id)}>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">{String(stage.sequence_order).padStart(2, "0")}</span>
                          <span className="font-semibold text-slate-950">{stage.stage_name}</span>
                          {stage.id === workflow.current_stage_id ? <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">Current</Badge> : null}
                        </span>
                        {locked ? (
                          <span className="mt-1 block text-xs text-slate-500">{previousStage ? previousStage.stage_name + " must be approved before this stage can start." : view.helper}</span>
                        ) : view.helper ? (
                          <span className="mt-1 block text-xs text-slate-500">{view.helper}</span>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {stage.revision_count > 0 ? <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-800">Rev: {stage.revision_count}</Badge> : null}
                        <Badge variant="outline" className={cn("whitespace-nowrap", view.className)}>{view.label}</Badge>
                      </span>
                    </button>

                    {!locked && (revision || !["approved", "pre_completed"].includes(stage.status)) ? (
                      <div className="mt-3 grid gap-2 rounded-md bg-slate-50/80 p-3 text-xs text-slate-600 sm:grid-cols-2">
                        <span>Assigned: {formatEmployeeDisplay(workflow.assigned_user_id, workflow.assigned_user_name)}</span>
                        {deadline ? <span>Deadline: {formatDate(deadline)}</span> : null}
                        {instruction ? <span className="sm:col-span-2">Latest instruction: {instruction}</span> : null}
                        {pending ? (
                          <span className="sm:col-span-2">Submitted by {formatEmployeeDisplay(pending.submitted_by, pending.submitted_by_name)} on {formatDate(pending.created_at)}</span>
                        ) : null}
                      </div>
                    ) : !revision && ["approved", "pre_completed"].includes(stage.status) ? (
                      <p className="mt-3 text-xs text-slate-600">
                        Approved by {formatEmployeeDisplay(stage.approved_by, stage.approved_by_name)} on {formatDate(stage.approved_at)}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {!revision && ownerActions && capabilities.canStartStage && stage.status === "not_started" ? (
                        <Button size="sm" variant="outline" onClick={() => startStage(stage)}><Play className="mr-1.5 h-3.5 w-3.5" /> Start Stage</Button>
                      ) : null}
                      {!revision && ownerActions && capabilities.canSubmitStage && stage.status === "in_progress" ? (
                        <Button size="sm" onClick={() => openModal({ type: "submit", stage })}><Clock3 className="mr-1.5 h-3.5 w-3.5" /> Submit for Approval</Button>
                      ) : null}
                      {!revision && canReviewSubmission && capabilities.canApprove ? (
                        <Button size="sm" onClick={() => openModal({ type: "review", stage })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve</Button>
                      ) : null}
                      {!revision && canReviewSubmission && capabilities.canRequestChanges ? (
                        <Button size="sm" variant="outline" onClick={() => openModal({ type: "revisionRequired", stage })}>Request Changes</Button>
                      ) : null}
                      {revision && ownerActions && capabilities.canExecuteRevision && ["not_started", "changes_required"].includes(revision.status) ? (
                        <Button size="sm" variant="outline" onClick={() => startRevision(revision)}><Play className="mr-1.5 h-3.5 w-3.5" /> {revision.status === "changes_required" ? "Continue Update" : "Start Update"}</Button>
                      ) : null}
                      {revision && ownerActions && capabilities.canExecuteRevision && revision.status === "in_progress" ? (
                        <Button size="sm" onClick={() => openModal({ type: "submitRevision", revision })}><Clock3 className="mr-1.5 h-3.5 w-3.5" /> Submit Updated Work</Button>
                      ) : null}
                      {revision && canReviewRevision && capabilities.canReviewRevision ? (
                        <>
                          <Button size="sm" onClick={() => approveRevision(revision)}>Approve Update</Button>
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "revisionChangesRequired", revision })}>Request Changes</Button>
                        </>
                      ) : null}
                      {!revision && actionReady && capabilities.canRaiseRevision && ["approved", "pre_completed"].includes(stage.status) ? (
                        <Button size="sm" variant="outline" onClick={() => openModal({ type: "raiseRevision", stage })}><FilePenLine className="mr-1.5 h-3.5 w-3.5" /> Raise Revision</Button>
                      ) : null}
                      {ownerActions && capabilities.canUpdatePath && !locked ? (
                        <Button size="sm" variant="ghost" onClick={() => setSelectedStageId(stage.id)}><PencilLine className="mr-1.5 h-3.5 w-3.5" /> Update Path</Button>
                      ) : null}
                      {actionReady && capabilities.canOverrideUnlock && locked ? (
                        <Button size="sm" variant="ghost" onClick={() => openModal({ type: "override", stage })}><Unlock className="mr-1.5 h-3.5 w-3.5" /> Override Unlock</Button>
                      ) : null}
                      {actionReady && capabilities.canMarkPreCompleted && !["approved", "pre_completed", "skipped_by_override"].includes(stage.status) ? (
                        <Button size="sm" variant="ghost" onClick={() => openModal({ type: "preCompleted", stage })}>Mark Pre-Completed</Button>
                      ) : null}
                      {actionReady && capabilities.canSkipStage && !["approved", "pre_completed", "skipped_by_override"].includes(stage.status) ? (
                        <Button size="sm" variant="ghost" onClick={() => openModal({ type: "skipOverride", stage })}>Skip by Override</Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setSelectedStageId(stage.id)}>View Details</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <Sheet open={Boolean(selectedStage)} onOpenChange={(open) => { if (!open) setSelectedStageId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedStage ? (() => {
            const history = stageHistory(selectedStage);
            const comments = history.filter((entry) => entry.type === "comment_added");
            const startedEvent = history.find((entry) => entry.type === "stage_started");
            const path = selectedStage.current_document_path || "";
            const canOpenPath = /^https?:\/\//i.test(path);
            const selectedView = stageView(selectedStage);
            const selectedRevision = latestRevision(selectedStage);
            const latestSubmissionDetails = [...selectedStage.submissions].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] || null;
            return (
              <div className="space-y-6">
                <SheetHeader className="pr-8">
                  <SheetTitle>{selectedStage.stage_name}</SheetTitle>
                  <SheetDescription>Review document paths, stage details, history, and comments.</SheetDescription>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("whitespace-nowrap", selectedView.className)}>{selectedView.label}</Badge>
                    <span>Revision {selectedStage.revision_count}</span>
                  </div>
                </SheetHeader>

                <section className="space-y-3">
                  <h3 className="font-semibold text-slate-950">Document Paths</h3>
                  <div className="rounded-lg border p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project root path</p>
                    <p className="mt-1 text-slate-700">Not configured</p>
                  </div>
                  <div className="rounded-lg border p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current stage path</p>
                    <p className="mt-1 break-all text-slate-700">{path || "Not set"}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={!path} onClick={() => void copyPath(path)}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy path</Button>
                      <Button size="sm" variant="outline" disabled={!canOpenPath} onClick={() => window.open(path, "_blank", "noopener,noreferrer")}>Open path</Button>
                      {owner && capabilities.canUpdatePath && !workflowClosed && selectedStage.status !== "locked" ? (
                        <Button size="sm" variant="outline" onClick={() => openModal({ type: "document", stage: selectedStage })}>Update path</Button>
                      ) : null}
                    </div>
                    {path && !canOpenPath ? <p className="mt-2 text-xs text-slate-500">Local and network paths can be copied, but browsers cannot open them directly.</p> : null}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="font-semibold text-slate-950">Stage Information</h3>
                  <dl className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-slate-500">Assigned to</dt><dd className="font-medium">{formatEmployeeDisplay(workflow?.assigned_user_id, workflow?.assigned_user_name)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Started by</dt><dd className="font-medium">{startedEvent ? formatEmployeeDisplay(startedEvent.actorId, startedEvent.actorName) : "Not started"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Started</dt><dd className="font-medium">{formatDate(selectedStage.started_at)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Submitted by</dt><dd className="font-medium">{latestSubmissionDetails ? formatEmployeeDisplay(latestSubmissionDetails.submitted_by, latestSubmissionDetails.submitted_by_name) : "Not submitted"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Submitted at</dt><dd className="font-medium">{formatDate(selectedStage.submitted_at || latestSubmissionDetails?.created_at)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Deadline</dt><dd className="font-medium">{formatDate(selectedRevision?.due_date || selectedStage.due_date)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Revision</dt><dd className="font-medium">{selectedStage.revision_count}</dd></div>
                    <div><dt className="text-xs text-slate-500">Approved by</dt><dd className="font-medium">{formatEmployeeDisplay(selectedStage.approved_by, selectedStage.approved_by_name)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Approved</dt><dd className="font-medium">{formatDate(selectedStage.approved_at)}</dd></div>
                  </dl>
                </section>

                <section className="space-y-3">
                  <h3 className="font-semibold text-slate-950">History</h3>
                  <ol className="space-y-3">
                    {history.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">{formatEventLabel(entry.type)}</span>
                          <span className="text-xs text-slate-500">{formatDate(entry.createdAt)}</span>
                        </div>
                        {entry.actorId ? <p className="text-xs text-slate-500">{formatEmployeeDisplay(entry.actorId, entry.actorName)}</p> : null}
                        {entry.details ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{entry.details}</p> : null}
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-700" />
                    <h3 className="font-semibold text-slate-950">Comments</h3>
                  </div>
                  {comments.length > 0 ? (
                    <div className="space-y-2">
                      {comments.map((entry) => (
                        <div key={entry.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                          <div className="flex justify-between gap-2 text-xs text-slate-500">
                            <span>{formatEmployeeDisplay(entry.actorId, entry.actorName)}</span>
                            <span>{formatDate(entry.createdAt)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-slate-800">{entry.details}</p>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-slate-500">No comments yet.</p>}
                  <Textarea aria-label="Add stage comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment" rows={3} />
                  <Button
                    size="sm"
                    disabled={!comment.trim() || commentMutation.isPending}
                    onClick={() => commentMutation.mutate({ stageId: selectedStage.id, value: comment.trim() })}
                  >
                    {commentMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Add Comment
                  </Button>
                </section>
              </div>
            );
          })() : null}
        </SheetContent>
      </Sheet>

      <WorkflowModal
        modal={modal}
        workflow={workflow}
        form={form}
        isPending={workflowMutation.isPending}
        canRun={canRunModalAction}
        onFormChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
        onRevisionRequired={(stage) => openModal({ type: "revisionRequired", stage })}
        onClose={() => openModal(null)}
        onConfirm={runModalAction}
      />
    </Card>
  );
}

function WorkflowModal({
  modal,
  workflow,
  form,
  isPending,
  canRun,
  onFormChange,
  onRevisionRequired,
  onClose,
  onConfirm,
}: {
  modal: ModalState;
  workflow: ControlProjectWorkflow | null;
  form: Record<string, string | boolean>;
  isPending: boolean;
  canRun: boolean;
  onFormChange: (key: string, value: string | boolean) => void;
  onRevisionRequired: (stage: ControlWorkflowStage) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = Boolean(modal);
  const title = modal?.type === "submit" ? "Submit for Approval"
    : modal?.type === "review" ? "Approval Review"
      : modal?.type === "revisionRequired" ? "Revision Required"
        : modal?.type === "raiseRevision" ? "Raise Revision"
          : modal?.type === "override" ? "Override Unlock"
            : modal?.type === "preCompleted" ? "Mark Pre-Completed"
              : modal?.type === "document" ? "Update Document Path"
                : modal?.type === "submitRevision" ? "Submit Revision"
                  : modal?.type === "skipOverride" ? "Skipped by Override"
                    : modal?.type === "dispatch" ? "Mark Dispatched"
                      : modal?.type === "revisionChangesRequired" ? "Revision Changes Required"
                        : "";

  const confirmLabel = modal?.type === "submit" ? "Confirm submit"
    : modal?.type === "review" ? "Approve"
      : modal?.type === "revisionRequired" ? "Revision Required"
        : modal?.type === "override" ? "Unlock Stage"
          : modal?.type === "preCompleted" ? "Mark as Pre-Completed"
            : modal?.type === "submitRevision" ? "Submit Revision"
              : modal?.type === "skipOverride" ? "Mark Skipped"
                : modal?.type === "dispatch" ? "Mark Dispatched"
                  : modal?.type === "revisionChangesRequired" ? "Changes Required"
                    : "Save";

  const description = modal?.type === "submit" ? "Submit the current Control workflow stage for approval."
    : modal?.type === "review" ? "Review a submitted Control workflow stage."
      : modal?.type === "revisionRequired" ? "Send the submitted Control workflow stage back for revision."
        : modal?.type === "raiseRevision" ? "Raise a revision against a Control workflow stage."
          : modal?.type === "override" ? "Unlock a Control workflow stage and record the override."
            : modal?.type === "preCompleted" ? "Record a Control workflow stage as pre-completed."
              : modal?.type === "document" ? "Update the current document path for the stage."
                : modal?.type === "submitRevision" ? "Submit a Control workflow revision for approval."
                  : "Control workflow action.";

  const stage = modal && "stage" in modal ? modal.stage : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>

        {modal?.type === "submit" ? (
          <div className="space-y-3">
            <Field label="Stage name" value={modal.stage.stage_name} readOnly />
            <Field label="Submitted document path" value={String(form.submitted_document_path || "")} onChange={(value) => onFormChange("submitted_document_path", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "review" ? (
          <div className="space-y-3">
            <Field label="Stage name" value={modal.stage.stage_name} readOnly />
            <Field label="Submitted by" value={formatEmployeeDisplay(pendingSubmission(modal.stage)?.submitted_by || null, pendingSubmission(modal.stage)?.submitted_by_name)} readOnly />
            <Field label="Submitted document path" value={pendingSubmission(modal.stage)?.submitted_document_path || "Not set"} readOnly />
            <TextField label="Remarks" value={String(form.review_remarks || "")} onChange={(value) => onFormChange("review_remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "revisionRequired" ? (
          <div className="space-y-3">
            <Field label="Stage name" value={modal.stage.stage_name} readOnly />
            <TextField label="Required changes" value={String(form.description || "")} onChange={(value) => onFormChange("description", value)} />
            <Field label="Due date/time" type="datetime-local" value={String(form.due_date || "")} onChange={(value) => onFormChange("due_date", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "raiseRevision" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Select stage</Label>
              <Select value={String(form.stage_id || "")} onValueChange={(value) => onFormChange("stage_id", value)}>
                <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  {(workflow?.stages ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.stage_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Revision reason</Label>
              <Select value={String(form.revision_reason || "Internal Correction")} onValueChange={(value) => onFormChange("revision_reason", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REVISION_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.revision_reason === "Other" ? (
              <Field label="Manual reason" value={String(form.manual_reason || "")} onChange={(value) => onFormChange("manual_reason", value)} />
            ) : null}
            <TextField label="Description" value={String(form.description || "")} onChange={(value) => onFormChange("description", value)} />
            <Field label="Due date/time" type="datetime-local" value={String(form.due_date || "")} onChange={(value) => onFormChange("due_date", value)} />
            <Field label="Priority optional" value={String(form.priority || "")} onChange={(value) => onFormChange("priority", value)} />
            <TextField label="Remarks optional" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
            <div className="space-y-2">
              <Label>Affected stages optional</Label>
              <div className="max-h-36 space-y-2 overflow-auto rounded-md border p-2">
                {(workflow?.stages ?? [])
                  .filter((item) => item.id !== String(form.stage_id || ""))
                  .map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form["affected_stage_" + item.id] === true}
                        onCheckedChange={(checked) => onFormChange("affected_stage_" + item.id, checked === true)}
                      />
                      <span>{item.stage_name}</span>
                    </label>
                  ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Assign to project owner by default</p>
          </div>
        ) : null}

        {modal?.type === "override" ? (
          <div className="space-y-3">
            <Field label="Stage to unlock" value={modal.stage.stage_name} readOnly />
            <Field label="Reason" value={String(form.reason || "")} onChange={(value) => onFormChange("reason", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={form.confirm_history_record === true}
                onCheckedChange={(checked) => onFormChange("confirm_history_record", checked === true)}
              />
              <span>I understand this will be recorded in workflow history</span>
            </label>
          </div>
        ) : null}

        {modal?.type === "skipOverride" ? (
          <div className="space-y-3">
            <Field label="Stage" value={modal.stage.stage_name} readOnly />
            <Field label="Reason" value={String(form.reason || "")} onChange={(value) => onFormChange("reason", value)} />
            <Field label="Supporting document path" value={String(form.supporting_document_path || "")} onChange={(value) => onFormChange("supporting_document_path", value)} />
            <Field label="Approved by" value={String(form.approved_by || "")} onChange={(value) => onFormChange("approved_by", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "dispatch" ? (
          <div className="space-y-3">
            <Field label="Dispatch date" type="datetime-local" value={String(form.dispatch_date || "")} onChange={(value) => onFormChange("dispatch_date", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "revisionChangesRequired" ? (
          <div className="space-y-3">
            <Field label="Stage" value={modal.revision.stage_name || "Revision"} readOnly />
            <TextField label="Required changes" value={String(form.review_remarks || "")} onChange={(value) => onFormChange("review_remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "preCompleted" ? (
          <div className="space-y-3">
            <Field label="Stage" value={modal.stage.stage_name} readOnly />
            <Field label="Completion date" type="datetime-local" value={String(form.completion_date || "")} onChange={(value) => onFormChange("completion_date", value)} />
            <Field label="Document path" value={String(form.document_path || "")} onChange={(value) => onFormChange("document_path", value)} />
            <Field label="Approved by" value={String(form.approved_by || "")} onChange={(value) => onFormChange("approved_by", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "document" ? (
          <div className="space-y-3">
            <Field label="Stage" value={modal.stage.stage_name} readOnly />
            <Field label="Document path" value={String(form.document_path || "")} onChange={(value) => onFormChange("document_path", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        {modal?.type === "submitRevision" ? (
          <div className="space-y-3">
            <Field label="Stage" value={stage?.stage_name || modal.revision.stage_name || "Revision"} readOnly />
            <Field label="Submitted document path" value={String(form.submitted_document_path || "")} onChange={(value) => onFormChange("submitted_document_path", value)} />
            <TextField label="Remarks" value={String(form.remarks || "")} onChange={(value) => onFormChange("remarks", value)} />
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          {modal?.type === "review" ? (
            <Button type="button" variant="outline" onClick={() => onRevisionRequired(modal.stage)} disabled={isPending}>
              Revision Required
            </Button>
          ) : null}
          <Button type="button" disabled={!canRun} onClick={onConfirm}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  type = "text",
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input id={fieldId} type={type} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} />
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const fieldId = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Textarea id={fieldId} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
    </div>
  );
}
