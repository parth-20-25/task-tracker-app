const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const {
  assertExecutiveDashboardAccess,
  buildExecutiveDashboardModel,
  canApprovalTaskBeApprovedByUser,
  getExecutiveDashboardForUser,
  getPeriodRange,
  normalizeDashboardQuery,
  queryCompletionEvents,
  queryProjectSupplements,
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

function createEmptyDashboardClient() {
  const client = {
    queries: [],
    async query(sql, params = []) {
      client.queries.push({ sql, params });

      if (sql.includes("FROM departments")) {
        return {
          rows: [
            { id: "design", name: "Design Department" },
            { id: "control", name: "Control Department" },
          ],
        };
      }

      if (sql.includes("FROM design.projects p") && sql.includes("p.id AS project_id")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${String(sql).replace(/\s+/g, " ").slice(0, 180)}`);
    },
  };

  return client;
}

function executiveUser(role) {
  return makeUser({
    employee_id: `${role.id || role.name}-1`,
    department_id: null,
    role: {
      hierarchy_level: 1,
      permissions: {},
      ...role,
    },
    permissions: [],
  });
}

test("executive dashboard access is limited to Admin, CEO, and Director roles", async () => {
  await assert.doesNotReject(() => assertExecutiveDashboardAccess(executiveUser({ id: "r1", name: "Admin" })));
  await assert.doesNotReject(() => assertExecutiveDashboardAccess(executiveUser({ id: "ceo", name: "CEO" })));
  await assert.doesNotReject(() => assertExecutiveDashboardAccess(executiveUser({ id: "director", name: "Director" })));
  await assert.doesNotReject(() => assertExecutiveDashboardAccess(executiveUser({ id: "ceo_director", name: "CEO/Director" })));

  await assert.rejects(
    () => assertExecutiveDashboardAccess(makeUser({ permissions: [PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS] })),
    { statusCode: 403 },
  );
  await assert.rejects(
    () => assertExecutiveDashboardAccess(makeUser({ role: { id: "employee", name: "Employee", permissions: {}, hierarchy_level: 6 } })),
    { statusCode: 403 },
  );
  await assert.rejects(
    () => assertExecutiveDashboardAccess(null),
    { statusCode: 401 },
  );
});

test("normalizeDashboardQuery validates executive API parameters", async () => {
  const admin = executiveUser({ id: "r1", name: "Admin", permissions: { all: true } });
  const departments = [
    { id: "design", label: "Design", name: "Design" },
    { id: "control", label: "Control", name: "Control" },
  ];

  const filters = await normalizeDashboardQuery({
    department: "all",
    period: "this_week",
    status: "all",
    risk: "all",
    page: "1",
    page_size: "7",
  }, admin, departments);

  assert.equal(filters.selectedDepartment.id, null);
  assert.equal(filters.selectedDepartment.mode, "all");
  assert.equal(filters.periodRange.period, "this_week");
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, 7);

  await assert.rejects(() => normalizeDashboardQuery({ period: "quarter" }, admin, departments), { statusCode: 400 });
  await assert.rejects(() => normalizeDashboardQuery({ status: "done-ish" }, admin, departments), { statusCode: 400 });
  await assert.rejects(() => normalizeDashboardQuery({ risk: "critical" }, admin, departments), { statusCode: 400 });
  await assert.rejects(() => normalizeDashboardQuery({ page: "0" }, admin, departments), { statusCode: 400 });
  await assert.rejects(() => normalizeDashboardQuery({ page_size: "999" }, admin, departments), { statusCode: 400 });
  await assert.rejects(() => normalizeDashboardQuery({ department: "unknown" }, admin, departments), { statusCode: 400 });
});

test("getExecutiveDashboardForUser returns zero state for exact executive filters", async () => {
  const admin = executiveUser({ id: "admin", name: "Admin", permissions: { all: true } });

  for (const department of ["design", "control", "all"]) {
    const client = createEmptyDashboardClient();
    const model = await getExecutiveDashboardForUser(admin, {
      department,
      period: "this_week",
      status: "all",
      risk: "all",
      page: "1",
      page_size: "7",
    }, client);

    assert.equal(model.filters.department, department);
    assert.equal(model.filters.period, "this_week");
    assert.equal(model.filters.status, "all");
    assert.equal(model.filters.risk, "all");
    assert.equal(model.selected_department.id, department === "all" ? null : department);
    assert.equal(model.table.page, 1);
    assert.equal(model.table.page_size, 7);
    assert.equal(model.table.total_rows, 0);
    assert.equal(model.table.total_pages, 0);
    assert.deepEqual(model.table.rows, []);
    assert.deepEqual(model.needs_attention, []);
    assert.deepEqual(model.owner_workload.items, []);
    assert.equal(model.approvals_summary.pending_my_approval, 0);
    assert.equal(model.approvals_summary.pending_over_24h, 0);
    assert.equal(model.approvals_summary.pending_over_48h, 0);
    assert.equal(model.overview.total_projects, 0);
    assert.equal(model.kpis.length, 6);
    assert.ok(model.kpis.every((kpi) => kpi.value === 0));
    assert.ok(model.department_comparison.every((row) => row.total_projects === 0));
  }
});

test("queryProjectSupplements omits optional workflow snapshots when the table is not migrated", async () => {
  const queries = [];
  const missingSnapshotError = new Error('relation "design.workflow_completion_snapshots" does not exist');
  missingSnapshotError.code = "42P01";
  missingSnapshotError.relation = "workflow_completion_snapshots";

  const client = {
    async query(sql, params) {
      queries.push({ sql, params });

      if (sql.includes("workflow_completion_snapshots")) {
        throw missingSnapshotError;
      }

      return {
        rows: [{
          project_id: "project-1",
          last_snapshot_at: null,
          last_fixture_at: "2026-07-10T00:00:00.000Z",
        }],
      };
    },
  };

  const supplements = await queryProjectSupplements(["project-1"], client);

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /workflow_completion_snapshots/);
  assert.doesNotMatch(queries[1].sql, /workflow_completion_snapshots/);
  assert.doesNotMatch(queries[0].sql, /\bp\.rework_date\b/);
  assert.doesNotMatch(queries[1].sql, /\bp\.rework_date\b/);
  assert.equal(supplements.get("project-1").last_snapshot_at, null);
});

test("queryCompletionEvents omits optional workflow snapshots when the table is not migrated", async () => {
  const queries = [];
  const missingSnapshotError = new Error('relation "design.workflow_completion_snapshots" does not exist');
  missingSnapshotError.code = "42P01";
  missingSnapshotError.relation = "workflow_completion_snapshots";

  const client = {
    async query(sql, params) {
      queries.push({ sql, params });

      if (sql.includes("workflow_completion_snapshots")) {
        throw missingSnapshotError;
      }

      return {
        rows: [{ project_id: "project-1", event_at: "2026-07-10T00:00:00.000Z" }],
      };
    },
  };

  const events = await queryCompletionEvents(["project-1"], client);

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /workflow_completion_snapshots/);
  assert.doesNotMatch(queries[1].sql, /workflow_completion_snapshots/);
  assert.equal(events.get("project-1")[0].toISOString(), "2026-07-10T00:00:00.000Z");
});

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

