import { apiRequest } from "@/api/http";

export type TeamActivityStatus = "Working" | "Not Started" | "Available" | "Overdue" | "Task Selection Required";

export interface TeamActivityRow {
  employee_id: string;
  employee_name: string;
  current_task: string;
  total_active_tasks: number;
  status: TeamActivityStatus;
}

export function fetchTeamActivity() {
  return apiRequest<TeamActivityRow[]>("/team-activity");
}
