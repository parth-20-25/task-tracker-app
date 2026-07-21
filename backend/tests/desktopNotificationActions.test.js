const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

function user(overrides = {}) {
  return {
    employee_id: "940",
    is_active: true,
    role: {
      id: "r7",
      permissions: {
        can_edit_task: true,
        can_view_self_tasks: true,
      },
    },
    ...overrides,
  };
}

function taskRow(overrides = {}) {
  return {
    id: 607,
    status: "assigned",
    verification_status: "pending",
    assigned_to: "940",
    assigned_user_id: "940",
    assignee_ids: [],
    approved_at: null,
    ...overrides,
  };
}

function device(overrides = {}) {
  return {
    device_id: "11111111-1111-4111-8111-111111111111",
    user_id: "940",
    ...overrides,
  };
}

function loadServiceWithMocks({ task = taskRow(), boundUser = user(), updateImpl } = {}) {
  const tasksRepository = require("../repositories/tasksRepository");
  const usersRepository = require("../repositories/usersRepository");
  const taskService = require("../services/taskService");
  const originals = {
    findTaskById: tasksRepository.findTaskById,
    findUserByEmployeeId: usersRepository.findUserByEmployeeId,
    updateTaskForUser: taskService.updateTaskForUser,
  };
  const calls = {
    taskIds: [],
    userIds: [],
    updates: [],
  };

  tasksRepository.findTaskById = async (taskId) => {
    calls.taskIds.push(taskId);
    return task ? { ...task, id: taskId } : null;
  };
  usersRepository.findUserByEmployeeId = async (employeeId) => {
    calls.userIds.push(employeeId);
    return boundUser;
  };
  taskService.updateTaskForUser = async (...args) => {
    calls.updates.push(args);
    if (updateImpl) return updateImpl(...args);
    return { ...task, id: Number(args[1]), status: "in_progress", verification_status: "pending" };
  };

  delete require.cache[require.resolve("../services/desktopNotificationActionService")];
  const service = require("../services/desktopNotificationActionService");

  return {
    calls,
    service,
    restore() {
      tasksRepository.findTaskById = originals.findTaskById;
      usersRepository.findUserByEmployeeId = originals.findUserByEmployeeId;
      taskService.updateTaskForUser = originals.updateTaskForUser;
      delete require.cache[require.resolve("../services/desktopNotificationActionService")];
    },
  };
}

test("valid registered assignee can start a task through existing task service", async () => {
  const mocks = loadServiceWithMocks();
  try {
    const result = await mocks.service.startTaskFromDesktopNotification(device(), "607");

    assert.deepEqual(result, {
      success: true,
      taskId: 607,
      status: "in_progress",
      message: "Task started successfully.",
    });
    assert.equal(mocks.calls.userIds[0], "940");
    assert.equal(mocks.calls.updates.length, 1);
    assert.equal(mocks.calls.updates[0][0].employee_id, "940");
    assert.equal(mocks.calls.updates[0][2].action, "start");
    assert.equal(mocks.calls.updates[0][3].auditMetadata.source, "desktop_notification_agent");
    assert.equal(mocks.calls.updates[0][3].auditMetadata.device_id, device().device_id);
  } finally {
    mocks.restore();
  }
});

test("request body cannot select the acting user because action uses the device-bound user", async () => {
  const mocks = loadServiceWithMocks({ boundUser: user({ employee_id: "940" }) });
  try {
    await mocks.service.startTaskFromDesktopNotification(device({ user_id: "940" }), "607");
    assert.equal(mocks.calls.updates[0][0].employee_id, "940");
  } finally {
    mocks.restore();
  }
});

test("wrong or reassigned user cannot start the old popup task", async () => {
  const mocks = loadServiceWithMocks({ task: taskRow({ assigned_to: "941", assigned_user_id: "941" }) });
  try {
    await assert.rejects(
      () => mocks.service.startTaskFromDesktopNotification(device(), "607"),
      /This task is no longer assigned to you\./,
    );
    assert.equal(mocks.calls.updates.length, 0);
  } finally {
    mocks.restore();
  }
});

test("completed and cancelled tasks cannot be started", async () => {
  for (const terminalTask of [
    taskRow({ status: "closed", approved_at: new Date().toISOString() }),
    taskRow({ status: "cancelled" }),
  ]) {
    const mocks = loadServiceWithMocks({ task: terminalTask });
    try {
      await assert.rejects(
        () => mocks.service.startTaskFromDesktopNotification(device(), "607"),
        /This task cannot be started from its current status\./,
      );
      assert.equal(mocks.calls.updates.length, 0);
    } finally {
      mocks.restore();
    }
  }
});

test("duplicate start request is harmless and does not create another transition", async () => {
  const mocks = loadServiceWithMocks({
    task: taskRow({ status: "in_progress", started_at: new Date().toISOString() }),
    updateImpl: () => { throw new Error("duplicate start should not update"); },
  });
  try {
    const result = await mocks.service.startTaskFromDesktopNotification(device(), "607");

    assert.equal(result.success, true);
    assert.equal(result.status, "in_progress");
    assert.equal(mocks.calls.updates.length, 0);
  } finally {
    mocks.restore();
  }
});

test("rejected task starts correction through the resume workflow", async () => {
  const mocks = loadServiceWithMocks({
    task: taskRow({ status: "rework", verification_status: "rejected", rejection_count: 1 }),
  });
  try {
    const result = await mocks.service.startCorrectionFromDesktopNotification(device(), "607");

    assert.equal(result.success, true);
    assert.equal(result.status, "in_progress");
    assert.equal(mocks.calls.updates.length, 1);
    assert.equal(mocks.calls.updates[0][2].action, "resume");
  } finally {
    mocks.restore();
  }
});

test("correction action rejects tasks that are not waiting for correction", async () => {
  const mocks = loadServiceWithMocks({ task: taskRow({ status: "assigned", verification_status: "pending" }) });
  try {
    await assert.rejects(
      () => mocks.service.startCorrectionFromDesktopNotification(device(), "607"),
      /This task is not waiting for correction\./,
    );
    assert.equal(mocks.calls.updates.length, 0);
  } finally {
    mocks.restore();
  }
});