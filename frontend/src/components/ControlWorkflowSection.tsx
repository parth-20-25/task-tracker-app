import { useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  FilePenLine,
  GitBranch,
  Loader2,
  LockKeyhole,
  PencilLine,
  Play,
  RefreshCw,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import {
  approveControlWorkflowRevision,
  approveControlWorkflowStage,
  createControlProjectWorkflow,
  fetchControlPendingApprovals,
  fetchControlProjectWorkflow,
  fetchControlRevisionQueue,
  fetchControlSubDepartments,
  fetchControlWorkflowTemplate,
  markControlWorkflowStagePreCompleted,
  markControlWorkflowStageRevisionRequired,
  overrideUnlockControlWorkflowStage,
  raiseControlWorkflowRevision,
  reassignControlProjectWorkflowOwner,
  startControlWorkflowRevision,
  startControlWorkflowStage,
  submitControlWorkflowRevision,
  submitControlWorkflowStage,
  updateControlWorkflowDocumentPath,
  type ControlApprovalQueueItem,
  type ControlProjectWorkflow,
  type ControlRevisionReason,
  type ControlWorkflowRevision,
  type ControlWorkflowStage,
} from "@/api/controlWorkflowApi";
import { fetchTaskAssignmentUsers } from "@/api/taskApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatAssigneeOption, formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { isOperationalControllerUser, isProjectAuthorityUser } from "@/lib/permissions";
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
  | { type: "review"; stage: ControlWorkflowStage; submission: ControlApprovalQueueItem | null }
  | { type: "revisionRequired"; stage: ControlWorkflowStage }
  | { type: "raiseRevision"; stage: ControlWorkflowStage | null }
  | { type: "override"; stage: ControlWorkflowStage }
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

function statusBadge(status: ControlWorkflowStage["status"]) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", stageStatusClasses[status])}>
      {stageStatusLabels[status]}
    </Badge>
  );
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
}

