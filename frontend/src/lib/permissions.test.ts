import { describe, expect, it } from "vitest";
import {
  isControlDesignDashboardUser,
  resolveControlDesignIdentity,
} from "@/lib/permissions";
import type { User } from "@/types";

function controlUser(subDepartment: string): User {
  return {
    employee_id: "EMP-CD",
    name: "Control Designer",
    department_id: "control",
    department: { id: "control", name: "Control" },
    role_id: "r9",
    role: { id: "r9", name: "Team Leader", hierarchy_level: 4, permissions: {}, scope: "department" },
    permissions: [],
    subdivision_id: "b27a2a7f-8ad6-487d-9f5a-e5c4b91677d3",
    subdivision: {
      id: "b27a2a7f-8ad6-487d-9f5a-e5c4b91677d3",
      department_id: "control",
      subdivision_name: subDepartment,
      is_active: true,
    },
    is_active: true,
    created_at: "2026-07-15T00:00:00.000Z",
  };
}

describe("Control Design identity resolution", () => {
  it.each(["Control Design", "Control-Design", "control design", "CONTROL DESIGN", "Control_Design"])(
    "normalizes %s to the canonical Control Design identity",
    (variant) => {
      const identity = resolveControlDesignIdentity(controlUser(variant));

      expect(identity.canonicalDepartmentId).toBe("control");
      expect(identity.canonicalSubDepartmentId).toBe("control_design");
      expect(identity.isControlDesign).toBe(true);
      expect(isControlDesignDashboardUser(controlUser(variant))).toBe(true);
    },
  );

  it("does not require workspace permission for dashboard route identity", () => {
    const user = controlUser("Control Design");
    user.permissions = ["control_design.projects.create"];

    expect(isControlDesignDashboardUser(user)).toBe(true);
  });

  it("does not route Control users with missing sub-department to Control Design", () => {
    const user = {
      ...controlUser("Control Design"),
      subdivision_id: null,
      subdivision: null,
    };

    expect(resolveControlDesignIdentity(user).isControlDesign).toBe(false);
    expect(isControlDesignDashboardUser(user)).toBe(false);
  });
});