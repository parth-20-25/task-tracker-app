import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, FileImage, History, Loader2, NotebookText, Trash2, Upload } from "lucide-react";
import { addTaskChecklist, addTaskLog, deleteTaskAttachment, deleteTaskChecklist, fetchTaskActivity, fetchTaskAttachments, fetchTaskChecklists, fetchTaskLogs, updateTaskChecklist, uploadTaskAttachment } from "@/api/taskApi";
import { Task, TaskActivity, TaskAttachment, TaskChecklist, TaskLog } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

const API_ROOT = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/api$/, "");
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

function fileUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_ROOT}${path}`;
}

function isAllowedTaskProofFile(file: File) {
  const mimeType = file.type.toLowerCase();

  if (mimeType && ALLOWED_TASK_PROOF_MIME_TYPES.has(mimeType)) {
    return true;
  }

  const lowerCaseName = file.name.toLowerCase();
  return ALLOWED_TASK_PROOF_EXTENSIONS.some((extension) => lowerCaseName.endsWith(extension));
}

export function TaskExecutionDialog({ task }: TaskExecutionDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [checklists, setChecklists] = useState<TaskChecklist[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [logStepName, setLogStepName] = useState("execution_update");
  const [logNotes, setLogNotes] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [uploading, setUploading] = useState(false);

  const latestProof = useMemo(() => {
    if (attachments.length > 0) {
      return attachments[0];
    }

    if (!task.proof_url) {
      return null;
    }

    return {
      id: "legacy-proof",
      task_id: task.id,
      file_url: task.proof_url,
      file_name: task.proof_name || task.title,
      mime_type: task.proof_mime || "image/*",
      file_size: task.proof_size || 0,
      uploaded_at: task.completed_at || task.created_at,
    } as TaskAttachment;
  }, [attachments, task]);

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
    if (open) {
      loadExecutionData().catch(() => undefined);
    }
  }, [open, loadExecutionData]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-xs h-7">
          <NotebookText className="h-3.5 w-3.5 mr-1" />
          Track
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading task execution details...
          </div>
        ) : (
          <Tabs defaultValue="activity" className="w-full">
            <TabsList>
              <TabsTrigger value="activity"><History className="h-3.5 w-3.5 mr-1.5" />Activity</TabsTrigger>
              <TabsTrigger value="logs"><NotebookText className="h-3.5 w-3.5 mr-1.5" />Logs</TabsTrigger>
              <TabsTrigger value="checklist"><CheckSquare className="h-3.5 w-3.5 mr-1.5" />Checklist</TabsTrigger>
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
                    {item.user_name && <p className="text-sm">{item.user_name}</p>}
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
                    <p className="text-sm">{item.updated_by_name || item.updated_by || "Unknown user"}</p>
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

            <TabsContent value="proof" className="space-y-4 mt-4">
              <div className="flex items-center gap-3">
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];

                      if (!file) {
                        return;
                      }

                      if (!isAllowedTaskProofFile(file)) {
                        toast({
                          title: "Only image files are allowed",
                          description: "Please upload a JPEG, PNG, WEBP, GIF, BMP, HEIC, or HEIF image.",
                          variant: "destructive",
                        });
                        event.target.value = "";
                        return;
                      }

                      if (file.size > MAX_TASK_PROOF_SIZE_BYTES) {
                        toast({
                          title: "Image too large",
                          description: `Proof images must be ${MAX_TASK_PROOF_SIZE_MB} MB or smaller.`,
                          variant: "destructive",
                        });
                        event.target.value = "";
                        return;
                      }

                      setUploading(true);
                      uploadTaskAttachment(task.id, file)
                        .then(() => loadExecutionData())
                        .catch((error) => {
                          toast({ title: "Could not upload proof", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                        })
                        .finally(() => {
                          setUploading(false);
                          event.target.value = "";
                        });
                    }}
                  />
                  <Button asChild disabled={uploading}>
                    <span>
                      {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                      Upload Image / Camera
                    </span>
                  </Button>
                </label>
                {latestProof && (
                  <a href={fileUrl(latestProof.file_url)} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                    Open latest proof
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Images only. Max {MAX_TASK_PROOF_SIZE_MB} MB. Camera capture is supported on compatible mobile browsers.
              </p>

              {attachments.length === 0 && !latestProof ? (
                <p className="text-sm text-muted-foreground">No proof attachments yet.</p>
              ) : (
                <div className="space-y-3">
                  {(attachments.length > 0 ? attachments : latestProof ? [latestProof] : []).map((attachment) => (
                    <div key={attachment.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                      <div className="min-w-0">
                        <a href={fileUrl(attachment.file_url)} target="_blank" rel="noreferrer" className="font-medium text-sm underline break-all">
                          {attachment.file_name}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {new Date(attachment.uploaded_at).toLocaleString()}
                        </p>
                      </div>
                      {attachment.id !== "legacy-proof" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            deleteTaskAttachment(task.id, attachment.id)
                              .then(() => loadExecutionData())
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
        )}
      </DialogContent>
    </Dialog>
  );
}
