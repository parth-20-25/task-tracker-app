import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelTask, createTask, updateTask } from "@/api/taskApi";
import { adminQueryKeys, analyticsQueryKeys, notificationQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { Task, TaskStatus, VerificationStatus } from "@/types";

interface CreateTaskInput {
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

interface UpdateTaskInput {
  taskId: number;
  action?: "start" | "resume" | "hold" | "submit";
  verification_action?: "approve" | "reject";
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

export function useTaskMutations() {
  const queryClient = useQueryClient();

  const invalidateTaskState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
      queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all }),
    ]);
  };

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: async () => {
      await Promise.all([
        invalidateTaskState(),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.users("assignable") }),
      ]);
    },
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
