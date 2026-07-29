import type { User } from "@/types";
import { PERMISSIONS, hasUserPermission } from "@/lib/permissions";
import type { PlannedStage } from "@/api/projectScopeApi";

export const PLANNED_STAGES: PlannedStage[] = ["CONCEPT", "DAP", "THREE_D_FINISH", "TWO_D_FINISH"];
export const PLANNED_STAGE_LABELS: Record<PlannedStage, string> = {
  CONCEPT: "Concept",
  DAP: "DAP",
  THREE_D_FINISH: "3D Finish",
  TWO_D_FINISH: "2D Finish",
};

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function planningStagesForUser(user: User | null | undefined): PlannedStage[] {
  if (!hasUserPermission(user, PERMISSIONS.EDIT_PROJECT_PLANNED_TIME)) return [];
  const roles = [normalize(user?.role?.name), normalize(user?.role?.id || user?.role_id)];
  if (!roles.some((role) => ["team_leader", "line_manager", "co_leader", "team_co_leader", "shift_incharge"].includes(role))) return [];
  const team = String(user?.subdivision?.subdivision_name || "").trim().toUpperCase();
  return team === "3D" ? [...PLANNED_STAGES] : team === "2D" ? ["TWO_D_FINISH"] : [];
}

export function classifyScopeFixture(row: { fixture_type?: string; part_name?: string; remark?: string }) {
  const text = [row.fixture_type, row.part_name, row.remark].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!text) return null;
  const rules: Array<[string, RegExp]> = [
    ["ROBOTIC_CELL_SHUTTLE", /\b(?:robotic|welding)\s+cell\b|\bshuttle\b/],
    ["SERVO_PNEUMATIC_GANTRY", /\b(?:servo|pneumatic|pumatic)\b.*\bgantry\b|\bgantry\b.*\b(?:servo|pneumatic|pumatic)\b/],
    ["INSPECTION_FIXTURE", /\b(?:manual|auto|automatic)\s+inspection\b|\binspection(?:\s+fixture)?\b/],
    ["HAND_GAUGE", /\bhand\s+gauge\b|\b(?:gauge|gage)\b/],
    ["MANUAL_WELDING_FIXTURE", /\bmanual\b.*\bweld(?:ing)?\b.*\bfixture\b|\bmanual\s+weld(?:ing)?\s+fixture\b/],
    ["ROBOTIC_WELDING_FIXTURE", /\brobotic\b.*\bweld(?:ing)?\b.*\bfixture\b|\brobotic\s+weld(?:ing)?\s+fixture\b/],
    ["SPM", /\bspms?\b|\bspecial\s+purpose\s+machines?\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || null;
}