const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  filterCurrentUserOverdueTasks,
  filterTeamOverdueTasks,
  isTaskOverdue,
} = require("../services/overdueNotificationService");
const {
  ensureOverdueNotificationsForTasks,
} = require("../repositories/taskNotificationRepository");

const now = new Date("2026-07-08T10:00:00.000Z");

function task(overrides = {}) {
  return {
    id: 1,
    title: "Concept",
    status: "in_progress",
    lifecycle_status: "in_progress",
    verification_status: "pending",
    deadline: "2026-07-08T09:00:00.000Z",
    submitted_at: null,
    approved_at: null,
    assigned_to: "EMP-1",
    assigned_user_id: "EMP-1",
    assignee_ids: ["EMP-1"],
    project_status: "active",
    project_no: "PARC-001",
    project_name: "Fixture Build",
    workflow_stage: "Concept",
    assignee: { employee_id: "EMP-1", name: "Asha" },
    ...overrides,
  };
}

function createNotificationClient() {
  const rows = [];

  return {
    rows,
    async query(sql, params) {
      if (/SELECT \*/i.test(sql) && /FROM task_notifications/i.test(sql)) {
        const [taskIds, recipientUserId, notificationType] = params;
        return {
          rows: rows
            .filter((row) => taskIds.includes(row.task_id)
              && row.recipient_user_id === recipientUserId
              && row.notification_type === notificationType)
            .sort((left, right) => right.created_at.localeCompare(left.created_at)),
        };
      }

      if (/UPDATE task_notifications/i.test(sql)) {
        const [id, title, message, severity, triggeredAt] = params;
        const row = rows.find((candidate) => candidate.id === id);
        Object.assign(row, {
          title,
          message,
          severity,
          triggered_at: triggeredAt.toISOString(),
          updated_at: triggeredAt.toISOString(),
        });
        return { rows: [row] };
      }

      if (/INSERT INTO task_notifications/i.test(sql)) {
        const [taskId, projectId, recipientUserId, notificationType, title, message, severity, triggeredAt] = params;
        const row = {
          id: `notification-${rows.length + 1}`,
          task_id: taskId,
          project_id: projectId,
          recipient_user_id: recipientUserId,
          notification_type: notificationType,
          title,
          message,
          severity,
          status: "unread",
          triggered_at: triggeredAt.toISOString(),
          acknowledged_at: null,
          created_at: triggeredAt.toISOString(),
          updated_at: triggeredAt.toISOString(),
        };
        rows.push(row);
        return { rows: [row] };
      }

      throw new Error(`Unexpected SQL in fake client: ${sql}`);
    },
  };
}

test("overdue task detection requires an assigned active task past deadline", () => {
  assert.equal(isTaskOverdue(task(), now), true);
  assert.equal(isTaskOverdue(task({ assigned_to: null, assigned_user_id: null, assignee_ids: [], assignee: null }), now), false);
  assert.equal(isTaskOverdue(task({ deadline: "2026-07-08T11:00:00.000Z" }), now), false);
});

test("completed, approved, released, and cancelled tasks do not appear overdue", () => {
  assert.equal(isTaskOverdue(task({ status: "closed" }), now), false);
  assert.equal(isTaskOverdue(task({ status: "completed" }), now), false);
  assert.equal(isTaskOverdue(task({ verification_status: "approved" }), now), false);
  assert.equal(isTaskOverdue(task({ project_status: "released" }), now), false);
  assert.equal(isTaskOverdue(task({ status: "cancelled" }), now), false);
});

test("task submitted for approval before deadline is not overdue while waiting for approval", () => {
  const submittedBeforeDeadline = task({
    status: "under_review",
    submitted_at: "2026-07-08T08:55:00.000Z",
  });
  const submittedAfterDeadline = task({
    status: "under_review",
    submitted_at: "2026-07-08T09:05:00.000Z",
  });

  assert.equal(isTaskOverdue(submittedBeforeDeadline, now), false);
  assert.equal(isTaskOverdue(submittedAfterDeadline, now), true);
});

test("current user overdue filtering returns only tasks assigned to that user", () => {
  const user = { employee_id: "EMP-1" };
  const ownTask = task({ id: 1, assigned_to: "EMP-1", assigned_user_id: "EMP-1", assignee_ids: ["EMP-1"] });
  const otherTask = task({ id: 2, assigned_to: "EMP-2", assigned_user_id: "EMP-2", assignee_ids: ["EMP-2"], assignee: { employee_id: "EMP-2", name: "Bala" } });

  assert.deepEqual(filterCurrentUserOverdueTasks([ownTask, otherTask], user, now).map((item) => item.id), [1]);
});

test("team overdue filtering returns scoped team tasks and excludes self and unrelated users", () => {
  const leader = { employee_id: "LEAD-1" };
  const ownTask = task({ id: 1, assigned_to: "LEAD-1", assigned_user_id: "LEAD-1", assignee_ids: ["LEAD-1"] });
  const teamTask = task({ id: 2, assigned_to: "EMP-2", assigned_user_id: "EMP-2", assignee_ids: ["EMP-2"], assignee: { employee_id: "EMP-2", name: "Bala" } });
  const unrelatedTask = task({ id: 3, assigned_to: "EMP-9", assigned_user_id: "EMP-9", assignee_ids: ["EMP-9"], assignee: { employee_id: "EMP-9", name: "Chandra" } });

  assert.deepEqual(filterTeamOverdueTasks([ownTask, teamTask, unrelatedTask], leader, now, ["EMP-2"]).map((item) => item.id), [2]);
});

test("duplicate active overdue notifications are not created repeatedly", async () => {
  const client = createNotificationClient();
  const overdueTask = task({ id: 42 });

  const first = await ensureOverdueNotificationsForTasks([overdueTask], {
    recipientUserId: "EMP-1",
    notificationType: "OVERDUE_TASK",
    now,
  }, client);
  const second = await ensureOverdueNotificationsForTasks([overdueTask], {
    recipientUserId: "EMP-1",
    notificationType: "OVERDUE_TASK",
    now,
  }, client);

  assert.equal(client.rows.length, 1);
  assert.equal(first.get(42).id, "notification-1");
  assert.equal(second.get(42).id, "notification-1");
});