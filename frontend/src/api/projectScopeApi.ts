import { apiRequest } from "@/api/http";

export type PlannedStage = "CONCEPT" | "DAP" | "THREE_D_FINISH" | "TWO_D_FINISH";
export type PlannedUnit = "HOURS" | "DAYS";

export interface PlannedStageValue {
  entered_value: number | null;
  entered_unit: PlannedUnit;
  normalized_hours: number | null;
  version: number;
  updated_at: string | null;
}

export interface ProjectPlanningData {
  project: { project_id: string; project_no: string; project_name: string };
  team: "2D" | "3D";
  editable_stages: PlannedStage[];
  working_hours_per_day: number;
  stages: Record<PlannedStage, PlannedStageValue>;
}

export interface PendingProjectPlanningData {
  team: "2D" | "3D";
  editable_stages: PlannedStage[];
  working_hours_per_day: number;
  projects: Array<ProjectPlanningData["project"] & { stages: ProjectPlanningData["stages"] }>;
}

export interface ProjectScopeRow {
  project_id: string;
  sr_no: number;
  priority: string | null;
  project_no: string;
  project_description: string;
  robotic_welding_fix: number;
  manual_welding_fix: number;
  spms: number;
  manual_auto_inspection: number;
  hand_gauge: number;
  robotic_cell_shuttle: number;
  servo_pumatic_gantry: number;
  total_scope: number;
  concept_hours: number | null;
  dap_hours: number | null;
  three_d_finish_hours: number | null;
  two_d_finish_hours: number | null;
  total_hours: number;
  days: number;
  unclassified_fixture_count: number;
}

export function fetchProjectScope() {
  return apiRequest<{ working_hours_per_day: number; projects: ProjectScopeRow[] }>("/project-scope");
}

export function fetchProjectPlannedTime(projectId: string) {
  return apiRequest<ProjectPlanningData>(`/projects/${encodeURIComponent(projectId)}/planned-time`);
}

export function fetchPendingProjectPlanning() {
  return apiRequest<PendingProjectPlanningData>("/project-planning/pending");
}

export function saveProjectPlannedTime(
  projectId: string,
  payload: { unit: PlannedUnit; stages: Partial<Record<PlannedStage, { value: number | null; version: number }>> },
) {
  return apiRequest<ProjectPlanningData>(`/projects/${encodeURIComponent(projectId)}/planned-time`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}