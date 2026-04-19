import { apiRequest } from "@/api/http";
import { Task, TaskActivity, TaskAttachment, TaskChecklist, TaskLog, TaskStatus, VerificationStatus } from "@/types";


interface UpdateTaskPayload {
  status?: TaskStatus;
  verification_status?: VerificationStatus;
  remarks?: string;
  proof_url?: string;
  proof_type?: string;
  proof_name?: string;
  proof_mime?: string;
  proof_size?: number;
  description?: string;
  priority?: Task["priority"];
  deadline?: string;
  planned_minutes?: number;
  machine_id?: string;
  machine_name?: string;
  location_tag?: string;
  recurrence_rule?: string;
  dependency_ids?: number[];
}

interface CreateTaskPayload {
  description: string;
  assigned_to: string;
  assignee_ids?: string[];
  priority: Task["priority"];
  deadline: string;
  planned_minutes?: number;
  machine_id?: string;
  machine_name?: string;
  location_tag?: string;
  recurrence_rule?: string;
  dependency_ids?: number[];
  project_no?: string;
  project_name?: string;
  customer_name?: string;
  scope_name?: string;
  quantity_index?: string;
  instance_count?: number;
  rework_date?: string | null;
}

export function fetchTasks() {
  return apiRequest<Task[]>("/tasks");
}

export function createTask(task: CreateTaskPayload) {
  return apiRequest<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateTask(taskId: number, data: UpdateTaskPayload) {
  return apiRequest<Task>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function cancelTask(taskId: number, reason?: string) {
  return apiRequest<Task>(`/tasks/${taskId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function fetchTaskActivity(taskId: number) {
  return apiRequest<TaskActivity[]>(`/tasks/${taskId}/activity`);
}

export function fetchTaskLogs(taskId: number) {
  return apiRequest<TaskLog[]>(`/tasks/${taskId}/logs`);
}

export function addTaskLog(
  taskId: number,
  payload: { step_name?: string; status?: string; notes?: string; action?: string },
) {
  return apiRequest<{ success: boolean }>(`/tasks/${taskId}/logs`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchTaskChecklists(taskId: number) {
  return apiRequest<TaskChecklist[]>(`/tasks/${taskId}/checklists`);
}

export function addTaskChecklist(taskId: number, payload: { item: string; is_completed?: boolean }) {
  return apiRequest<{ success: boolean }>(`/tasks/${taskId}/checklists`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTaskChecklist(
  taskId: number,
  checklistId: string,
  payload: { item?: string; is_completed?: boolean },
) {
  return apiRequest<{ success: boolean }>(`/tasks/${taskId}/checklists/${checklistId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTaskChecklist(taskId: number, checklistId: string) {
  return apiRequest<{ success: boolean }>(`/tasks/${taskId}/checklists/${checklistId}`, {
    method: "DELETE",
  });
}

export function fetchTaskAttachments(taskId: number) {
  return apiRequest<TaskAttachment[]>(`/tasks/${taskId}/attachments`);
}

export interface TaskAttachmentUploadResponse {
  success: boolean;
  attachment: TaskAttachment;
  max_file_size_mb: number;
}

export function uploadTaskAttachment(taskId: number, file: File) {
  const body = new FormData();
  body.append("file", file);

  return apiRequest<TaskAttachmentUploadResponse>(`/tasks/${taskId}/attachments`, {
    method: "POST",
    body,
  });
}

export function deleteTaskAttachment(taskId: number, attachmentId: string) {
  return apiRequest<{ success: boolean }>(`/tasks/${taskId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}
