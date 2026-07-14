import { describe, expect, it } from "vitest";

import { shouldHideAdditionalDesignTasks } from "@/lib/additionalDesignTasks";
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