export function ControlWorkflowSection({ project }: ControlWorkflowSectionProps) {
  const { access, user } = useAuth();
  const queryClient = useQueryClient();
  const [ownerId, setOwnerId] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});

  const controlSubDepartmentsQuery = useQuery({
    queryKey: ["control-workflow", "sub-departments"],
    queryFn: fetchControlSubDepartments,
    enabled: Boolean(user?.employee_id),
  });

  const controlDesignSubDepartment = (controlSubDepartmentsQuery.data ?? []).find(
    (subDepartment) => subDepartment.subdivision_name.toLowerCase() === CONTROL_DESIGN_NAME.toLowerCase(),
  ) || null;

  const templateQuery = useQuery({
    queryKey: ["control-workflow", "template", controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlWorkflowTemplate(controlDesignSubDepartment?.id || ""),
    enabled: Boolean(controlDesignSubDepartment?.id),
  });

  const workflowQuery = useQuery({
    queryKey: ["control-workflow", "project", project.project_id, controlDesignSubDepartment?.id || "none"],
    queryFn: () => fetchControlProjectWorkflow(project.project_id, controlDesignSubDepartment?.id || ""),
    enabled: Boolean(project.project_id && controlDesignSubDepartment?.id),
  });

  const approvalsQuery = useQuery({
    queryKey: ["control-workflow", "approvals"],
    queryFn: fetchControlPendingApprovals,
    enabled: Boolean(user?.employee_id),
  });

  const revisionsQuery = useQuery({
    queryKey: ["control-workflow", "revisions"],
    queryFn: fetchControlRevisionQueue,
    enabled: Boolean(user?.employee_id),
  });

  const canReview = isProjectAuthorityUser(user)
    || (
      isOperationalControllerUser(user)
      && (access.canApproveCompletedTasks || access.canChangeFixtureStage || access.canAssignTasks)
    );
  const workflow = workflowQuery.data || null;
  const owner = isOwner(user?.employee_id, workflow);
  const canAssignOwner = canReview && access.canAssignTasks;

  const assigneesQuery = useQuery({
    queryKey: ["control-workflow", "assignable-users", controlDesignSubDepartment?.department_id || "control", project.project_id],
    queryFn: () => fetchTaskAssignmentUsers({
      task_type: "department_workflow",
      department_id: controlDesignSubDepartment?.department_id || "control",
      project_id: project.project_id,
      stage_name: CONTROL_DESIGN_NAME,
    }),
    enabled: canAssignOwner,
  });

  const assignees = assigneesQuery.data ?? [];
  const currentStageName = workflow?.current_stage?.stage_name || "Not started";

  const invalidateControlWorkflow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["control-workflow"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
    ]);
  };

  const workflowMutation = useMutation({
    mutationFn: async (action: () => Promise<ControlProjectWorkflow>) => action(),
    onSuccess: async () => {
      setModal(null);
      setForm({});
      setOwnerId("");
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

  const createMutation = useMutation({
    mutationFn: () => createControlProjectWorkflow({
      project_id: project.project_id,
      sub_department_id: controlDesignSubDepartment?.id || "",
      template_id: templateQuery.data?.id,
      assigned_user_id: ownerId,
    }),
    onSuccess: async () => {
      setOwnerId("");
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
    mutationFn: () => reassignControlProjectWorkflowOwner(workflow?.id || "", ownerId),
    onSuccess: async () => {
      setOwnerId("");
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

  const projectApprovals = useMemo(() => (
    (approvalsQuery.data ?? []).filter((item) => item.project_no === project.project_no)
  ), [approvalsQuery.data, project.project_no]);

  const projectRevisions = useMemo(() => (
    (revisionsQuery.data ?? []).filter((item) => item.project_no === project.project_no)
  ), [revisionsQuery.data, project.project_no]);

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
      }));
    } else if (modal.type === "override") {
      workflowMutation.mutate(() => overrideUnlockControlWorkflowStage(modal.stage.id, {
        reason: String(form.reason || ""),
        remarks: String(form.remarks || ""),
        confirm_history_record: form.confirm_history_record === true,
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
    }
  };

  const canRunModalAction = Boolean(!workflowMutation.isPending && (
    !modal
    || modal.type === "review"
    || (modal.type === "submit" && String(form.submitted_document_path || "").trim())
    || (modal.type === "document" && String(form.document_path || "").trim())
    || (modal.type === "revisionRequired" && String(form.description || "").trim() && String(form.due_date || "").trim())
    || (
      modal.type === "raiseRevision"
      && String(form.stage_id || modal.stage?.id || "").trim()
      && String(form.revision_reason || "").trim()
      && String(form.description || "").trim()
      && String(form.due_date || "").trim()
      && (form.revision_reason !== "Other" || String(form.manual_reason || "").trim())
    )
    || (modal.type === "override" && String(form.reason || "").trim() && String(form.remarks || "").trim() && form.confirm_history_record === true)
    || (modal.type === "preCompleted" && String(form.completion_date || "").trim() && String(form.document_path || "").trim() && String(form.approved_by || "").trim())
    || (modal.type === "submitRevision" && String(form.submitted_document_path || "").trim())
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

  if (!controlDesignSubDepartment && controlSubDepartmentsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Control workflow
        </CardContent>
      </Card>
    );
  }

  if (!controlDesignSubDepartment) {
    return null;
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">Control Design</h2>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">Control Design</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatProjectNumber(project)} · {project.project_name}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {workflow && canAssignOwner ? (
              <>
                <Select value={ownerId || "__none__"} onValueChange={(value) => setOwnerId(value === "__none__" ? "" : value)}>
                  <SelectTrigger className="h-9 w-[250px] text-xs">
                    <SelectValue placeholder={assigneesQuery.isLoading ? "Loading owners..." : "Reassign owner"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Reassign owner</SelectItem>
                    {assignees.map((candidate) => (
                      <SelectItem key={candidate.employee_id} value={candidate.employee_id}>{formatAssigneeOption(candidate)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!ownerId || reassignMutation.isPending} onClick={() => reassignMutation.mutate()}>
                  {reassignMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Reassign
                </Button>
              </>
            ) : null}
            {workflow && canReview ? (
              <Button size="sm" variant="outline" onClick={() => openModal({ type: "raiseRevision", stage: workflow.current_stage || null })}>
                <FilePenLine className="mr-1.5 h-3.5 w-3.5" />
                Raise Revision
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4 pt-0">
        {!workflow ? (
          <div className="rounded-md border border-dashed p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="space-y-1.5">
                <Label>Assigned To</Label>
                <Select value={ownerId || "__none__"} onValueChange={(value) => setOwnerId(value === "__none__" ? "" : value)} disabled={!canAssignOwner || assigneesQuery.isLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder={assigneesQuery.isLoading ? "Loading owners..." : "Select project owner"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select project owner</SelectItem>
                    {assignees.map((candidate) => (
                      <SelectItem key={candidate.employee_id} value={candidate.employee_id}>{formatAssigneeOption(candidate)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!canAssignOwner ? <p className="text-xs text-muted-foreground">Read-only until a leader assigns the workflow owner.</p> : null}
              </div>
              <Button disabled={!ownerId || createMutation.isPending || !templateQuery.data} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Assign Control Design Project
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Project ID</p>
                <p className="font-medium">{formatProjectNumber(project)}</p>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="font-medium">{project.customer_name || "Not set"}</p>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Assigned To</p>
                <p className="font-medium">{formatEmployeeDisplay(workflow.assigned_user_id, workflow.assigned_user_name)}</p>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Sub Department</p>
                <p className="font-medium">{workflow.sub_department_name || CONTROL_DESIGN_NAME}</p>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Current Stage</p>
                <p className="font-medium">{currentStageName}</p>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Overall Progress</p>
                <div className="mt-1 flex items-center gap-2">
                  <Progress value={workflow.progress.percent} className="h-2" />
                  <span className="text-xs font-medium">{workflow.progress.percent}%</span>
                </div>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Project Status</p>
                <p className="font-medium capitalize">{project.project_status.replace(/_/g, " ")}</p>
              </div>
              <div className="rounded-md border bg-slate-50/50 p-3">
                <p className="text-xs text-muted-foreground">Dispatch Status</p>
                <p className="font-medium">{workflow.dispatch_status || "Not available"}</p>
              </div>
            </div>

            {workflow.progress.skipped_by_override_stages > 0 ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                {workflow.progress.skipped_by_override_stages} stage{workflow.progress.skipped_by_override_stages === 1 ? "" : "s"} skipped by override.
              </div>
            ) : null}

            <div className="space-y-3">
              {workflow.stages.map((stage) => {
                const pending = pendingSubmission(stage);
                const revision = latestRevision(stage);
                const locked = stage.status === "locked";
                const ownerActions = owner && !workflowMutation.isPending;
                const reviewerActions = canReview && !workflowMutation.isPending;

                return (
                  <div key={stage.id} className="relative rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                            {stage.sequence_order}
                          </span>
                          <h3 className="font-semibold">{stage.stage_name}</h3>
                          {statusBadge(stage.status)}
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                          <span>Started: {formatDate(stage.started_at)}</span>
                          <span>Submitted: {formatDate(stage.submitted_at)}</span>
                          <span>Approved: {formatDate(stage.approved_at)}</span>
                          <span>Revision Count: {stage.revision_count}</span>
                        </div>
                        <p className="break-words text-xs text-muted-foreground">
                          Current document path: {stage.current_document_path ? <span className="font-medium text-foreground">{stage.current_document_path}</span> : "Not set"}
                        </p>
                        {locked ? <p className="text-xs font-medium text-slate-500">Locked until previous stage is approved</p> : null}
                        {revision ? (
                          <p className="text-xs text-orange-800">
                            Revision Required: {revision.revision_reason} · due {formatDate(revision.due_date)}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                        {ownerActions && ["not_started", "revision_required"].includes(stage.status) ? (
                          <Button size="sm" variant="outline" onClick={() => startStage(stage)}>
                            <Play className="mr-1.5 h-3.5 w-3.5" /> Start
                          </Button>
                        ) : null}
                        {ownerActions && ["in_progress", "revision_required"].includes(stage.status) ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "submit", stage })}>
                            <Clock3 className="mr-1.5 h-3.5 w-3.5" /> Submit for Approval
                          </Button>
                        ) : null}
                        {ownerActions && !locked ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "document", stage })}>
                            <PencilLine className="mr-1.5 h-3.5 w-3.5" /> Update Document Path
                          </Button>
                        ) : null}
                        {ownerActions && revision?.status === "not_started" ? (
                          <Button size="sm" variant="outline" onClick={() => startRevision(revision)}>
                            <Play className="mr-1.5 h-3.5 w-3.5" /> Start Revision
                          </Button>
                        ) : null}
                        {ownerActions && revision?.status === "in_progress" ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "submitRevision", revision })}>
                            <Clock3 className="mr-1.5 h-3.5 w-3.5" /> Submit Revision
                          </Button>
                        ) : null}
                        {reviewerActions && pending ? (
                          <Button size="sm" onClick={() => openModal({ type: "review", stage, submission: null })}>
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve
                          </Button>
                        ) : null}
                        {reviewerActions && pending ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "revisionRequired", stage })}>
                            Revision Required
                          </Button>
                        ) : null}
                        {reviewerActions ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "raiseRevision", stage })}>
                            Raise Revision
                          </Button>
                        ) : null}
                        {reviewerActions && locked ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "override", stage })}>
                            <Unlock className="mr-1.5 h-3.5 w-3.5" /> Override Unlock
                          </Button>
                        ) : null}
                        {reviewerActions && !["approved", "pre_completed"].includes(stage.status) ? (
                          <Button size="sm" variant="outline" onClick={() => openModal({ type: "preCompleted", stage })}>
                            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Mark Pre-Completed
                          </Button>
                        ) : null}
                        {!ownerActions && !reviewerActions && locked ? <LockKeyhole className="h-4 w-4 text-slate-400" /> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <QueueCard
                title="Pending Approvals"
                items={projectApprovals}
                emptyText="No pending approvals."
                render={(item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.project_no}</TableCell>
                    <TableCell>{item.stage_name}</TableCell>
                    <TableCell>{formatEmployeeDisplay(item.submitted_by, item.submitted_by_name)}</TableCell>
                    <TableCell>{formatDate(item.created_at)}</TableCell>
                    <TableCell>{formatDate(item.due_date, "Not set")}</TableCell>
                    <TableCell>{item.status}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{item.submitted_document_path}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canReview}
                        onClick={() => {
                          const stage = workflow.stages.find((candidate) => candidate.id === item.workflow_stage_id);
                          if (stage) openModal({ type: "review", stage, submission: item });
                        }}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                headings={["Project ID", "Stage", "Submitted by", "Submitted date", "Due date", "Status", "Submitted document path", ""]}
              />

              <QueueCard
                title="Revision Required"
                items={projectRevisions}
                emptyText="No active revisions."
                render={(item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.project_no}</TableCell>
                    <TableCell>{item.stage_name}</TableCell>
                    <TableCell>{item.revision_reason}</TableCell>
                    <TableCell>{formatEmployeeDisplay(item.raised_by, item.raised_by_name)}</TableCell>
                    <TableCell>{formatEmployeeDisplay(item.assigned_to, item.assigned_to_name)}</TableCell>
                    <TableCell>{formatDate(item.due_date)}</TableCell>
                    <TableCell>{item.status.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      {owner && item.status === "not_started" ? (
                        <Button size="sm" variant="outline" onClick={() => startRevision(item)}>Start Revision</Button>
                      ) : canReview && item.status === "submitted_for_approval" ? (
                        <Button size="sm" variant="outline" onClick={() => approveRevision(item)}>Approve</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )}
                headings={["Project ID", "Stage", "Revision reason", "Raised by", "Assigned to", "Due date", "Status", ""]}
              />
            </div>
          </>
        )}
      </CardContent>

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

function QueueCard<T>({
  title,
  headings,
  items,
  render,
  emptyText,
}: {
  title: string;
  headings: string[];
  items: T[];
  render: (item: T) => ReactElement;
  emptyText: string;
}) {
  return (
    <div className="rounded-md border">
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {headings.map((heading) => <TableHead key={heading}>{heading}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>{items.map(render)}</TableBody>
          </Table>
        </div>
      )}
    </div>
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
                  : "";

  const confirmLabel = modal?.type === "submit" ? "Confirm submit"
    : modal?.type === "review" ? "Approve"
      : modal?.type === "revisionRequired" ? "Revision Required"
        : modal?.type === "override" ? "Unlock Stage"
          : modal?.type === "preCompleted" ? "Mark as Pre-Completed"
            : modal?.type === "submitRevision" ? "Submit Revision"
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
            <Field label="Submitted by" value={modal.submission ? formatEmployeeDisplay(modal.submission.submitted_by, modal.submission.submitted_by_name) : formatEmployeeDisplay(pendingSubmission(modal.stage)?.submitted_by || null, pendingSubmission(modal.stage)?.submitted_by_name)} readOnly />
            <Field label="Submitted document path" value={modal.submission?.submitted_document_path || pendingSubmission(modal.stage)?.submitted_document_path || "Not set"} readOnly />
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
