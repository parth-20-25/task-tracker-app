const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const projectId = "11111111-1111-4111-8111-111111111119";
const releaseTimestamp = "2026-07-18T16:35:00+05:30";

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function outboxRow(overrides = {}) {
  return {
    id: 42,
    event_type: "PROJECT_RELEASED",
    entity_type: "project",
    entity_id: projectId,
    actor_user_id: "501",
    payload_json: { released_at: releaseTimestamp },
    dedupe_key: `project-released:${projectId}:${releaseTimestamp}`,
    ...overrides,
  };
}

function loadDesktopServiceWithRepositoryMocks({ recipients = [{ employee_id: "940", name: "Executive" }] } = {}) {
  const repository = require("../repositories/desktopNotificationRepository");
  const originals = {
    getProjectReleasedNotificationContext: repository.getProjectReleasedNotificationContext,
    listUsersWithPermission: repository.listUsersWithPermission,
    createDesktopNotification: repository.createDesktopNotification,
    notifyDesktopNotification: repository.notifyDesktopNotification,
  };
  const calls = { permissionIds: [], notifications: [], notified: [] };

  repository.getProjectReleasedNotificationContext = async () => ({
    project_id: projectId,
    project_no: "25-119",
    project_name: "Project Name",
    customer_name: "Customer Name",
    released_by_name: "Employee Name",
    released_at: releaseTimestamp,
  });
  repository.listUsersWithPermission = async (permissionId) => {
    calls.permissionIds.push(permissionId);
    return recipients;
  };
  repository.createDesktopNotification = async (values) => {
    calls.notifications.push(values);
    return { id: 1900 + calls.notifications.length, ...values };
  };
  repository.notifyDesktopNotification = async (notification) => {
    calls.notified.push(notification);
  };

  clearModule("../services/desktopNotificationService");
  const service = require("../services/desktopNotificationService");

  return {
    calls,
    service,
    restore() {
      repository.getProjectReleasedNotificationContext = originals.getProjectReleasedNotificationContext;
      repository.listUsersWithPermission = originals.listUsersWithPermission;
      repository.createDesktopNotification = originals.createDesktopNotification;
      repository.notifyDesktopNotification = originals.notifyDesktopNotification;
      clearModule("../services/desktopNotificationService");
    },
  };
}

