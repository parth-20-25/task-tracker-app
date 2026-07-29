import { describe, expect, it } from "vitest";
import { classifyScopeFixture, planningStagesForUser } from "@/lib/projectScope";
import { PERMISSIONS } from "@/lib/permissions";
import type { User } from "@/types";

function planner(team: "2D" | "3D", role = "Team Leader") {
  return {
    employee_id: `LEAD-${team}`,
    permissions: [PERMISSIONS.EDIT_PROJECT_PLANNED_TIME],
    role: { id: role, name: role, hierarchy_level: 4, permissions: {}, scope: "team" },
    subdivision: { id: team, department_id: "design", subdivision_name: team, is_active: true },
  } as User;
}

describe("project scope presentation rules", () => {
  it("mirrors deterministic precedence for WBS warnings", () => {
    expect(classifyScopeFixture({ fixture_type: "Robotic Welding Cell Fixture" })).toBe("ROBOTIC_CELL_SHUTTLE");
    expect(classifyScopeFixture({ fixture_type: "Pumatic Gantry" })).toBe("SERVO_PNEUMATIC_GANTRY");
    expect(classifyScopeFixture({ fixture_type: "Mystery Tool" })).toBeNull();
  });

  it("makes all stages editable for 3D leaders and only 2D Finish for 2D leaders", () => {
    expect(planningStagesForUser(planner("3D"))).toEqual(["CONCEPT", "DAP", "THREE_D_FINISH", "TWO_D_FINISH"]);
    expect(planningStagesForUser(planner("2D", "Co-Leader"))).toEqual(["TWO_D_FINISH"]);
    expect(planningStagesForUser({ ...planner("3D"), permissions: [] } as User)).toEqual([]);
    expect(planningStagesForUser(planner("3D", "Employee"))).toEqual([]);
  });
});