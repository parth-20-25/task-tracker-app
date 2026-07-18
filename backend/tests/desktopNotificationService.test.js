const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const {
  buildTaskAssignedOutboxEvent,
  hashDeviceToken,
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
