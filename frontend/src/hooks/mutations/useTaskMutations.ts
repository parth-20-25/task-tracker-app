import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelTask, createTask, updateTask } from "@/api/taskApi";
import { adminQueryKeys, analyticsQueryKeys, batchQueryKeys, taskAssignmentQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { Task, TaskStatus, VerificationStatus } from "@/types";

interface CreateTaskInput {
  task_type: Task["task_type"];
  title?: string;
  description: string;
  assigned_to: string;
  assignee_ids?: string[];
  priority: Task["priority"];
  deadline: string;
  planned_minutes?: number;
  location_tag?: string;
  recurrence_rule?: string;
  dependency_ids?: number[];
  project_no?: string;
  project_name?: string;
  customer_name?: string;
  quantity_index?: string;
  instance_count?: number;
  rework_date?: string | null;
  department_id?: string | null;
  approval_required?: boolean;
  proof_required?: boolean;
  project_id?: string;
  fixture_id?: string | null;
  additional_task_kind?: Task["additional_task_kind"];
  design_team?: Task["design_team"];
}

interface UpdateTaskInput {
  taskId: number;
  action?: "start" | "resume" | "hold" | "submit";
  verification_action?: "approve" | "reject";
  status?: TaskStatus;
  completion_percent?: number;
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
  location_tag?: string;
  recurrence_rule?: string;
  dependency_ids?: number[];
}

export function useTaskMutations() {
  const queryClient = useQueryClient();

  const invalidateTaskState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
      queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      queryClient.invalidateQueries({ queryKey: taskAssignmentQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users("assignable") }),
    ]);
  };

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: invalidateTaskState,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, ...payload }: UpdateTaskInput) => updateTask(taskId, payload),
    onSuccess: invalidateTaskState,
  });

  const cancelTaskMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: number; reason?: string }) => cancelTask(taskId, reason),
    onSuccess: invalidateTaskState,
  });

  return {
    cancelTaskMutation,
    createTaskMutation,
    updateTaskMutation,
  };
}
