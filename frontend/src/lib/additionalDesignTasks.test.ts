import { describe, expect, it } from "vitest";

import { ADDITIONAL_DESIGN_TASK_CATALOG, DESIGN_3D_ADDITIONAL_DAP_POINTS, DESIGN_3D_ADDITIONAL_MOM, getAdditionalDesignTaskLabel, shouldHideAdditionalDesignTasks } from "@/lib/additionalDesignTasks";
import type { User } from "@/types";

function designUser(subdivision: string) {
  return {
    employee_id: `EMP-${subdivision}`,
    department_id: "design",
    department: { name: "Design" },
    subdivision: { subdivision_name: subdivision },
  } as User;
}

describe("shouldHideAdditionalDesignTasks", () => {
  it("hides Additional Tasks only for Design 2D users", () => {
    expect(shouldHideAdditionalDesignTasks(designUser("2D"))).toBe(true);
    expect(shouldHideAdditionalDesignTasks(designUser("3D"))).toBe(false);
    expect(shouldHideAdditionalDesignTasks({ department_id: "control" } as User)).toBe(false);
  });
});

describe("DAP Points catalog identity", () => {
  it("uses a separate internal key and the DAP Points label", () => {
    expect(ADDITIONAL_DESIGN_TASK_CATALOG["3D"]).toContain(DESIGN_3D_ADDITIONAL_DAP_POINTS);
    expect(DESIGN_3D_ADDITIONAL_DAP_POINTS).not.toBe("DAP");
    expect(getAdditionalDesignTaskLabel(DESIGN_3D_ADDITIONAL_DAP_POINTS)).toBe("DAP Points");
  });
});
describe("MOM catalog identity", () => {
  it("uses the stable 3D additional-task identifier and MOM label", () => {
    expect(ADDITIONAL_DESIGN_TASK_CATALOG["3D"]).toContain(DESIGN_3D_ADDITIONAL_MOM);
    expect(DESIGN_3D_ADDITIONAL_MOM).not.toBe("MOM");
    expect(getAdditionalDesignTaskLabel(DESIGN_3D_ADDITIONAL_MOM)).toBe("MOM");
  });
});
