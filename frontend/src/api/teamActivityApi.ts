import { apiRequest } from "@/api/http";

export type TeamActivityStatus = "Working" | "Not Started" | "Available" | "Overdue" | "Task Selection Required";

export interface TeamActivityTask {
  task_id: string;
  project_no: string;
  task_or_fixture: string;
  stage: string;
  status: string;
  assignee: string;
  proof_urls: string[];
}

export interface TeamActivityRow {
  employee_id: string;
  employee_name: string;
  current_task: string;
  total_active_tasks: number;
  status: TeamActivityStatus;
  tasks: TeamActivityTask[];
}

export function fetchTeamActivity() {
  return apiRequest<TeamActivityRow[]>("/team-activity");
}