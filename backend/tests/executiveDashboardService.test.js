const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const {
  buildExecutiveDashboardModel,
  canApprovalTaskBeApprovedByUser,
  getPeriodRange,
} = require("../services/executiveDashboardService");

function project(overrides = {}) {
  return {
    project_id: "project-1",
    project_no: "PARC-1",
    project_name: "Project 1",
    customer_name: "Customer",
    department_id: "design",
    department_name: "Design",
    project_status: "active",
    completion_percent: 0,
    total_fixtures: 1,
    active_tasks: 0,
    pending_tasks: 0,
    completed_tasks: 0,
    total_tasks: 0,
    created_at: "2026-07-01T05:00:00.000Z",
    updated_at: "2026-07-09T05:00:00.000Z",
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    employee_id: "EMP-1",
    department_id: "design",
    permissions: [PERMISSIONS.APPROVE_COMPLETED_TASK],
    role: { id: "team_leader", name: "Team Leader", permissions: {}, hierarchy_level: 3 },
    ...overrides,
  };
}

test("getPeriodRange uses Monday business weeks in Asia/Kolkata", async () => {
  const range = await getPeriodRange("this_week", new Date("2026-07-10T10:00:00.000Z"));

  assert.equal(range.start.toISOString(), "2026-07-05T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-12T18:30:00.000Z");
  assert.equal(range.previousStart.toISOString(), "2026-06-28T18:30:00.000Z");
  assert.equal(range.previousEnd.toISOString(), "2026-07-05T18:30:00.000Z");
});

test("buildExecutiveDashboardModel scopes cards to the selected department but compares all visible departments", async () => {
  const periodRange = await getPeriodRange("this_week", new Date("2026-07-10T10:00:00.000Z"));
  const departments = [
    { id: "design", label: "Design", name: "Design" },
    { id: "control", label: "Control", name: "Control" },
  ];
  const projectSummaries = [
    project({ project_id: "design-active", project_no: "PARC-D1", project_name: "Design Active", completion_percent: 40, team_lead_id: "EMP-D1", team_lead_name: "Ankit P." }),
    project({ project_id: "design-overdue", project_no: "PARC-D2", project_name: "Design Overdue", completion_percent: 15, team_lead_id: "EMP-D2", team_lead_name: "Kunal M." }),
    project({ project_id: "control-complete", project_no: "PARC-C1", project_name: "Control Released", department_id: "control", department_name: "Control", project_status: "released", completion_percent: 100, team_lead_id: "EMP-C1", team_lead_name: "Nilesh J." }),
  ];
  const supplements = new Map([
    ["design-active", { effective_due_at: "2026-08-01T05:00:00.000Z", last_task_at: "2026-07-09T05:00:00.000Z", current_stage: "Concept" }],
    ["design-overdue", { effective_due_at: "2026-07-01T05:00:00.000Z", last_task_at: "2026-07-09T05:00:00.000Z", current_stage: "3D" }],
    ["control-complete", { last_task_at: "2026-07-08T05:00:00.000Z", current_stage: "Released" }],
  ]);
  const completionEvents = new Map([
    ["control-complete", [new Date("2026-07-08T05:00:00.000Z")]],
  ]);

  const model = await buildExecutiveDashboardModel({
    user: makeUser(),
    departments,
    projectSummaries,
    supplementsByProject: supplements,
    completionEventsByProject: completionEvents,
    approvalTasks: [],
    filters: {
      selectedDepartment: { id: "design", label: "Design Department", mode: "department" },
      periodRange,
      status: "all",
      risk: "all",
      search: "",
      page: 1,
      pageSize: 7,
    },
    now: new Date("2026-07-10T10:00:00.000Z"),
  });

  assert.equal(model.kpis.find((kpi) => kpi.id === "total_active_projects").value, 2);
  assert.equal(model.kpis.find((kpi) => kpi.id === "completed_this_period").value, 0);
  assert.equal(model.kpis.find((kpi) => kpi.id === "overdue").value, 1);
  assert.equal(model.table.total_rows, 2);
  assert.equal(model.table.rows.some((row) => row.department_id === "control"), false);

  const controlComparison = model.department_comparison.find((row) => row.department_id === "control");
  assert.equal(controlComparison.completed_this_period, 1);
  assert.equal(controlComparison.total_projects, 1);
});

test("approval summary rules reject self approval unless explicitly allowed", async () => {
  const task = {
    department_id: "design",
    assigned_to: "EMP-1",
    assignee_ids: ["EMP-1"],
    approval_stage: "manager",
  };

  assert.equal(await canApprovalTaskBeApprovedByUser(task, makeUser()), false);
  assert.equal(await canApprovalTaskBeApprovedByUser(task, makeUser({ employee_id: "EMP-2" })), true);
  assert.equal(await canApprovalTaskBeApprovedByUser(task, makeUser({ permissions: [PERMISSIONS.APPROVE_COMPLETED_TASK, PERMISSIONS.SELF_APPROVE] })), true);
});

