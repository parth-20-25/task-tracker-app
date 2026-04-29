import { createContext, useContext } from "react";
import { Task, TaskType } from "@/types";

export interface NewTaskInput {
  task_type: TaskType;
  title?: string;
  description: string;
  assigned_to: string;
  assignee_ids?: string[];
  department_id?: string | null;
  workflow_template_id?: string | null;
  priority: Task["priority"];
  deadline: string;
  approval_required?: boolean;
  proof_required?: boolean;
  tags?: string[];
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

export interface TaskContextType {
  tasks: Task[];
  executeTaskAction: (taskId: number, action: "start" | "resume" | "hold" | "submit") => Promise<void>;
  verifyTask: (taskId: number, action: "approve" | "reject", remarks?: string) => Promise<void>;
  cancelTask: (taskId: number, reason?: string) => Promise<void>;
  addTask: (task: NewTaskInput) => Promise<void>;
  uploadProof: (taskId: number, proofUrl: string, proofType: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
}

export const TaskContext = createContext<TaskContextType | null>(null);

export function useTasks() {
  const ctx = useContext(TaskContext);

  if (!ctx) {
    throw new Error("useTasks must be used within TaskProvider");
  }

  return ctx;
}
