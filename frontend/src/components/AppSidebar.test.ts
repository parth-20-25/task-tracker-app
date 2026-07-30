import { describe, expect, it } from "vitest";
import { getMainNavigationItems } from "@/components/AppSidebar";
import { buildUiAccess, PERMISSIONS } from "@/lib/permissions";
import type { User } from "@/types";

function user(role: string, permissions: string[] = []): User {
  return {
    employee_id: `${role}-1`,
    name: role,
    role_id: role,
    role: { id: role, name: role, permissions: {}, scope: "global" },
    permissions,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function navigationFor(currentUser: User) {
  return getMainNavigationItems(currentUser, buildUiAccess(currentUser).canViewProjectScope);
}

describe("Project Scope navigation", () => {
  it.each([
    user("Admin"),
    user("CEO", [PERMISSIONS.VIEW_PROJECT_SCOPE]),
    user("Director", [PERMISSIONS.VIEW_PROJECT_SCOPE]),
  ])("places the authorized $role.name tab directly below Dashboard", (currentUser) => {
    const items = navigationFor(currentUser);

    expect(items.slice(0, 2).map(({ title }) => title)).toEqual(["Dashboard", "Project Scope"]);
    expect(items.filter(({ title }) => title === "Project Scope")).toHaveLength(1);
    expect(items.find(({ title }) => title === "Project Scope")?.url).toBe("/view-scope");
    expect(items.some(({ title }) => title === "View Scope")).toBe(false);
  });

  it("keeps unauthorized employees restricted even if the permission is misassigned", () => {
    expect(navigationFor(user("Employee", [PERMISSIONS.VIEW_PROJECT_SCOPE])).some(
      ({ title }) => title === "Project Scope",
    )).toBe(false);
  });
});
