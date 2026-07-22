const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const {
  buildActiveTaskReminderNotification,
  buildActiveTaskSyncPayload,
  buildTaskAssignedOutboxEvent,
  hashDeviceToken,
  isDesktopActiveTaskForUser,
  safeTokenEqual,
  validateDeepLinkPath,
} = require("../services/desktopNotificationService");

test("TASK_ASSIGNED outbox event uses the current task assignee and a stable dedupe key", () => {
  const task = { id: 607, assigned_user_id: "940", assigned_to: "941" };
  const event = buildTaskAssignedOutboxEvent(task, "100");

  assert.equal(event.eventType, "TASK_ASSIGNED");
  assert.equal(event.entityType, "task");
  assert.equal(event.entityId, "607");
  assert.equal(event.actorUserId, "100");
  assert.deepEqual(event.payload, { task_id: 607 });
  assert.equal(event.dedupeKey, "task-assigned:607:940");
});

test("duplicate assignment attempts generate the same TASK_ASSIGNED dedupe key", () => {
  const task = { id: 607, assigned_user_id: "940" };
  assert.equal(
    buildTaskAssignedOutboxEvent(task, "100").dedupeKey,
    buildTaskAssignedOutboxEvent(task, "100").dedupeKey,
  );
});

test("desktop device tokens are hashed and compared without storing the raw token", () => {
  const token = "secret-device-token";
  const hash = hashDeviceToken(token);

  assert.notEqual(hash, token);
  assert.equal(safeTokenEqual(hash, token), true);
  assert.equal(safeTokenEqual(hash, "wrong-token"), false);
});

test("desktop notification deep links allow only internal application paths", () => {
  assert.equal(validateDeepLinkPath("/tasks/607"), true);
  assert.equal(validateDeepLinkPath("javascript:alert(1)"), false);
  assert.equal(validateDeepLinkPath("https://example.com/tasks/607"), false);
  assert.equal(validateDeepLinkPath("//example.com/tasks/607"), false);
  assert.equal(validateDeepLinkPath("\\\\server\\share"), false);
});
test("active task reminder only includes actionable tasks assigned to the authenticated employee", () => {
  const now = new Date("2026-07-22T08:00:00.000Z");
  const tasks = [
    { id: 10, title: "Drafting", status: "assigned", verification_status: "pending", assigned_user_id: "940", project_no: "25-119", fixture_no: "OP20", due_date: "2026-07-21T00:00:00.000Z" },
    { id: 11, title: "Correction", status: "rework", verification_status: "rejected", assignee_ids: ["940"], project_no: "25-119" },
    { id: 12, title: "Other employee", status: "assigned", assigned_user_id: "941" },
    { id: 13, title: "Approved", status: "under_review", verification_status: "approved", assigned_user_id: "940" },
    { id: 14, title: "Cancelled", status: "cancelled", assigned_user_id: "940" },
  ];

  const reminder = buildActiveTaskReminderNotification({ employee_id: "940" }, tasks, { now });

  assert.equal(reminder.eventType, "ACTIVE_TASK_REMINDER");
  assert.equal(reminder.entityType, "local");
  assert.equal(reminder.taskCount, 2);
  assert.equal(reminder.deepLink, "/tasks?status=active");
  assert.deepEqual(reminder.availableActions, ["OPEN_TASKS"]);
  assert.deepEqual(reminder.taskItems, ["Drafting - 25-119 - OP20", "Correction - 25-119"]);
  assert.match(reminder.statusMessage, /1 overdue task/);
  assert.equal(isDesktopActiveTaskForUser(tasks[2], "940"), false);
  assert.equal(isDesktopActiveTaskForUser(tasks[3], "940"), false);
});

test("active task sync exposes authenticated identity and all actionable task sources", () => {
  const now = new Date("2026-07-22T08:00:00.000Z");
  const tasks = [
    { id: 1, title: "Normal", task_type: "custom", status: "assigned", assigned_to: "940" },
    { id: 2, title: "2D additional", task_type: "additional_design", design_team: "2D", status: "in_progress", assigned_to: "940" },
    { id: 3, title: "2D completion", task_type: "design_2d_completion", status: "on_hold", assigned_to: "940" },
    { id: 4, title: "3D additional", task_type: "additional_design", design_team: "3D", status: "rework", assigned_to: "940" },
    { id: 5, title: "3D completion", task_type: "design_3d_completion", status: "update_required", assigned_to: "940" },
    { id: 6, title: "Approved", status: "under_review", verification_status: "approved", assigned_to: "940" },
  ];

  const sync = buildActiveTaskSyncPayload(
    { id: "40ba3678-b3ae-4f88-bdf8-866705f164d1", employee_id: "940" },
    { device_id: "6fcb5e1a-2630-4ec6-a2e8-a8677a382290" },
    tasks,
    { now },
  );

  assert.equal(sync.employeeId, "940");
  assert.equal(sync.backendUserId, "40ba3678-b3ae-4f88-bdf8-866705f164d1");
  assert.equal(sync.deviceRegistered, true);
  assert.equal(sync.activeTaskCount, 5);
  assert.deepEqual(sync.tasks.map((task) => task.id), [1, 2, 3, 4, 5]);
  assert.equal(sync.notification.taskCount, 5);
});

test("single active task reminder opens the task route directly", () => {
  const reminder = buildActiveTaskReminderNotification({ employee_id: "940" }, [
    { id: 607, title: "Only task", status: "in_progress", assigned_to: "940" },
  ], { now: new Date("2026-07-22T08:00:00.000Z") });

  assert.equal(reminder.taskCount, 1);
  assert.equal(reminder.deepLink, "/tasks/607");
  assert.deepEqual(reminder.availableActions, ["OPEN_TASK"]);
});

test("active task reminder is skipped when the employee has no actionable tasks", () => {
  const reminder = buildActiveTaskReminderNotification({ employee_id: "940" }, [
    { id: 607, title: "Closed", status: "closed", assigned_to: "940" },
    { id: 608, title: "Wrong employee", status: "assigned", assigned_to: "941" },
  ]);

  assert.equal(reminder, null);
});
