import { describe, expect, it } from "vitest";

import { buildUiAccess, canShowAdditionalDesignTasksNavigation, PERMISSIONS } from "@/lib/permissions";
import type { User } from "@/types";

function designWorker({
  permissions = [],
  subdivisionName = "2D",
}: {
  permissions?: string[];
  subdivisionName?: string;
} = {}) {
  return {
    employee_id: "EMP-2D-1",
    name: "2D Designer",
    department_id: "design",
    department: { id: "design", name: "Design" },
    subdivision_id: `subdivision-${subdivisionName.toLowerCase()}`,
    subdivision: {
      id: `subdivision-${subdivisionName.toLowerCase()}`,
      department_id: "design",
      subdivision_name: subdivisionName,
      is_active: true,
    },
    role_id: "r6",
    role: {
      id: "r6",
      name: "Designer",
      hierarchy_level: 6,
      permissions: {},
      scope: "self",
    },
    permissions,
    is_active: true,
    created_at: "2026-07-01T00:00:00.000Z",
  } as User;
}

describe("project fixture viewer access", () => {
  it.each([PERMISSIONS.VIEW_SELF_TASKS, PERMISSIONS.VIEW_ALL_TASKS])(
    "allows a normal Design 2D user with %s to read project fixtures",
    (permission) => {
      const access = buildUiAccess(designWorker({ permissions: [permission] }));

      expect(access.canAccessProjectFixtures).toBe(true);
      expect(access.canAssignTasks).toBe(false);
      expect(access.canChangeFixtureStage).toBe(false);
    },
  );

  it("hides Additional Tasks navigation only for replaced Design 2D work", () => {
    expect(canShowAdditionalDesignTasksNavigation(designWorker())).toBe(false);
    expect(canShowAdditionalDesignTasksNavigation(designWorker({ subdivisionName: "3D" }))).toBe(true);
    expect(canShowAdditionalDesignTasksNavigation({
      ...designWorker(),
      role_id: "r1",
      role: {
        id: "r1",
        name: "Admin",
        hierarchy_level: 1,
        permissions: { all: true },
        scope: "global",
      },
    })).toBe(true);
  });

  it("does not grant project fixture access to another subdivision or a 2D user without a view permission", () => {
    expect(buildUiAccess(designWorker({
      permissions: [PERMISSIONS.VIEW_SELF_TASKS],
      subdivisionName: "3D",
    })).canAccessProjectFixtures).toBe(false);
    expect(buildUiAccess(designWorker()).canAccessProjectFixtures).toBe(false);
  });
});
