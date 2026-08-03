const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");

function actor(overrides = {}) {
  return {
    employee_id: "LEAD-1",
    department_id: "design",
    permissions: [PERMISSIONS.APPROVE_COMPLETED_TASK],
    role: { id: "team_leader", name: "Team Leader", hierarchy_level: 2, permissions: {} },
    is_active: true,
    ...overrides,
  };
}

function pendingTask(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    task_type: "custom",
    status: "under_review",
    verification_status: "pending",
    approval_stage: "manager",
    requires_quality_approval: false,
    department_id: "design",
    assigned_to: `EMP-${id}`,
    assignee_ids: [`EMP-${id}`],
    started_at: "2026-08-01T08:00:00.000Z",
    completed_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function installBulkApprovalMocks({ tasks, failOnUpdateIds = [], queueIds = null }) {
  const db = require("../db");
  const taskRepository = require("../repositories/tasksRepository");
  const auditRepository = require("../repositories/auditRepository");
  const performanceAnalytics = require("../services/performanceAnalyticsService");
  const state = new Map(tasks.map((task) => [Number(task.id), clone(task)]));
  const failOnUpdate = new Set(failOnUpdateIds.map(Number));
  const queryLog = [];
  const activityLog = [];
  const auditLog = [];
  const analyticsRefreshes = [];
  const client = {
    query: async (query, params = []) => {
      const sql = String(query).replace(/\s+/g, " ").trim();
      queryLog.push(sql);
      if (sql.startsWith("SELECT id FROM tasks WHERE id")) {
        const id = Number(params[0]);
        return { rows: state.has(id) ? [{ id }] : [], rowCount: state.has(id) ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };

  const originals = {
    connect: db.pool.connect,
    listVerificationTasksByAccess: taskRepository.listVerificationTasksByAccess,
    findTaskById: taskRepository.findTaskById,
    updateTaskVerification: taskRepository.updateTaskVerification,
    appendTaskActivity: taskRepository.appendTaskActivity,
    createAuditLog: auditRepository.createAuditLog,
    refreshPerformanceAnalyticsForDepartment: performanceAnalytics.refreshPerformanceAnalyticsForDepartment,
  };

  db.pool.connect = async () => client;
  taskRepository.listVerificationTasksByAccess = async () => {
    const rows = queueIds
      ? queueIds.map((id) => state.get(Number(id))).filter(Boolean)
      : [...state.values()].filter((task) => task.status === "under_review" && task.verification_status === "pending");
    return rows.map(clone);
  };
  taskRepository.findTaskById = async (taskId) => clone(state.get(Number(taskId)) || null);
  taskRepository.updateTaskVerification = async (taskId, values) => {
    const id = Number(taskId);
    if (failOnUpdate.has(id)) {
      throw new Error(`Approval failed for task ${id}`);
    }
    const task = state.get(id);
    Object.assign(task, {
      status: values.status,
      verification_status: values.verification_status,
      approval_stage: values.approval_stage,
      approved_at: values.approved_at,
      approved_by: values.approved_by,
      closed_at: values.closed_at,
      remarks: values.remarks,
      completion_percent: values.status === "closed" ? 100 : task.completion_percent,
    });
  };
  taskRepository.appendTaskActivity = async (taskId, payload) => {
    activityLog.push({ taskId, ...payload });
  };
  auditRepository.createAuditLog = async (payload) => {
    auditLog.push(payload);
  };
  performanceAnalytics.refreshPerformanceAnalyticsForDepartment = async (departmentId) => {
    analyticsRefreshes.push(departmentId);
  };

  delete require.cache[require.resolve("../services/taskService")];
  const service = require("../services/taskService");

  return {
    service,
    state,
    queryLog,
    activityLog,
    auditLog,
    analyticsRefreshes,
    restore() {
      db.pool.connect = originals.connect;
      taskRepository.listVerificationTasksByAccess = originals.listVerificationTasksByAccess;
      taskRepository.findTaskById = originals.findTaskById;
      taskRepository.updateTaskVerification = originals.updateTaskVerification;
      taskRepository.appendTaskActivity = originals.appendTaskActivity;
      auditRepository.createAuditLog = originals.createAuditLog;
      performanceAnalytics.refreshPerformanceAnalyticsForDepartment = originals.refreshPerformanceAnalyticsForDepartment;
      delete require.cache[require.resolve("../services/taskService")];
    },
  };
}

test("bulk approval approves all eligible pending tasks in one transaction", async () => {
  const mocks = installBulkApprovalMocks({ tasks: [pendingTask(1), pendingTask(2)] });
  try {
    const result = await mocks.service.approvePendingTasksForUser(actor(), { task_ids: [1, 2] });

    assert.equal(result.requested_count, 2);
    assert.equal(result.eligible_count, 2);
    assert.equal(result.approved_count, 2);
    assert.equal(result.failed_count, 0);
    assert.deepEqual(result.approved_task_ids, [1, 2]);
    assert.equal(mocks.state.get(1).verification_status, "approved");
    assert.equal(mocks.state.get(2).verification_status, "approved");
    assert.equal(mocks.activityLog.length, 2);
    assert.equal(mocks.auditLog.length, 2);
    assert.equal(mocks.queryLog.filter((sql) => sql === "SAVEPOINT approve_all_task").length, 2);
    assert.equal(mocks.queryLog.includes("BEGIN"), true);
    assert.equal(mocks.queryLog.includes("COMMIT"), true);
  } finally {
    mocks.restore();
  }
});

test("bulk approval commits successes and leaves failed items pending", async () => {
  const mocks = installBulkApprovalMocks({ tasks: [pendingTask(1), pendingTask(2)], failOnUpdateIds: [2] });
  try {
    const result = await mocks.service.approvePendingTasksForUser(actor(), { task_ids: [1, 2] });

    assert.equal(result.approved_count, 1);
    assert.equal(result.failed_count, 1);
    assert.equal(mocks.state.get(1).verification_status, "approved");
    assert.equal(mocks.state.get(2).verification_status, "pending");
    assert.match(result.results.find((item) => item.task_id === 2).message, /Approval failed/);
    assert.equal(mocks.queryLog.includes("ROLLBACK TO SAVEPOINT approve_all_task"), true);
    assert.equal(mocks.queryLog.includes("COMMIT"), true);
  } finally {
    mocks.restore();
  }
});

test("bulk approval reports unauthorized requested items without approving them", async () => {
  const mocks = installBulkApprovalMocks({ tasks: [pendingTask(1), pendingTask(2)], queueIds: [1] });
  try {
    const result = await mocks.service.approvePendingTasksForUser(actor(), { task_ids: [1, 2] });

    assert.equal(result.requested_count, 2);
    assert.equal(result.eligible_count, 1);
    assert.equal(result.approved_count, 1);
    assert.equal(result.failed_count, 1);
    assert.equal(result.results.find((item) => item.task_id === 2).eligible, false);
    assert.equal(mocks.state.get(1).verification_status, "approved");
    assert.equal(mocks.state.get(2).verification_status, "pending");
  } finally {
    mocks.restore();
  }
});

test("bulk approval returns an empty summary for an empty pending list", async () => {
  const mocks = installBulkApprovalMocks({ tasks: [] });
  try {
    const result = await mocks.service.approvePendingTasksForUser(actor(), { task_ids: [] });

    assert.deepEqual(result, {
      requested_count: 0,
      eligible_count: 0,
      approved_count: 0,
      failed_count: 0,
      skipped_count: 0,
      approved_task_ids: [],
      results: [],
    });
    assert.deepEqual(mocks.queryLog, []);
  } finally {
    mocks.restore();
  }
});
