import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Copy,
  Download,
  Eye,
  Clock3,
  FilePenLine,
  FileText,
  GitBranch,
  Loader2,
  LockKeyhole,
  MessageSquare,
  PencilLine,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Unlock,
} from "lucide-react";
import {
  addControlWorkflowStageComment,
  approveControlWorkflowRevision,
  approveControlWorkflowStage,
  createControlProjectWorkflow,
  downloadControlWorkflowProof,
  fetchControlDesignAssignableUsers,
  fetchControlWorkflowProofBlob,
  fetchControlProjectWorkflow,
  fetchControlSubDepartments,
  fetchControlWorkflowTemplate,
  markControlWorkflowDispatched,
  markControlWorkflowRevisionChangesRequired,
  markControlWorkflowStagePreCompleted,
  markControlWorkflowStageRevisionRequired,
  openControlWorkflowProof,
  overrideUnlockControlWorkflowStage,
  removeControlWorkflowProof,
  skipControlWorkflowStageByOverride,
  raiseControlWorkflowRevision,
  reassignControlProjectWorkflowOwner,
  startControlWorkflowRevision,
  startControlWorkflowStage,
  submitControlWorkflowRevision,
  submitControlWorkflowStage,
  updateControlWorkflowDocumentPath,
  uploadControlWorkflowProof,
  type ControlDesignCapabilities,
  type ControlProjectWorkflow,
  type ControlRevisionReason,
  type ControlWorkflowProof,
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
  "Other",
];

const stageStatusLabels: Record<ControlWorkflowStage["status"], string> = {
  locked: "Locked",
  available: "Not Started",
  in_progress: "In Progress",
  pending_approval: "Pending Approval",
  changes_required: "Changes Required",
  update_required: "Update Required",
  approved: "Approved",
  blocked: "Blocked",
  pre_completed: "Pre-Completed",
  skipped_by_override: "Skipped by Override",
};

