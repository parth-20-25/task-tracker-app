import React, { useCallback } from "react";
import { useTaskMutations } from "@/hooks/mutations/useTaskMutations";
import { useTasksQuery } from "@/hooks/queries/useTasksQuery";
import { NewTaskInput, TaskContext } from "@/contexts/useTasks";

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const tasksQuery = useTasksQuery();
  const { cancelTaskMutation, createTaskMutation, updateTaskMutation } = useTaskMutations();
  const tasks = (tasksQuery.data ?? []).filter((task) => task.status !== "cancelled");

  const executeTaskAction = useCallback(async (taskId: number, action: "start" | "resume" | "hold" | "submit") => {
    await updateTaskMutation.mutateAsync({ taskId, action });
  }, [updateTaskMutation]);

  const verifyTask = useCallback(async (taskId: number, verificationAction: "approve" | "reject", remarks?: string) => {
    await updateTaskMutation.mutateAsync({
      taskId,
      verification_action: verificationAction,
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
        isLoading: tasksQuery.isLoading,
        isFetching: tasksQuery.isFetching,
        executeTaskAction,
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
