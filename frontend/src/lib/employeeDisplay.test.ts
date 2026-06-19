import { describe, expect, it } from "vitest";
import { formatAssigneeOption, formatIncompleteTaskWorkload } from "./employeeDisplay";

describe("assignee workload display", () => {
  it("shows Free when a team member has no incomplete tasks", () => {
    expect(formatIncompleteTaskWorkload(0)).toBe("Free");
    expect(formatAssigneeOption({
      employee_id: "EMP-1",
      name: "Rahul",
      incomplete_task_count: 0,
    })).toBe("EMP-1 - Rahul — Free");
  });

  it("shows the current incomplete task count", () => {
    expect(formatIncompleteTaskWorkload(1)).toBe("1");
    expect(formatIncompleteTaskWorkload(2)).toBe("2");
    expect(formatIncompleteTaskWorkload(7)).toBe("7");
  });
});
