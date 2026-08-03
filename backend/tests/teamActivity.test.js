const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
const { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = require("../config/constants");
const { hasPermission } = require("../services/accessControlService");
const { requirePermission } = require("../middleware/requirePermission");
const { listTeamActivityRows } = require("../repositories/teamActivityRepository");
const { buildTeamActivity, listTeamActivity } = require("../services/teamActivityService");

const now = new Date("2026-07-29T12:00:00.000Z");

function row(overrides = {}) {
  return {
    employee_id: "EMP-1",
    employee_name: "Rahul Patil",
    task_id: 1,
    task_type: "department_workflow",
    title: "Drafting",
    resolved_project_no: "25-119",
    resolved_fixture_no: "F01",
    resolved_stage_name: "Drafting",
    status: "assigned",
    lifecycle_status: "assigned",
    verification_status: "pending",
    deadline: "2026-07-30T12:00:00.000Z",
    project_status: "active",
    current_task_id: null,
    ...overrides,
  };
}

function permissionUser(permission = true) {
  return {
    employee_id: "LEAD-1",
    permissions: permission ? [PERMISSIONS.VIEW_TEAM_ACTIVITY] : [],
    role: { permissions: {} },
  };
}

async function permissionError(user) {
  let captured;
  await requirePermission(PERMISSIONS.VIEW_TEAM_ACTIVITY)({ user }, {}, (error) => { captured = error; });
  return captured;
}

test("Team Leader has Team Activity access by default", async () => {
  assert.ok(ROLE_DEFAULT_PERMISSIONS.r3.includes(PERMISSIONS.VIEW_TEAM_ACTIVITY));
  assert.equal(hasPermission(permissionUser(), PERMISSIONS.VIEW_TEAM_ACTIVITY), true);
  assert.equal(await permissionError(permissionUser()), undefined);
});

test("Co-Leader has Team Activity access by default", async () => {
  assert.ok(ROLE_DEFAULT_PERMISSIONS.r4.includes(PERMISSIONS.VIEW_TEAM_ACTIVITY));
  assert.equal(hasPermission(permissionUser(), PERMISSIONS.VIEW_TEAM_ACTIVITY), true);
});

test("regular employee receives 403", async () => {
  const error = await permissionError(permissionUser(false));
  assert.equal(error.statusCode, 403);
});

test("CEO and Director have no Team Activity access without explicit permission", () => {
  for (const roleName of ["CEO", "Director"]) {
    assert.equal(hasPermission({ employee_id: roleName, permissions: [], role: { name: roleName, permissions: {} } }, PERMISSIONS.VIEW_TEAM_ACTIVITY), false);
  }
});

test("repository scopes both set-based queries to the authenticated employee and has no leader-id input", async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };

  await listTeamActivityRows("LEAD-1", client);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params[0], "LEAD-1");
  assert.deepEqual(calls[1].params, ["LEAD-1"]);
  assert.match(calls[0].sql, /build self \+ descendant tree only|visible_users = self \+ descendants/i);
  assert.match(calls[0].sql, /SELECT DISTINCT/);
  assert.doesNotMatch(calls[0].sql, /NOT IN \('team_leader'/);
});

test("Leader sees only rows returned from the authenticated team mapping", async () => {
  const result = await listTeamActivity({ employee_id: "LEAD-1" }, {
    repository: { listTeamActivityRows: async (employeeId) => employeeId === "LEAD-1" ? [row()] : [] },
    now,
  });
  assert.deepEqual(result.map((item) => item.employee_id), ["EMP-1"]);
});

test("Co-Leader sees only rows returned from the combined mapped team", async () => {
  const result = await listTeamActivity({ employee_id: "CO-1" }, {
    repository: { listTeamActivityRows: async (employeeId) => employeeId === "CO-1" ? [row({ employee_id: "EMP-2" })] : [] },
    now,
  });
  assert.deepEqual(result.map((item) => item.employee_id), ["EMP-2"]);
});

test("duplicate mappings and task joins do not duplicate employees or counts", () => {
  const result = buildTeamActivity([row(), row()], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].total_active_tasks, 1);
});

test("expanded task details preserve the scoped employee and proof links", () => {
  const result = buildTeamActivity([row({ proof_url: ["/uploads/task-proofs/proof.png"] })], now)[0];
  assert.deepEqual(result.tasks, [{ task_id: "1", project_no: "25-119", task_or_fixture: "F01", stage: "Drafting", status: "assigned", assignee: "Rahul Patil", proof_urls: ["/uploads/task-proofs/proof.png"] }]);
});
test("Current Task uses the selected single-current-task record", () => {
  const result = buildTeamActivity([row({ status: "in_progress", current_task_id: 1 })], now)[0];
  assert.equal(result.current_task, "25-119 · F01\nDrafting");
  assert.equal(result.status, "Working");
});

test("multiple running legacy tasks require task selection", () => {
  const result = buildTeamActivity([
    row({ task_id: 1, status: "in_progress", current_task_id: 1 }),
    row({ task_id: 2, status: "in_progress", current_task_id: null }),
  ], now)[0];
  assert.equal(result.current_task, "Task selection required");
  assert.equal(result.status, "Task Selection Required");
});

test("active count includes supported task sources once and excludes completed and cancelled tasks", () => {
  const result = buildTeamActivity([
    row({ task_id: 1, status: "assigned" }),
    row({ task_id: "control-workflow:1", task_type: "control_workflow", status: "assigned" }),
    row({ task_id: "control-revision:1", task_type: "control_revision", status: "rework" }),
    row({ task_id: 4, status: "closed", lifecycle_status: "completed" }),
    row({ task_id: 5, status: "cancelled", lifecycle_status: "cancelled" }),
  ], now)[0];
  assert.equal(result.total_active_tasks, 3);
});

test("status rules are deterministic with overdue priority", () => {
  assert.equal(buildTeamActivity([row({ task_id: null })], now)[0].status, "Available");
  assert.equal(buildTeamActivity([row()], now)[0].status, "Not Started");
  assert.equal(buildTeamActivity([row({ status: "in_progress", current_task_id: 1 })], now)[0].status, "Working");
  assert.equal(buildTeamActivity([row({ deadline: "2026-07-28T12:00:00.000Z" })], now)[0].status, "Overdue");
  assert.equal(buildTeamActivity([row({ status: "in_progress", current_task_id: 1, deadline: "2026-07-28T12:00:00.000Z" })], now)[0].status, "Overdue");
});

test("additional current tasks use project number and task name", () => {
  const result = buildTeamActivity([row({ task_type: "additional_design", title: "Print Checking", resolved_stage_name: null, status: "in_progress", current_task_id: 1 })], now)[0];
  assert.equal(result.current_task, "25-119\nPrint Checking");
});
