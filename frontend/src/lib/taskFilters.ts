import type { Task, TaskStatus } from "@/types";

export const MY_TASK_STATUS_FILTERS = ["all", "active", "on_hold", "review", "rework", "closed"] as const;
export type MyTaskStatusFilter = (typeof MY_TASK_STATUS_FILTERS)[number];

export const TEAM_TASK_STATUS_FILTERS = [
  "active",
  "pending",
  "pending_verification",
  "on_hold",
  "rejected",
  "closed",
  "cancelled",
] as const;
export type TeamTaskStatusFilter = (typeof TEAM_TASK_STATUS_FILTERS)[number];

export const MY_TASK_ACTIVE_STATUSES: TaskStatus[] = ["created", "assigned", "in_progress"];

export function isTaskAssignedToEmployee(task: Task, employeeId: string | null | undefined) {
  if (!employeeId) {
    return false;
  }

  return task.assigned_to === employeeId || task.assignee_ids?.includes(employeeId) === true;
}

export function isMyActiveTask(task: Task) {
  return MY_TASK_ACTIVE_STATUSES.includes(task.status);
}

export function isPendingVerificationTask(task: Task) {
  return task.status === "under_review" && task.verification_status === "pending";
}

export function normalizeMyTaskStatusFilter(value: string | null | undefined): MyTaskStatusFilter {
  return MY_TASK_STATUS_FILTERS.includes(value as MyTaskStatusFilter)
    ? value as MyTaskStatusFilter
    : "all";
}

export function normalizeTeamTaskStatusFilter(value: string | null | undefined): TeamTaskStatusFilter {
  return TEAM_TASK_STATUS_FILTERS.includes(value as TeamTaskStatusFilter)
    ? value as TeamTaskStatusFilter
    : "active";
}

export function matchesMyTaskStatusFilter(task: Task, filter: MyTaskStatusFilter) {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return isMyActiveTask(task);
    case "on_hold":
      return task.status === "on_hold";
    case "review":
      return task.status === "under_review";
    case "rework":
      return task.status === "rework";
    case "closed":
      return task.status === "closed";
    default:
      return false;
  }
}

export function matchesTeamTaskStatusFilter(task: Task, filter: TeamTaskStatusFilter) {
  switch (filter) {
    case "active":
      return task.status === "in_progress";
    case "pending":
      return task.status === "created" || task.status === "assigned";
    case "pending_verification":
      return isPendingVerificationTask(task);
    case "on_hold":
      return task.status === "on_hold";
    case "rejected":
      return task.status === "rework" && task.verification_status === "rejected";
    case "closed":
      return task.status === "closed";
    case "cancelled":
      return task.status === "cancelled";
    default:
      return false;
  }
}