function loadBatchServiceWithMocks({ readyImpl, releaseImpl } = {}) {
  const db = require("../db");
  const batchRepository = require("../repositories/batchRepository");
  const accessControl = require("../services/accessControlService");
  const design2d = require("../services/design2dCompletionTaskService");
  const desktop = require("../services/desktopNotificationService");
  const audit = require("../repositories/auditRepository");
  const originals = {
    connect: db.pool.connect,
    getBatchByIdForUser: batchRepository.getBatchByIdForUser,
    requireOwningLeaderPair: accessControl.requireOwningLeaderPair,
    assertDesign2DCompletionProjectReady: design2d.assertDesign2DCompletionProjectReady,
    releaseProject: batchRepository.releaseProject,
    enqueueProjectReleasedOutbox: desktop.enqueueProjectReleasedOutbox,
    createAuditLog: audit.createAuditLog,
  };
  const calls = { tx: [], sequence: [], outbox: [], audits: [] };
  const client = {
    query: async (sql) => {
      calls.tx.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => calls.tx.push("RELEASE_CLIENT"),
  };

  db.pool.connect = async () => client;
  batchRepository.getBatchByIdForUser = async () => ({
    project_id: projectId,
    batch_id: "batch-1",
    project_no: "25-119",
    project_status: "active",
  });
  accessControl.requireOwningLeaderPair = async () => calls.sequence.push("authorize");
  design2d.assertDesign2DCompletionProjectReady = readyImpl || (async () => calls.sequence.push("ready"));
  batchRepository.releaseProject = releaseImpl || (async () => {
    calls.sequence.push("release");
    return { status_changed_at: releaseTimestamp, completed_at: releaseTimestamp };
  });
  desktop.enqueueProjectReleasedOutbox = async (event, txClient) => {
    calls.sequence.push("outbox");
    calls.outbox.push({ event, txClient });
    return event;
  };
  audit.createAuditLog = async (entry) => {
    calls.audits.push(entry);
  };

  clearModule("../services/batchService");
  const service = require("../services/batchService");

  return {
    calls,
    client,
    service,
    restore() {
      db.pool.connect = originals.connect;
      batchRepository.getBatchByIdForUser = originals.getBatchByIdForUser;
      accessControl.requireOwningLeaderPair = originals.requireOwningLeaderPair;
      design2d.assertDesign2DCompletionProjectReady = originals.assertDesign2DCompletionProjectReady;
      batchRepository.releaseProject = originals.releaseProject;
      desktop.enqueueProjectReleasedOutbox = originals.enqueueProjectReleasedOutbox;
      audit.createAuditLog = originals.createAuditLog;
      clearModule("../services/batchService");
    },
  };
}

test("successful project release creates PROJECT_RELEASED outbox inside the release transaction", async () => {
  const mocks = loadBatchServiceWithMocks();
  try {
    const result = await mocks.service.releaseProjectForBatch({ employee_id: "501" }, "batch-1");

    assert.equal(result.status, "completed");
    assert.deepEqual(mocks.calls.sequence, ["authorize", "ready", "release", "outbox"]);
    assert.deepEqual(mocks.calls.tx.slice(0, 2), ["BEGIN", "COMMIT"]);
    assert.equal(mocks.calls.outbox.length, 1);
    assert.equal(mocks.calls.outbox[0].txClient, mocks.client);
    assert.deepEqual(mocks.calls.outbox[0].event, {
      projectId,
      actorUserId: "501",
      releasedAt: releaseTimestamp,
    });
  } finally {
    mocks.restore();
  }
});

test("failed project release rolls back and creates no outbox event", async () => {
  const mocks = loadBatchServiceWithMocks({
    readyImpl: async () => { throw new Error("not ready"); },
  });
  try {
    await assert.rejects(() => mocks.service.releaseProjectForBatch({ employee_id: "501" }, "batch-1"), /not ready/);
    assert.equal(mocks.calls.outbox.length, 0);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
  } finally {
    mocks.restore();
  }
});

test("PROJECT_RELEASED outbox and notification use stable dedupe keys", () => {
  const { buildProjectReleasedNotification, buildProjectReleasedOutboxEvent } = require("../services/desktopNotificationService");
  const event = buildProjectReleasedOutboxEvent({ projectId, actorUserId: "501", releasedAt: releaseTimestamp });
  const notification = buildProjectReleasedNotification({
    project_id: projectId,
    project_no: "25-119",
    project_name: "Project Name",
    customer_name: "Customer Name",
    released_by_name: "Employee Name",
  }, "940", outboxRow());

  assert.equal(event.eventType, "PROJECT_RELEASED");
  assert.equal(event.dedupeKey, `project-released:${projectId}:${releaseTimestamp}`);
  assert.equal(notification.dedupeKey, `project-released:${projectId}:${releaseTimestamp}:940`);
  assert.deepEqual(notification.payload.availableActions, ["OPEN_PROJECT", "VIEW_AUDIT"]);
  assert.equal(notification.deepLink, `/?project_id=${projectId}`);
  assert.equal(notification.payload.auditDeepLink, `/admin/audit?entity=project&id=${projectId}`);
});

test("executive project release notifications go only to users resolved by the dedicated permission", async () => {
  const { PERMISSIONS } = require("../config/constants");
  const mocks = loadDesktopServiceWithRepositoryMocks({ recipients: [{ employee_id: "940" }] });
  try {
    await mocks.service.processProjectReleasedOutbox(outboxRow(), {});

    assert.deepEqual(mocks.calls.permissionIds, [PERMISSIONS.RECEIVE_EXECUTIVE_DESKTOP_NOTIFICATIONS]);
    assert.equal(mocks.calls.notifications.length, 1);
    assert.equal(mocks.calls.notifications[0].userId, "940");
    assert.equal(mocks.calls.notifications[0].eventType, "PROJECT_RELEASED");
    assert.equal(mocks.calls.notified.length, 1);
    assert.equal(mocks.calls.notified[0].userId, "940");
  } finally {
    mocks.restore();
  }
});

test("user without executive notification permission receives no project release notification", async () => {
  const mocks = loadDesktopServiceWithRepositoryMocks({ recipients: [] });
  try {
    await mocks.service.processProjectReleasedOutbox(outboxRow(), {});
    assert.equal(mocks.calls.notifications.length, 0);
    assert.equal(mocks.calls.notified.length, 0);
  } finally {
    mocks.restore();
  }
});

test("desktop notification repository dedupes records and targets only active non-revoked devices", async () => {
  const repository = require("../repositories/desktopNotificationRepository");
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (String(sql).includes("INSERT INTO desktop_notifications")) {
        return {
          rows: [{
            id: 1901,
            user_id: "940",
            event_type: "PROJECT_RELEASED",
            entity_type: "project",
            entity_id: projectId,
            title: "Project released",
            body: "Project: 25-119",
            deep_link: `/projects/${projectId}`,
            payload_json: {},
            priority: "high",
            created_at: releaseTimestamp,
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  await repository.createDesktopNotification({
    userId: "940",
    eventType: "PROJECT_RELEASED",
    entityType: "project",
    entityId: projectId,
    title: "Project released",
    body: "Project: 25-119",
    deepLink: `/projects/${projectId}`,
    priority: "high",
    dedupeKey: `project-released:${projectId}:${releaseTimestamp}:940`,
  }, client);

  const notificationSql = queries.find((query) => String(query.sql).includes("INSERT INTO desktop_notifications"))?.sql || "";
  const deliverySql = queries.find((query) => String(query.sql).includes("FROM desktop_notification_devices"))?.sql || "";
  assert.match(notificationSql, /ON CONFLICT \(dedupe_key\) DO UPDATE/);
  assert.match(deliverySql, /enabled = TRUE/);
  assert.match(deliverySql, /revoked_at IS NULL/);
});

test("executive recipient resolver uses permission tables and not admin role broadcast", async () => {
  const { PERMISSIONS } = require("../config/constants");
  const repository = require("../repositories/desktopNotificationRepository");
  let capturedSql = "";
  const client = {
    query: async (sql) => {
      capturedSql = String(sql);
      return { rows: [] };
    },
  };

  await repository.listUsersWithPermission(PERMISSIONS.RECEIVE_EXECUTIVE_DESKTOP_NOTIFICATIONS, client);
  assert.match(capturedSql, /role_permissions/);
  assert.match(capturedSql, /permissions ->>/);
  assert.doesNotMatch(capturedSql, /is_admin|admin/i);
});

test("Open Project and View Audit deep links accept only internal application paths", () => {
  const { validateDeepLinkPath } = require("../services/desktopNotificationService");

  assert.equal(validateDeepLinkPath(`/?project_id=${projectId}`), true);
  assert.equal(validateDeepLinkPath(`/admin/audit?entity=project&id=${encodeURIComponent(projectId)}`), true);
  assert.equal(validateDeepLinkPath("https://example.com/projects/119"), false);
  assert.equal(validateDeepLinkPath("//example.com/audit"), false);
});
