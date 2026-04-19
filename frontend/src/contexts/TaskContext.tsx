import React, { useCallback } from "react";
import { useTaskMutations } from "@/hooks/mutations/useTaskMutations";
import { useTasksQuery } from "@/hooks/queries/useTasksQuery";
import { TaskStatus, VerificationStatus } from "@/types";
import { NewTaskInput, TaskContext } from "@/contexts/useTasks";

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const tasksQuery = useTasksQuery();
  const { cancelTaskMutation, createTaskMutation, updateTaskMutation } = useTaskMutations();
  const tasks = tasksQuery.data ?? [];

  const updateTaskStatus = useCallback(async (taskId: number, status: TaskStatus) => {
    await updateTaskMutation.mutateAsync({ taskId, status });
  }, [updateTaskMutation]);

  const verifyTask = useCallback(async (taskId: number, verificationStatus: VerificationStatus, remarks?: string) => {
    await updateTaskMutation.mutateAsync({
      taskId,
      verification_status: verificationStatus,
      remarks,
    });
  }, [updateTaskMutation]);

  const addTask = useCallback(async (task: NewTaskInput) => {
    await createTaskMutation.mutateAsync(task);
  }, [createTaskMutation]);

  const cancelTask = useCallback(async (taskId: number, reason?: string) => {
    await cancelTaskMutation.mutateAsync({ taskId, reason });
  }, [cancelTaskMutation]);

  const uploadProof = useCallback(async (taskId: number, proofUrl: string, proofType: string) => {
    await updateTaskMutation.mutateAsync({
      taskId,
      proof_url: proofUrl,
      proof_type: proofType,
    });
  }, [updateTaskMutation]);

  const refreshTasks = useCallback(async () => {
    await tasksQuery.refetch();
  }, [tasksQuery]);

  return (
    <TaskContext.Provider
      value={{
        tasks,
        updateTaskStatus,
        verifyTask,
        cancelTask,
        addTask,
        uploadProof,
        refreshTasks,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}
