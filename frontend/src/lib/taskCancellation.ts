import type { UiAccess } from "@/lib/permissions";
import { isOperationalControllerUser, isProjectAuthorityUser } from "@/lib/permissions";
import type { Task, User } from "@/types";

const CANCELLABLE_TASK_STATUSES = new Set(["assigned", "created", "pending", "in_progress", "rework"]);

export function isTaskCancellable(task: Task | null | undefined) {
  if (!task) return false;
  const status = String(task.status || "").trim().toLowerCase();
  return CANCELLABLE_TASK_STATUSES.has(status)
    && task.verification_status !== "approved"
    && !task.approved_at
    && task.operational_state !== "VERIFICATION"
    && (task.task_type === "design_2d_completion" || task.operational_state !== "WORKFLOW_COMPLETE");
}

export function canShowTaskCancelAction(
  task: Task | null | undefined,
  user: User | null | undefined,
  access: UiAccess,
) {
  if (!task || !user || !isTaskCancellable(task)) return false;

  return task.assigned_by === user.employee_id
    || access.canAssignTasks
    || access.canEditTasks
    || access.canDeleteTasks
    || isOperationalControllerUser(user)
    || isProjectAuthorityUser(user);
}