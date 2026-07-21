const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const { canCancelTask } = require("../services/taskService");

function user(overrides = {}) {
  return {
    employee_id: "EMP-1",
    department_id: "design",
    permissions: [PERMISSIONS.VIEW_SELF_TASKS],
    role: { id: "employee", name: "Employee", hierarchy_level: 6, permissions: {} },
    visible_user_ids: ["EMP-1"],
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 10,
    task_type: "department_workflow",
    department_id: "design",
    assigned_to: "EMP-1",
    assigned_user_id: "EMP-1",
    assignee_ids: ["EMP-1"],
    assigned_by: "LEAD-1",
    created_by: "LEAD-1",
    project_id: "project-1",
    project_created_by_user_id: "LEAD-1",
    status: "assigned",
    verification_status: "pending",
    ...overrides,
  };
}

test("plain assignee cannot cancel unless they also have cancellation authority", async () => {
  assert.equal(await canCancelTask(user(), task()), false);
});

test("original assigner can cancel the task", async () => {
  const actor = user({ employee_id: "LEAD-1", visible_user_ids: ["LEAD-1"] });
  assert.equal(await canCancelTask(actor, task({ assigned_to: "EMP-1" })), true);
});

test("task assignment or task management permission can cancel visible tasks", async () => {
  const visibleManager = user({
    employee_id: "MGR-1",
    permissions: [PERMISSIONS.VIEW_ALL_TASKS, PERMISSIONS.ASSIGN_TASK],
    visible_user_ids: ["MGR-1", "LEAD-1", "EMP-1"],
  });
  assert.equal(await canCancelTask(visibleManager, task()), true);

  const editor = user({
    employee_id: "EDITOR-1",
    permissions: [PERMISSIONS.VIEW_ALL_TASKS, PERMISSIONS.EDIT_TASK],
    visible_user_ids: ["EDITOR-1", "LEAD-1", "EMP-1"],
  });
  assert.equal(await canCancelTask(editor, task()), true);
});

test("department leader role can cancel visible team tasks", async () => {
  const leader = user({
    employee_id: "LEADER-1",
    permissions: [PERMISSIONS.VIEW_ALL_TASKS],
    role: { id: "team_leader", name: "Team Leader", hierarchy_level: 4, permissions: {} },
    visible_user_ids: ["LEADER-1", "LEAD-1", "EMP-1"],
  });

  assert.equal(await canCancelTask(leader, task()), true);
});