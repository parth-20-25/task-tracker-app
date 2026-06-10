import { type ChangeEvent, type ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Camera, CheckSquare, ClipboardPaste, FileImage, History, Loader2, NotebookText, Trash2, UploadCloud, X } from "lucide-react";
import { addTaskChecklist, addTaskLog, deleteTaskAttachment, deleteTaskChecklist, fetchTaskActivity, fetchTaskAssignmentUsers, fetchTaskAttachments, fetchTaskChecklists, fetchTaskLogs, transferTask, updateTask, updateTaskChecklist, uploadTaskAttachment } from "@/api/taskApi";
import { Task, TaskActivity, TaskAttachment, TaskChecklist, TaskLog } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { useTasks } from "@/contexts/useTasks";
import { toast } from "@/hooks/use-toast";
import { isProjectAuthorityUser } from "@/lib/permissions";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { batchQueryKeys } from "@/lib/queryKeys";
import { getTaskCardDisplay } from "@/lib/taskDisplay";
import { resolveImageUrl } from "@/lib/imageUrl";


const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MAX_TASK_PROOF_SIZE_MB = 10;
const MAX_TASK_PROOF_SIZE_BYTES = MAX_TASK_PROOF_SIZE_MB * 1024 * 1024;
const ALLOWED_TASK_PROOF_MIME_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_TASK_PROOF_EXTENSIONS = [".bmp", ".gif", ".heic", ".heif", ".jfif", ".jpeg", ".jpg", ".png", ".webp"];

interface TaskExecutionDialogProps {
  task: Task;
}

function isAllowedTaskProofFile(file: File) {
  const mimeType = file.type.toLowerCase();

  if (mimeType && ALLOWED_TASK_PROOF_MIME_TYPES.has(mimeType)) {
    return true;
  }

  const lowerCaseName = file.name.toLowerCase();
  return ALLOWED_TASK_PROOF_EXTENSIONS.some((extension) => lowerCaseName.endsWith(extension));
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/bmp":
      return ".bmp";
    case "image/gif":
      return ".gif";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/png":
    default:
      return ".png";
  }
}

function buildClipboardProofFile(blob: Blob) {
  if (blob instanceof File && blob.name) {
    return blob;
  }

  const mimeType = blob.type || "image/png";
  return new File([blob], `clipboard-proof-${Date.now()}${extensionForMimeType(mimeType)}`, {
    type: mimeType,
  });
}

function getClipboardImageFile(clipboardData: DataTransfer | null) {
  if (!clipboardData) {
    return null;
  }

  const directFile = Array.from(clipboardData.files || []).find((file) => file.type.startsWith("image/"));
  if (directFile) {
    return buildClipboardProofFile(directFile);
  }

  const imageItem = Array.from(clipboardData.items || []).find((item) => item.type.startsWith("image/"));
  const imageFile = imageItem?.getAsFile();
  return imageFile ? buildClipboardProofFile(imageFile) : null;
}

