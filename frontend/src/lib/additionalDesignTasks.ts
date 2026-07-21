import type { AdditionalDesignTaskKind, DesignTeam, User } from "@/types";

export const ADDITIONAL_DESIGN_TASK_CATALOG: Record<DesignTeam, AdditionalDesignTaskKind[]> = {
  "2D": [
    "Drafting",
    "Print & Drafting Checking",
    "BOM Checking",
    "Drawing Correction",
    "AutoCAD PDF",
    "IGES Data",
    "CMM Data",
    "Line Layout",
    "Mimic Display",
    "Wear-Out Data",
  ],
  "3D": [
    "Project Process",
    "Pin Matrix",
    "PPT",
    "CBO",
    "Line Layout",
    "CDRM",
    "Print",
    "Drafting Checking",
  ],
};

function normalizeContext(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function resolveDesignTeamFromUser(user: User | null | undefined): DesignTeam | null {
  const department = normalizeContext(user?.department?.name || user?.department_id);
  const subdivision = normalizeContext(user?.subdivision?.subdivision_name || user?.subdivision_id).toUpperCase();

  if (department !== "design") {
    return null;
  }

  return subdivision === "2D" || subdivision === "3D" ? subdivision : null;
}

export function shouldHideAdditionalDesignTasks(user: User | null | undefined) {
  return resolveDesignTeamFromUser(user) === "2D";
}