const stageStatusClasses: Record<ControlWorkflowStage["status"], string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  in_progress: "border-sky-200 bg-sky-50 text-sky-800",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-900",
  changes_required: "border-orange-200 bg-orange-50 text-orange-900",
  update_required: "border-orange-200 bg-orange-50 text-orange-900",
  locked: "border-slate-200 bg-slate-50 text-slate-500",
  available: "border-blue-200 bg-blue-50 text-blue-800",
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
    id: `${stage.id}-created`,
    type: "stage_initialized",
    details: stage.sequence_order === 1 ? "Available when the workflow was created." : "Locked when the workflow was created.",
    createdAt: stage.created_at,
  }];
  if (stage.started_at) entries.push({ id: `${stage.id}-started`, type: "stage_started", actorId: stage.started_by, actorName: stage.started_by_name, createdAt: stage.started_at });
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
  stage.override_history.forEach((item) => entries.push({
    id: item.id,
    type: "override_performed",
    actorId: item.unlocked_by,
    actorName: item.unlocked_by_name,
    details: item.reason + (item.remarks ? ` - ${item.remarks}` : ""),
    createdAt: item.created_at,
  }));
  return entries.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function stageView(stage: ControlWorkflowStage) {
  const revision = latestRevision(stage);
  if (stage.status === "pending_approval") {
    return { label: "Pending Approval", className: stageStatusClasses.pending_approval, icon: Clock3, helper: "Submitted work is awaiting approval." };
  }
  if (revision?.status === "in_progress") {
    return { label: "Update In Progress", className: stageStatusClasses.update_required, icon: FilePenLine, helper: "The requested update is being prepared." };
  }
  if (revision && ["not_started", "changes_required"].includes(revision.status)) {
    return { label: "Update Required", className: stageStatusClasses.update_required, icon: RefreshCw, helper: "Approved work needs an update before this revision can close." };
  }
  const Icon = stage.status === "approved" ? CheckCircle2
    : stage.status === "in_progress" ? FilePenLine
      : stage.status === "pending_approval" ? Clock3
        : stage.status === "locked" ? LockKeyhole
          : ["changes_required", "update_required"].includes(stage.status) ? RefreshCw
            : Circle;
  return {
    label: stageStatusLabels[stage.status],
    className: stageStatusClasses[stage.status],
    icon: Icon,
    helper: stage.status === "locked" ? "Locked until the previous stage is approved." : null,
  };
}
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function ProofThumbnail({ proof }: { proof: ControlWorkflowProof }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = proof.mime_type.startsWith("image/");
  useEffect(() => {
    if (!isImage) return undefined;
    let active = true;
    let objectUrl: string | null = null;
    void fetchControlWorkflowProofBlob(proof.open_url).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImage, proof.open_url]);
  if (isImage && url) return <img src={url} alt="" className="h-8 w-8 rounded border object-cover" />;
  return <span className="flex h-8 w-8 items-center justify-center rounded border bg-slate-50"><FileText className="h-5 w-5 text-slate-500" /></span>;
}
export function ControlWorkflowSection({ project, capabilities }: ControlWorkflowSectionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ownerId, setOwnerId] = useState("");
  const [ownerReason, setOwnerReason] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const proofInputId = useId();
  const [proofComment, setProofComment] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [reassignConfirmOpen, setReassignConfirmOpen] = useState(false);
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
      queryClient.invalidateQueries({ queryKey: ["control-design", "summary"] }),
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
      toast({ title: "Control workflow updated" });
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
      toast({ title: "Control workflow updated" });
    },
    onError: (error) => {
      toast({
        title: "Comment could not be added",
        description: error instanceof Error ? error.message : "The comment was not saved.",
        variant: "destructive",
      });
    },
  });



  const proofUploadMutation = useMutation({
    mutationFn: ({ stageId, file }: { stageId: string; file: File }) => uploadControlWorkflowProof(
      stageId,
      file,
      proofComment,
      setUploadProgress,
    ),
    onSuccess: async () => {
      setProofComment("");
      setUploadProgress(null);
      await invalidateControlWorkflow();
      toast({ title: "Work proof uploaded" });
    },
    onError: (error) => {
      setUploadProgress(null);
      toast({ title: "Work proof upload failed", description: error instanceof Error ? error.message : "Upload failed.", variant: "destructive" });
    },
  });

  const proofRemoveMutation = useMutation({
    mutationFn: (proofId: string) => removeControlWorkflowProof(proofId),
    onSuccess: async () => {
      await invalidateControlWorkflow();
      toast({ title: "Work proof removed" });
    },
    onError: (error) => toast({ title: "Could not remove work proof", description: error instanceof Error ? error.message : "Remove failed.", variant: "destructive" }),
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
      setReassignConfirmOpen(false);
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
      setForm({ reason: "", detailed_instruction: "", correction_deadline: defaultDateTimeLocal() });
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
      setForm({ reason: "", detailed_instruction: "", correction_deadline: defaultDateTimeLocal() });
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
        version: modal.stage.version,
      }));
    } else if (modal.type === "document") {
      workflowMutation.mutate(() => updateControlWorkflowDocumentPath(modal.stage.id, {
        document_path: String(form.document_path || ""),
        remarks: String(form.remarks || ""),
        version: modal.stage.version,
      }));
    } else if (modal.type === "review") {
      workflowMutation.mutate(() => approveControlWorkflowStage(modal.stage.id, {
        review_remarks: String(form.review_remarks || ""),
        version: modal.stage.version,
      }));
    } else if (modal.type === "revisionRequired") {
      workflowMutation.mutate(() => markControlWorkflowStageRevisionRequired(modal.stage.id, {
        reason: String(form.reason || ""),
        detailed_instruction: String(form.detailed_instruction || ""),
        correction_deadline: form.correction_deadline ? new Date(String(form.correction_deadline)).toISOString() : undefined,
        version: modal.stage.version,
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
        reference_path: String(form.reference_path || modal.stage?.current_document_path || "") || undefined,
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
      const stage = workflow?.stages.find((item) => item.id === modal.revision.workflow_stage_id);
      workflowMutation.mutate(() => submitControlWorkflowRevision(modal.revision.id, {
        submitted_document_path: String(form.submitted_document_path || ""),
        remarks: String(form.remarks || ""),
        version: stage?.version,
      }));
    } else if (modal.type === "revisionChangesRequired") {
      const stage = workflow?.stages.find((item) => item.id === modal.revision.workflow_stage_id);
      workflowMutation.mutate(() => markControlWorkflowRevisionChangesRequired(modal.revision.id, {
        reason: String(form.reason || ""),
        detailed_instruction: String(form.detailed_instruction || ""),
        correction_deadline: form.correction_deadline ? new Date(String(form.correction_deadline)).toISOString() : undefined,
        version: stage?.version,
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
    || (modal.type === "submit" && capabilities.canSubmitStage && (String(form.submitted_document_path || "").trim() || (modal.stage.proofs || []).some((proof) => proof.revision_number === 0)))
    || (modal.type === "document" && capabilities.canUpdatePath && String(form.document_path || "").trim())
    || (modal.type === "revisionRequired" && capabilities.canRequestChanges && String(form.reason || "").trim() && String(form.detailed_instruction || "").trim())
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
    || (modal.type === "revisionChangesRequired" && capabilities.canReviewRevision && String(form.reason || "").trim() && String(form.detailed_instruction || "").trim())
    || (modal.type === "preCompleted" && capabilities.canMarkPreCompleted && String(form.completion_date || "").trim() && String(form.document_path || "").trim() && String(form.approved_by || "").trim())
    || (modal.type === "submitRevision" && capabilities.canExecuteRevision && (String(form.submitted_document_path || "").trim() || workflow?.stages.find((stage) => stage.id === modal.revision.workflow_stage_id)?.proofs?.some((proof) => proof.revision_number === modal.revision.revision_number)))
  ));

  const startStage = (stage: ControlWorkflowStage) => {
    workflowMutation.mutate(() => startControlWorkflowStage(stage.id, stage.version));
  };

  const startRevision = (revision: ControlWorkflowRevision) => {
    workflowMutation.mutate(() => startControlWorkflowRevision(revision.id));
  };

  const approveRevision = (revision: ControlWorkflowRevision) => {
    const stage = workflow?.stages.find((item) => item.id === revision.workflow_stage_id);
    workflowMutation.mutate(() => approveControlWorkflowRevision(revision.id, { version: stage?.version }));
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
      <CardHeader className="space-y-2 p-4">
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
                <Button size="sm" variant="outline" disabled={!ownerId || reassignMutation.isPending || (ownerReasonRequired && !ownerReason.trim())} onClick={() => setReassignConfirmOpen(true)}>
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

      <CardContent className="space-y-3 p-4 pt-0">
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
          <ol className="space-y-2">
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
                <li key={stage.id} className="grid grid-cols-[36px_minmax(0,1fr)] gap-2">
                  <div className="relative flex justify-center">
                    {index < workflow.stages.length - 1 ? <span className="absolute top-8 h-[calc(100%+8px)] w-px bg-slate-200" aria-hidden="true" /> : null}
                    <span className={cn("relative z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-white", view.className)}>
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <div className={cn("rounded-lg border bg-white p-3", stage.id === workflow.current_stage_id ? "border-blue-300 bg-blue-50/30" : "border-slate-200", locked && "bg-slate-50/70")}>
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
                        {stage.revision_count > 0 ? <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-800">Rev {stage.revision_count}</Badge> : null}
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
                      {!revision && ownerActions && capabilities.canStartStage && ["available", "changes_required"].includes(stage.status) ? (
                        <Button size="sm" variant="outline" onClick={() => startStage(stage)}><Play className="mr-1.5 h-3.5 w-3.5" /> {stage.status === "changes_required" ? "Continue Work" : "Start Stage"}</Button>
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
                        <Button size="sm" variant="outline" onClick={() => openModal({ type: "raiseRevision", stage })}><FilePenLine className="mr-1.5 h-3.5 w-3.5" /> Request Update</Button>
                      ) : null}
                      {ownerActions && capabilities.canUpdatePath && ["in_progress", "changes_required", "update_required"].includes(stage.status) ? (
                        <Button size="sm" variant="ghost" onClick={() => openModal({ type: "document", stage })}><PencilLine className="mr-1.5 h-3.5 w-3.5" /> Update Path</Button>
                      ) : null}
                      {ownerActions && capabilities.canUploadProof && ["in_progress", "changes_required", "update_required"].includes(stage.status) ? (
                        <Button size="sm" variant="ghost" onClick={() => setSelectedStageId(stage.id)}><Upload className="mr-1.5 h-3.5 w-3.5" /> Upload Work Proof</Button>
                      ) : null}
                      {owner && stage.status === "pending_approval" ? <span className="inline-flex h-8 items-center px-2 text-xs font-medium text-amber-800">Awaiting Approval</span> : null}
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
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-[440px]">
          {selectedStage ? (() => {
            const history = stageHistory(selectedStage);
            const comments = history.filter((entry) => entry.type === "comment_added");
            const path = selectedStage.current_document_path || "";
            const canOpenPath = /^https?:\/\//i.test(path);
            const selectedView = stageView(selectedStage);
            const selectedRevision = latestRevision(selectedStage);
            const currentRevisionNumber = selectedRevision?.revision_number || 0;
            const proofs = selectedStage.proofs || [];
            const latestSubmissionDetails = [...selectedStage.submissions].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] || null;
            const actionReady = !workflowMutation.isPending && !workflowClosed;
            const ownerActions = owner && actionReady;
            const proofEditable = ownerActions && capabilities.canUploadProof && ["in_progress", "changes_required", "update_required"].includes(selectedStage.status);
            const pending = pendingSubmission(selectedStage);
            const canReviewSubmission = actionReady && Boolean(pending) && (pending?.submitted_by !== user?.employee_id || canSelfApprove);
            const instruction = selectedRevision?.description || selectedStage.remarks;
            return (
              <div className="flex min-h-full flex-col">
                <SheetHeader className="border-b p-4 pr-10 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-lg">{selectedStage.stage_name}</SheetTitle>
                    <Badge variant="outline" className={cn("whitespace-nowrap", selectedView.className)}>{selectedView.label}</Badge>
                    {selectedStage.revision_count > 0 ? <Badge variant="outline">Rev {selectedStage.revision_count}</Badge> : null}
                  </div>
                  <SheetDescription>Stage actions, proof, paths, history, and comments.</SheetDescription>
                </SheetHeader>

                <div className="space-y-4 p-4">
                  <section className="space-y-2" aria-label="Primary Actions">
                    <h3 className="text-sm font-semibold text-slate-950">Primary Actions</h3>
                    <div className="flex flex-wrap gap-2">
                      {!selectedRevision && ownerActions && capabilities.canStartStage && ["available", "changes_required"].includes(selectedStage.status) ? (
                        <Button size="sm" onClick={() => startStage(selectedStage)}><Play className="mr-1.5 h-3.5 w-3.5" />{selectedStage.status === "changes_required" ? "Continue Work" : "Start Stage"}</Button>
                      ) : null}
                      {!selectedRevision && ownerActions && capabilities.canSubmitStage && ["in_progress", "changes_required"].includes(selectedStage.status) ? (
                        <Button size="sm" onClick={() => openModal({ type: "submit", stage: selectedStage })}><Clock3 className="mr-1.5 h-3.5 w-3.5" />{selectedStage.status === "changes_required" ? "Submit Corrected Work" : "Submit for Approval"}</Button>
                      ) : null}
                      {!selectedRevision && canReviewSubmission && capabilities.canApprove ? (
                        <Button size="sm" onClick={() => openModal({ type: "review", stage: selectedStage })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve</Button>
                      ) : null}
                      {!selectedRevision && canReviewSubmission && capabilities.canRequestChanges ? (
                        <Button size="sm" variant="outline" onClick={() => openModal({ type: "revisionRequired", stage: selectedStage })}>Reject / Request Changes</Button>
                      ) : null}
                      {selectedRevision && ownerActions && capabilities.canExecuteRevision && ["not_started", "changes_required"].includes(selectedRevision.status) ? (
                        <Button size="sm" onClick={() => startRevision(selectedRevision)}><Play className="mr-1.5 h-3.5 w-3.5" />{selectedRevision.status === "changes_required" ? "Continue Update" : "Start Update"}</Button>
                      ) : null}
                      {selectedRevision && ownerActions && capabilities.canExecuteRevision && selectedRevision.status === "in_progress" ? (
                        <Button size="sm" onClick={() => openModal({ type: "submitRevision", revision: selectedRevision })}>Submit Updated Work</Button>
                      ) : null}
                      {selectedRevision?.status === "submitted_for_approval" && canReviewSubmission && capabilities.canReviewRevision ? (
                        <><Button size="sm" onClick={() => approveRevision(selectedRevision)}>Approve Update</Button><Button size="sm" variant="outline" onClick={() => openModal({ type: "revisionChangesRequired", revision: selectedRevision })}>Reject Update</Button></>
                      ) : null}
                      {!selectedRevision && actionReady && capabilities.canRaiseRevision && ["approved", "pre_completed"].includes(selectedStage.status) ? (
                        <Button size="sm" variant="outline" onClick={() => openModal({ type: "raiseRevision", stage: selectedStage })}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Request Update</Button>
                      ) : null}
                      {owner && selectedStage.status === "pending_approval" ? <span className="inline-flex h-8 items-center text-xs font-medium text-amber-800">Awaiting Approval</span> : null}
                    </div>
                  </section>

                  {instruction || selectedStage.rejection_reason ? (
                    <section className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                      <h3 className="text-sm font-semibold text-orange-950">Current Instruction</h3>
                      {selectedStage.rejection_reason ? <p className="mt-1 text-xs font-semibold text-orange-900">{selectedStage.rejection_reason}</p> : null}
                      {instruction ? <p className="mt-1 whitespace-pre-wrap text-sm text-orange-900">{instruction}</p> : null}
                    </section>
                  ) : null}

                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-950">Document Paths</h3>
                    <div className="grid gap-2 rounded-lg border p-3 text-sm">
                      <div><p className="text-[11px] font-semibold uppercase text-slate-500">Project root</p><p className="mt-0.5 break-all text-slate-700">{workflow?.project_root_path || "Not configured"}</p></div>
                      <div className="border-t pt-2"><p className="text-[11px] font-semibold uppercase text-slate-500">Current stage path</p><p className="mt-0.5 break-all text-slate-700">{path || "Not set"}</p></div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={!path} onClick={() => void copyPath(path)}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</Button>
                        <Button size="sm" variant="outline" title={canOpenPath ? "Open path" : "Browsers cannot open local or network paths"} disabled={!canOpenPath} onClick={() => window.open(path, "_blank", "noopener,noreferrer")}>Open</Button>
                        {ownerActions && capabilities.canUpdatePath && ["in_progress", "changes_required", "update_required"].includes(selectedStage.status) ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "document", stage: selectedStage })}><PencilLine className="mr-1.5 h-3.5 w-3.5" />Update</Button>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-950">Work Proof</h3><Badge variant="outline">{proofs.length}</Badge></div>
                    {proofEditable ? (
                      <div className="space-y-2 rounded-lg border border-dashed p-3">
                        <Input value={proofComment} onChange={(event) => setProofComment(event.target.value)} placeholder="Optional file comment" className="h-8 text-xs" disabled={proofUploadMutation.isPending} />
                        <input
                          id={proofInputId}
                          type="file"
                          className="sr-only"
                          accept=".png,.jpg,.jpeg,.pdf,.xls,.xlsx,.doc,.docx,.dwg,.dxf,.igs,.iges,.step,.stp,.csv,.txt,.zip,.rar"
                          disabled={proofUploadMutation.isPending}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (file) proofUploadMutation.mutate({ stageId: selectedStage.id, file });
                          }}
                        />
                        <Button size="sm" variant="outline" disabled={proofUploadMutation.isPending} onClick={() => document.getElementById(proofInputId)?.click()}>
                          {proofUploadMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                          Upload Image / File
                        </Button>
                        {uploadProgress !== null ? <div className="h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} /></div> : null}
                      </div>
                    ) : null}
                    {proofs.length > 0 ? (
                      <ul className="space-y-2">
                        {proofs.map((proof) => (
                          <li key={proof.id} className="flex items-center gap-2 rounded-lg border p-2">
                            <ProofThumbnail proof={proof} />
                            <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{proof.original_filename}</p><p className="text-[11px] text-slate-500">Rev {proof.revision_number} · {formatFileSize(proof.file_size)} · {formatDate(proof.uploaded_at)}</p><p className="truncate text-[11px] text-slate-500">{formatEmployeeDisplay(proof.uploaded_by, proof.uploaded_by_name)}</p></div>
                            <div className="flex gap-1">
                              {capabilities.canViewProof ? <Button size="icon" variant="ghost" title="Open proof" onClick={() => void openControlWorkflowProof(proof).catch((error) => toast({ title: "Could not open proof", description: error instanceof Error ? error.message : "Open failed.", variant: "destructive" }))}><Eye className="h-4 w-4" /></Button> : null}
                              {capabilities.canViewProof ? <Button size="icon" variant="ghost" title="Download proof" onClick={() => void downloadControlWorkflowProof(proof).catch((error) => toast({ title: "Could not download proof", description: error instanceof Error ? error.message : "Download failed.", variant: "destructive" }))}><Download className="h-4 w-4" /></Button> : null}
                              {proofEditable && proof.revision_number === currentRevisionNumber ? <Button size="icon" variant="ghost" title="Remove proof" disabled={proofRemoveMutation.isPending} onClick={() => proofRemoveMutation.mutate(proof.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-xs text-slate-500">No work proof uploaded.</p>}
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-950">Stage Information</h3>
                    <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs">
                      <div><dt className="text-slate-500">Assignee</dt><dd className="font-medium">{formatEmployeeDisplay(workflow?.assigned_user_id, workflow?.assigned_user_name)}</dd></div>
                      <div><dt className="text-slate-500">Revision</dt><dd className="font-medium">{selectedStage.revision_count}</dd></div>
                      <div><dt className="text-slate-500">Started by / at</dt><dd className="font-medium">{formatEmployeeDisplay(selectedStage.started_by, selectedStage.started_by_name)} · {formatDate(selectedStage.started_at)}</dd></div>
                      <div><dt className="text-slate-500">Submitted by / at</dt><dd className="font-medium">{formatEmployeeDisplay(selectedStage.submitted_by || latestSubmissionDetails?.submitted_by, selectedStage.submitted_by_name || latestSubmissionDetails?.submitted_by_name)} · {formatDate(selectedStage.submitted_at || latestSubmissionDetails?.created_at)}</dd></div>
                      <div><dt className="text-slate-500">Approved by / at</dt><dd className="font-medium">{formatEmployeeDisplay(selectedStage.approved_by, selectedStage.approved_by_name)} · {formatDate(selectedStage.approved_at)}</dd></div>
                      <div><dt className="text-slate-500">Deadline</dt><dd className="font-medium">{formatDate(selectedRevision?.due_date || selectedStage.due_date)}</dd></div>
                    </dl>
                  </section>

                  <details className="rounded-lg border p-3" open>
                    <summary className="cursor-pointer text-sm font-semibold text-slate-950">History ({history.length})</summary>
                    <ol className="mt-3 space-y-2">
                      {history.map((entry) => <li key={entry.id} className="border-l-2 border-slate-200 pl-3 text-xs"><div className="flex justify-between gap-2"><span className="font-medium">{formatEventLabel(entry.type)}</span><span className="text-slate-500">{formatDate(entry.createdAt)}</span></div>{entry.actorId ? <p className="text-slate-500">{formatEmployeeDisplay(entry.actorId, entry.actorName)}</p> : null}{entry.details ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{entry.details}</p> : null}</li>)}
                    </ol>
                  </details>

                  <details className="rounded-lg border p-3" open>
                    <summary className="cursor-pointer text-sm font-semibold text-slate-950">Comments ({comments.length})</summary>
                    <div className="mt-3 space-y-2">
                      {comments.map((entry) => <div key={entry.id} className="rounded bg-slate-50 p-2 text-xs"><div className="flex justify-between text-slate-500"><span>{formatEmployeeDisplay(entry.actorId, entry.actorName)}</span><span>{formatDate(entry.createdAt)}</span></div><p className="mt-1 whitespace-pre-wrap">{entry.details}</p></div>)}
                      <Textarea aria-label="Add stage comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment" rows={2} />
                      <Button size="sm" disabled={!comment.trim() || commentMutation.isPending} onClick={() => commentMutation.mutate({ stageId: selectedStage.id, value: comment.trim() })}>{commentMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="mr-1.5 h-3.5 w-3.5" />}Add Comment</Button>
                    </div>
                  </details>
                </div>
              </div>
            );
          })() : null}
        </SheetContent>
      </Sheet>

      <Dialog open={reassignConfirmOpen} onOpenChange={setReassignConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm reassignment</DialogTitle>
            <DialogDescription>Reassign this Control Design project to {formatEmployeeDisplay(ownerId, assignees.find((candidate) => candidate.employee_id === ownerId)?.name)}?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignConfirmOpen(false)} disabled={reassignMutation.isPending}>Cancel</Button>
            <Button onClick={() => reassignMutation.mutate()} disabled={reassignMutation.isPending}>
              {reassignMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Confirm Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Field label="Reason" value={String(form.reason || "")} onChange={(value) => onFormChange("reason", value)} />
            <TextField label="Detailed instruction" value={String(form.detailed_instruction || "")} onChange={(value) => onFormChange("detailed_instruction", value)} />
            <Field label="Correction deadline optional" type="datetime-local" value={String(form.correction_deadline || "")} onChange={(value) => onFormChange("correction_deadline", value)} />
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
            <TextField label="Detailed instructions" value={String(form.description || "")} onChange={(value) => onFormChange("description", value)} />
            <Field label="Reference path optional" value={String(form.reference_path || stage?.current_document_path || "")} onChange={(value) => onFormChange("reference_path", value)} />
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
            <Field label="Reason" value={String(form.reason || "")} onChange={(value) => onFormChange("reason", value)} />
            <TextField label="Detailed instruction" value={String(form.detailed_instruction || "")} onChange={(value) => onFormChange("detailed_instruction", value)} />
            <Field label="Correction deadline optional" type="datetime-local" value={String(form.correction_deadline || "")} onChange={(value) => onFormChange("correction_deadline", value)} />
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