export function TaskExecutionDialog({ task }: TaskExecutionDialogProps) {
  const { access, user } = useAuth();
  const { executeTaskAction, refreshTasks } = useTasks();
  const queryClient = useQueryClient();
  const taskDisplay = getTaskCardDisplay(task);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("activity");
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [checklists, setChecklists] = useState<TaskChecklist[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [logStepName, setLogStepName] = useState("execution_update");
  const [logNotes, setLogNotes] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [completionInput, setCompletionInput] = useState(String(task.completion_percent ?? 0));
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [transferUsers, setTransferUsers] = useState<Array<{ employee_id: string; name: string }>>([]);
  const [loadingTransferUsers, setLoadingTransferUsers] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [proofPickerOpen, setProofPickerOpen] = useState(false);
  const [pendingProofFile, setPendingProofFile] = useState<File | null>(null);
  const [pendingProofPreviewUrl, setPendingProofPreviewUrl] = useState<string | null>(null);
  const [waitingForPaste, setWaitingForPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const proofPasteTargetRef = useRef<HTMLDivElement | null>(null);
  const isAssignee = user
    ? user.employee_id === task.assigned_to || task.assignee_ids?.includes(user.employee_id)
    : false;
  const actorLevel = Number(user?.role?.hierarchy_level ?? Number.POSITIVE_INFINITY);
  const assigneeLevel = Number(task.assignee?.role?.hierarchy_level ?? Number.POSITIVE_INFINITY);
  const canEditCompletion = task.status !== "closed" && (
    isAssignee
    || isProjectAuthorityUser(user)
    || (access.canEditTasks && actorLevel < assigneeLevel)
  );
  const proofUrls = task.proof_url ?? [];
  const canTransferTask = false;
  const transferCompletion = Number(completionInput);
  const transferRemaining = Number.isInteger(transferCompletion) ? Math.max(0, 100 - transferCompletion) : 0;
  const transferCandidates = transferUsers.filter((candidate) => candidate.employee_id !== task.assigned_to);

  const latestProof = useMemo(() => {
    if (attachments.length > 0) {
      return attachments[0];
    }

    if (proofUrls.length === 0) {
      return null;
    }

    return {
      id: "legacy-proof",
      task_id: task.id,
      file_url: proofUrls[proofUrls.length - 1],
      file_name: task.proof_name || task.title,
      mime_type: task.proof_mime || "image/*",
      file_size: task.proof_size || 0,
      uploaded_at: task.completed_at || task.created_at,
    } as TaskAttachment;
  }, [attachments, proofUrls, task]);

  const resetProofInputs = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }, []);

  const loadExecutionData = useCallback(async () => {
    setLoading(true);

    try {
      const [activityData, logsData, checklistData, attachmentData] = await Promise.all([
        fetchTaskActivity(task.id),
        fetchTaskLogs(task.id),
        fetchTaskChecklists(task.id),
        fetchTaskAttachments(task.id),
      ]);

      setActivity(activityData);
      setLogs(logsData);
      setChecklists(checklistData);
      setAttachments(attachmentData);
    } catch (error) {
      toast({
        title: "Could not load task details",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    return () => {
      if (pendingProofPreviewUrl) {
        URL.revokeObjectURL(pendingProofPreviewUrl);
      }
    };
  }, [pendingProofPreviewUrl]);

  const clearPendingProof = useCallback(() => {
    setPendingProofFile(null);
    setPendingProofPreviewUrl(null);
    setWaitingForPaste(false);
    resetProofInputs();
  }, [resetProofInputs]);

  const stageProofSelection = useCallback((file: File | null) => {
    if (!file) {
      return;
    }

    if (!isAllowedTaskProofFile(file)) {
      toast({
        title: "Only image files are allowed",
        description: "Please upload a JPEG, PNG, WEBP, GIF, BMP, HEIC, or HEIF image.",
        variant: "destructive",
      });
      resetProofInputs();
      return;
    }

    if (file.size > MAX_TASK_PROOF_SIZE_BYTES) {
      toast({
        title: "Image too large",
        description: `Proof images must be ${MAX_TASK_PROOF_SIZE_MB} MB or smaller.`,
        variant: "destructive",
      });
      resetProofInputs();
      return;
    }

    setPendingProofFile(file);
    setPendingProofPreviewUrl(URL.createObjectURL(file));
    setWaitingForPaste(false);
    setProofPickerOpen(false);
    resetProofInputs();
  }, [resetProofInputs]);

  const handlePendingProofSubmit = useCallback(async () => {
    if (!pendingProofFile) {
      toast({
        title: "No proof selected",
        description: "Choose or paste an image before submitting proof.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      await uploadTaskAttachment(task.id, pendingProofFile);
      let autoSubmitted = false;

      if (isAssignee && task.status === "in_progress") {
        try {
          await executeTaskAction(task.id, "submit");
          autoSubmitted = true;
        } catch (submitError) {
          await Promise.all([loadExecutionData(), refreshTasks()]);
          clearPendingProof();
          toast({
            title: "Proof uploaded, task not submitted",
            description: submitError instanceof Error ? submitError.message : "Use the task Submit button to try again.",
            variant: "destructive",
          });
          return;
        }
      }

      await Promise.all([loadExecutionData(), refreshTasks()]);
      clearPendingProof();
      toast({
        title: autoSubmitted ? "Proof uploaded and task submitted" : "Proof uploaded",
        description: autoSubmitted
          ? "The task moved into verification automatically."
          : "The proof image is ready for the task submission flow.",
      });
    } catch (error) {
      toast({ title: "Could not upload proof", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [clearPendingProof, executeTaskAction, isAssignee, loadExecutionData, pendingProofFile, refreshTasks, task.id, task.status]);

  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    stageProofSelection(event.target.files?.[0] || null);
  }, [stageProofSelection]);

  const handleCameraCapture = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    stageProofSelection(event.target.files?.[0] || null);
  }, [stageProofSelection]);

  const handleProofPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (!isAssignee || task.status === "closed") {
      return;
    }

    const imageFile = getClipboardImageFile(event.clipboardData);
    if (!imageFile) {
      return;
    }

    event.preventDefault();
    stageProofSelection(imageFile);
  }, [isAssignee, stageProofSelection, task.status]);

  const tryReadClipboardImage = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      return false;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) {
          continue;
        }

        const blob = await item.getType(imageType);
        stageProofSelection(buildClipboardProofFile(blob));
        return true;
      }
    } catch (_error) {
      return false;
    }

    return false;
  }, [stageProofSelection]);

  const handlePasteOption = useCallback(() => {
    setWaitingForPaste(true);
    setProofPickerOpen(false);
    window.setTimeout(() => proofPasteTargetRef.current?.focus(), 0);
    void tryReadClipboardImage();
  }, [tryReadClipboardImage]);

  const openProofDialog = useCallback(() => {
    setActiveTab("proof");
    if (isAssignee && task.status !== "closed") {
      window.setTimeout(() => setProofPickerOpen(true), 0);
    }
  }, [isAssignee, task.status]);

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setProofPickerOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      clearPendingProof();
      setProofPickerOpen(false);
    }
  }, [clearPendingProof, open]);

  useEffect(() => {
    if (open) {
      setCompletionInput(String(task.completion_percent ?? 0));
      setTransferTo("");
      setTransferReason("");
      loadExecutionData().catch(() => undefined);
    }
  }, [open, loadExecutionData, task.completion_percent]);

  useEffect(() => {
    if (!open || !canTransferTask) {
      return;
    }

    let cancelled = false;
    setLoadingTransferUsers(true);
    fetchTaskAssignmentUsers({
      task_type: task.task_type,
      department_id: task.department_id,
      workflow_template_id: task.workflow_template_id,
    })
      .then((users) => {
        if (!cancelled) {
          setTransferUsers(users);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: "Could not load transfer users",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTransferUsers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canTransferTask, open, task.department_id, task.task_type, task.workflow_template_id]);

  const handleCompletionSave = useCallback(async () => {
    const nextCompletion = Number(completionInput);

    if (!Number.isInteger(nextCompletion) || nextCompletion < 0 || nextCompletion > 100) {
      toast({
        title: "Invalid completion",
        description: "Completion percent must be a whole number from 0 to 100.",
        variant: "destructive",
      });
      return;
    }

    setSavingCompletion(true);

    try {
      await updateTask(task.id, { completion_percent: nextCompletion });
      await Promise.all([
        refreshTasks(),
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      ]);
      toast({ title: "Completion updated", description: `Task progress saved at ${nextCompletion}%.` });
    } catch (error) {
      toast({
        title: "Could not save completion",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingCompletion(false);
    }
  }, [completionInput, queryClient, refreshTasks, task.id]);

  const handleTransferTask = useCallback(async () => {
    const nextCompletion = Number(completionInput);

    if (!Number.isInteger(nextCompletion) || nextCompletion < 0 || nextCompletion > 99) {
      toast({
        title: "Invalid transfer completion",
        description: "Transfer completion must leave remaining work from 1% to 100%.",
        variant: "destructive",
      });
      return;
    }

    if (!transferTo) {
      toast({ title: "Select transfer employee", variant: "destructive" });
      return;
    }

    if (!transferReason.trim()) {
      toast({ title: "Transfer reason is required", variant: "destructive" });
      return;
    }

    setTransferring(true);

    try {
      await transferTask(task.id, {
        transfer_to: transferTo,
        transfer_reason: transferReason.trim(),
        completion_percent: nextCompletion,
      });
      setTransferTo("");
      setTransferReason("");
      await Promise.all([
        refreshTasks(),
        loadExecutionData(),
        queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
        queryClient.invalidateQueries({ queryKey: ["analytics"] }),
      ]);
      toast({ title: "Task transferred", description: `Remaining ${100 - nextCompletion}% moved to the selected employee.` });
    } catch (error) {
      toast({
        title: "Could not transfer task",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTransferring(false);
    }
  }, [completionInput, loadExecutionData, queryClient, refreshTasks, task.id, transferReason, transferTo]);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          aria-label="Track proof"
          onClick={openProofDialog}
        >
          <Camera className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{taskDisplay.title}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading task execution details...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1.5">
                  <div className="text-sm font-semibold">Task Completion</div>
                  <div className="text-xs text-muted-foreground">
                    Assignees update real progress here. Project completion is calculated automatically from these task percentages.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={completionInput}
                    onChange={(event) => setCompletionInput(event.target.value)}
                    disabled={!canEditCompletion || savingCompletion}
                    className="w-24"
                    aria-label="Task completion percent"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <Button
                    type="button"
                    onClick={() => { handleCompletionSave().catch(() => undefined); }}
                    disabled={!canEditCompletion || savingCompletion || completionInput === String(task.completion_percent ?? 0)}
                  >
                    Save
                  </Button>
                </div>
              </div>
              <Progress value={Number(task.completion_percent ?? 0)} className="mt-3 h-2" />
              {!canEditCompletion && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Only the assignee or an authorized higher role can edit this value while the project and task are active.
                </p>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList>
              <TabsTrigger value="activity"><History className="h-3.5 w-3.5 mr-1.5" />Activity</TabsTrigger>
              <TabsTrigger value="logs"><NotebookText className="h-3.5 w-3.5 mr-1.5" />Logs</TabsTrigger>
              <TabsTrigger value="checklist"><CheckSquare className="h-3.5 w-3.5 mr-1.5" />Checklist</TabsTrigger>
              {canTransferTask ? <TabsTrigger value="transfer"><ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />Transfer</TabsTrigger> : null}
              <TabsTrigger value="proof"><FileImage className="h-3.5 w-3.5 mr-1.5" />Proof</TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="space-y-3 mt-4">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">{item.action_type}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    {(item.user_employee_id || item.user_name) && (
                      <p className="text-sm">{formatEmployeeDisplay(item.user_employee_id, item.user_name)}</p>
                    )}
                    {item.notes && <p className="text-sm text-muted-foreground">{item.notes}</p>}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="logs" className="space-y-4 mt-4">
              <div className="grid md:grid-cols-[220px_1fr_auto] gap-3">
                <Input value={logStepName} onChange={(event) => setLogStepName(event.target.value)} placeholder="Step name" />
                <Textarea value={logNotes} onChange={(event) => setLogNotes(event.target.value)} placeholder="Step-wise execution note..." rows={2} />
                <Button
                  onClick={() => {
                    addTaskLog(task.id, {
                      step_name: logStepName.trim() || "execution_update",
                      status: "recorded",
                      notes: logNotes.trim() || undefined,
                    })
                      .then(() => {
                        setLogNotes("");
                        return loadExecutionData();
                      })
                      .catch((error) => {
                        toast({ title: "Could not save task log", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                      });
                  }}
                >
                  Add Log
                </Button>
              </div>

              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No execution logs yet.</p>
              ) : (
                logs.map((item) => (
                  <div key={item.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Badge>{item.status}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="text-sm font-medium">{item.step_name}</p>
                    <p className="text-sm">
                      {formatEmployeeDisplay(item.updated_by || item.user_employee_id || null, item.updated_by_name || item.user_name)}
                    </p>
                    {item.notes && <p className="text-sm text-muted-foreground">{item.notes}</p>}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="checklist" className="space-y-4 mt-4">
              <div className="flex gap-3">
                <Input value={checklistText} onChange={(event) => setChecklistText(event.target.value)} placeholder="Add checklist item" />
                <Button
                  onClick={() => {
                    addTaskChecklist(task.id, { item: checklistText.trim(), is_completed: false })
                      .then(() => {
                        setChecklistText("");
                        return loadExecutionData();
                      })
                      .catch((error) => {
                        toast({ title: "Could not save checklist item", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                      });
                  }}
                  disabled={!checklistText.trim()}
                >
                  Add Item
                </Button>
              </div>

              {checklists.length === 0 ? (
                <p className="text-sm text-muted-foreground">No checklist items yet.</p>
              ) : (
                checklists.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                    <label className="flex items-center gap-3 text-sm flex-1">
                      <Checkbox
                        checked={item.is_completed}
                        onCheckedChange={(checked) => {
                          updateTaskChecklist(task.id, item.id, { is_completed: checked === true })
                            .then(() => loadExecutionData())
                            .catch((error) => {
                              toast({ title: "Could not update checklist item", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                            });
                        }}
                      />
                      <span>{item.item}</span>
                    </label>
                    <div className="flex items-center gap-3">
                      {item.completed_at && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.completed_at).toLocaleString()}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          deleteTaskChecklist(task.id, item.id)
                            .then(() => loadExecutionData())
                            .catch((error) => {
                              toast({ title: "Could not delete checklist item", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                            });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            {canTransferTask ? (
              <TabsContent value="transfer" className="space-y-4 mt-4">
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Assignee</p>
                    <p className="text-sm font-medium">
                      {task.assignee ? formatEmployeeDisplay(task.assignee) : formatEmployeeDisplay(task.assigned_to)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preserved</p>
                    <p className="text-sm font-medium">{Number.isInteger(transferCompletion) ? transferCompletion : 0}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Remaining</p>
                    <p className="text-sm font-medium">{transferRemaining}%</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Transfer To</Label>
                    <Select
                      value={transferTo || "__none__"}
                      onValueChange={(value) => setTransferTo(value === "__none__" ? "" : value)}
                      disabled={loadingTransferUsers || transferring}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={loadingTransferUsers ? "Loading employees..." : "Select employee"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select employee</SelectItem>
                        {transferCandidates.map((candidate) => (
                          <SelectItem key={candidate.employee_id} value={candidate.employee_id}>
                            {formatEmployeeDisplay(candidate)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Transfer Reason</Label>
                    <Textarea
                      value={transferReason}
                      onChange={(event) => setTransferReason(event.target.value)}
                      rows={2}
                      disabled={transferring}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => { handleTransferTask().catch(() => undefined); }}
                    disabled={transferring || !transferTo || !transferReason.trim() || transferRemaining <= 0}
                  >
                    {transferring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRightLeft className="h-4 w-4 mr-2" />}
                    Transfer Task
                  </Button>
                </div>
              </TabsContent>
            ) : null}

            <TabsContent
              value="proof"
              className="space-y-4 mt-4 focus:outline-none"
              ref={proofPasteTargetRef}
              tabIndex={0}
              onPaste={handleProofPaste}
            >
              {task.status === 'closed' && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm text-primary mb-4">
                  This task is completed. Proof documents are locked and available for viewing only.
                </div>
              )}
              {!isAssignee && (
                <div className="bg-muted border rounded-lg p-3 text-sm text-muted-foreground">
                  Only the assignee can upload or remove proof for this task.
                </div>
              )}
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={cameraInputRef}
                  style={{ display: "none" }}
                  onChange={handleCameraCapture}
                />
                <Popover open={proofPickerOpen} onOpenChange={setProofPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!isAssignee || uploading || task.status === 'closed'}
                      aria-label="Add proof image"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-full justify-start px-2 text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadCloud className="mr-2 h-3.5 w-3.5" />
                      Upload From Device
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-full justify-start px-2 text-xs"
                      disabled={!isMobile}
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="mr-2 h-3.5 w-3.5" />
                      Open Camera
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-full justify-start px-2 text-xs"
                      onClick={handlePasteOption}
                    >
                      <ClipboardPaste className="mr-2 h-3.5 w-3.5" />
                      Paste Screenshot (Ctrl + V)
                    </Button>
                  </PopoverContent>
                </Popover>
                {latestProof && resolveImageUrl(latestProof.file_url) && (
                  <a href={resolveImageUrl(latestProof.file_url) || "#"} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                    Open latest proof
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Images only. Max {MAX_TASK_PROOF_SIZE_MB} MB.
              </p>

              {pendingProofPreviewUrl ? (
                <div className="rounded-lg border bg-slate-50/60 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="h-40 w-full overflow-hidden rounded-md border bg-background sm:w-56">
                      <img
                        src={pendingProofPreviewUrl}
                        alt="Selected proof preview"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{pendingProofFile?.name || "Proof image"}</p>
                        <p className="text-xs text-muted-foreground">
                          {pendingProofFile ? `${Math.ceil(pendingProofFile.size / 1024)} KB` : "Ready to upload"}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={clearPendingProof}
                          disabled={uploading}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Clear
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => { handlePendingProofSubmit().catch(() => undefined); }}
                          disabled={uploading || !pendingProofFile}
                        >
                          {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Submit
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : waitingForPaste ? (
                <div className="rounded-lg border border-dashed bg-slate-50/60 p-3 text-sm text-muted-foreground">
                  Waiting for pasted screenshot...
                </div>
              ) : null}

              {attachments.length === 0 && !latestProof ? (
                <p className="text-sm text-muted-foreground">No proof attachments yet.</p>
              ) : (
                <div className="space-y-3">
                  {(attachments.length > 0 ? attachments : latestProof ? [latestProof] : []).map((attachment) => (
                    <div key={attachment.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                      <div className="min-w-0">
                        {resolveImageUrl(attachment.file_url) ? (
                          <a href={resolveImageUrl(attachment.file_url) || "#"} target="_blank" rel="noreferrer" className="font-medium text-sm underline break-all">
                            {attachment.file_name}
                          </a>
                        ) : (
                          <span className="font-medium text-sm">{attachment.file_name}</span>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {new Date(attachment.uploaded_at).toLocaleString()}
                        </p>
                      </div>
                      {attachment.id !== "legacy-proof" && task.status !== 'closed' && isAssignee && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            deleteTaskAttachment(task.id, attachment.id)
                              .then(() => Promise.all([loadExecutionData(), refreshTasks()]))
                              .catch((error) => {
                                toast({ title: "Could not delete attachment", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                              });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
