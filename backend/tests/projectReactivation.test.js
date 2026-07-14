const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

function clearServiceCache() {
  delete require.cache[require.resolve("../services/batchService")];
}

function installReactivationMocks({ projectContext, reactivatedProject, auditSink = [], authorized = true }) {
  const db = require("../db");
  const batchRepository = require("../repositories/batchRepository");
  const auditRepository = require("../repositories/auditRepository");
  const accessControlService = require("../services/accessControlService");

  const originals = {
    connect: db.pool.connect,
    getProjectLifecycleContextByIdForUser: batchRepository.getProjectLifecycleContextByIdForUser,
    reactivateProjectForModification: batchRepository.reactivateProjectForModification,
    restoreProjectWorkflowForReactivation: batchRepository.restoreProjectWorkflowForReactivation,
    createAuditLog: auditRepository.createAuditLog,
    requireOwningLeaderPair: accessControlService.requireOwningLeaderPair,
  };

  const tx = [];
  const client = {
    query: async (sql) => {
      tx.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      tx.push("RELEASE");
    },
  };

  db.pool.connect = async () => client;
  batchRepository.getProjectLifecycleContextByIdForUser = async () => projectContext;
  batchRepository.reactivateProjectForModification = async (projectId, txClient) => {
    assert.equal(projectId, projectContext?.project_id);
    assert.equal(txClient, client);
    return reactivatedProject;
  };
  batchRepository.restoreProjectWorkflowForReactivation = async (projectId, txClient) => {
    assert.equal(projectId, projectContext?.project_id);
    assert.equal(txClient, client);
    return {
      snapshot_fixtures_restored: 1,
      snapshot_progress_rows_restored: 4,
      snapshot_tasks_restored: 1,
      activity_tasks_restored: 0,
      activity_progress_rows_restored: 0,
      activity_future_progress_rows_reset: 0,
      activity_fixtures_reopened: 0,
    };
  };
  accessControlService.requireOwningLeaderPair = async () => {
    if (!authorized) {
      const error = new Error("Only the owning Team Leader and linked Team Co-Leader may modify this project");
      error.statusCode = 403;
      throw error;
    }
  };
  auditRepository.createAuditLog = async (entry, txClient) => {
    assert.equal(txClient, client);
    auditSink.push(entry);
  };

  clearServiceCache();

  return {
    auditSink,
    tx,
    restore() {
      db.pool.connect = originals.connect;
      batchRepository.getProjectLifecycleContextByIdForUser = originals.getProjectLifecycleContextByIdForUser;
      batchRepository.reactivateProjectForModification = originals.reactivateProjectForModification;
      batchRepository.restoreProjectWorkflowForReactivation = originals.restoreProjectWorkflowForReactivation;
      auditRepository.createAuditLog = originals.createAuditLog;
      accessControlService.requireOwningLeaderPair = originals.requireOwningLeaderPair;
      clearServiceCache();
    },
  };
}

const managerUser = {
  employee_id: "MGR-1",
  department_id: "design",
  permissions: ["can_assign_tasks"],
  role: {
    id: "r3",
    name: "Team Leader",
    permissions: { can_assign_tasks: true },
  },
};

const employeeUser = {
  employee_id: "EMP-1",
  department_id: "design",
  permissions: ["can_view_self_tasks"],
  role: {
    id: "r6",
    name: "Employee",
    permissions: { can_view_self_tasks: true },
  },
};

const uploaderUser = {
  ...employeeUser,
  employee_id: "OWNER-1",
  role: { id: "co_leader", name: "Team Co-Leader", permissions: {} },
};

const releasedProject = {
  project_id: "project-1",
  batch_id: "batch-1",
  project_no: "PARC-001",
  project_created_by_user_id: "OWNER-1",
  department_id: "design",
  project_status: "completed",
  is_modified: false,
  completed_at: "2026-06-01T10:00:00.000Z",
};

test("reactivating a terminal project sets it active, marks modified, and records audit metadata", async () => {
  const mocks = installReactivationMocks({
    projectContext: releasedProject,
    reactivatedProject: {
      project_id: "project-1",
      project_status: "active",
      is_modified: true,
    },
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    const result = await reactivateProjectForModificationById(managerUser, "project-1", {
      reason: "drawing_update",
      comment: "Customer drawing rev B",
    });

    assert.equal(result.status, "active");
    assert.equal(result.previous_status, "completed");
    assert.equal(result.is_modified, true);
    assert.equal(result.reactivation_reason, "drawing_update");
    assert.deepEqual(result.workflow_restoration, {
      snapshot_fixtures_restored: 1,
      snapshot_progress_rows_restored: 4,
      snapshot_tasks_restored: 1,
      activity_tasks_restored: 0,
      activity_progress_rows_restored: 0,
      activity_future_progress_rows_reset: 0,
      activity_fixtures_reopened: 0,
    });
    assert.match(result.message, /reactivated/);

    assert.equal(mocks.auditSink.length, 1);
    assert.equal(mocks.auditSink[0].actionType, "PROJECT_REACTIVATED");
    assert.deepEqual(mocks.auditSink[0].metadata, {
      batch_id: "batch-1",
      project_no: "PARC-001",
      reactivated_by: "MGR-1",
      reactivated_at: mocks.auditSink[0].metadata.reactivated_at,
      reactivation_reason: "drawing_update",
      reactivation_reason_label: "Drawing update",
      reactivation_comment: "Customer drawing rev B",
      previous_status: "completed",
      next_status: "active",
      previous_is_modified: false,
      next_is_modified: true,
      preserved_completed_at: "2026-06-01T10:00:00.000Z",
      workflow_restoration: {
        snapshot_fixtures_restored: 1,
        snapshot_progress_rows_restored: 4,
        snapshot_tasks_restored: 1,
        activity_tasks_restored: 0,
        activity_progress_rows_restored: 0,
        activity_future_progress_rows_reset: 0,
        activity_fixtures_reopened: 0,
      },
    });
    assert.ok(Date.parse(mocks.auditSink[0].metadata.reactivated_at));
    assert.ok(mocks.tx.some((entry) => entry === "BEGIN"));
    assert.ok(mocks.tx.some((entry) => entry === "COMMIT"));
  } finally {
    mocks.restore();
  }
});

test("creator Co-Leader can reactivate without unrelated lifecycle permissions", async () => {
  const mocks = installReactivationMocks({
    projectContext: releasedProject,
    reactivatedProject: {
      project_id: "project-1",
      project_status: "active",
      is_modified: true,
    },
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    const result = await reactivateProjectForModificationById(uploaderUser, "project-1", { reason: "other" });

    assert.equal(result.status, "active");
    assert.equal(result.previous_status, "completed");
    assert.equal(mocks.auditSink.length, 1);
    assert.equal(mocks.auditSink[0].metadata.reactivated_by, "OWNER-1");
  } finally {
    mocks.restore();
  }
});

test("unrelated normal employees cannot reactivate somebody else's project", async () => {
  const mocks = installReactivationMocks({
    projectContext: releasedProject,
    reactivatedProject: null,
    authorized: false,
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    await assert.rejects(
      () => reactivateProjectForModificationById(employeeUser, "project-1", { reason: "other" }),
      /owning Team Leader/,
    );
    assert.equal(mocks.auditSink.length, 0);
    assert.equal(mocks.tx.length, 0);
  } finally {
    mocks.restore();
  }
});

test("on-hold projects can be reactivated through the project reactivation path", async () => {
  const mocks = installReactivationMocks({
    projectContext: {
      ...releasedProject,
      project_status: "on_hold",
      completed_at: null,
    },
    reactivatedProject: {
      project_id: "project-1",
      project_status: "active",
      is_modified: true,
    },
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    const result = await reactivateProjectForModificationById(managerUser, "project-1", {
      reason: "internal_modification",
    });

    assert.equal(result.status, "active");
    assert.equal(result.previous_status, "on_hold");
    assert.equal(result.is_modified, true);
    assert.equal(result.project.project_status, "active");
    assert.equal(mocks.auditSink.length, 1);
    assert.equal(mocks.auditSink[0].metadata.previous_status, "on_hold");
    assert.equal(mocks.auditSink[0].metadata.preserved_completed_at, null);
  } finally {
    mocks.restore();
  }
});

test("active projects can use the reactivation path without lifecycle blocker", async () => {
  const mocks = installReactivationMocks({
    projectContext: {
      ...releasedProject,
      project_status: "active",
      is_modified: true,
    },
    reactivatedProject: {
      project_id: "project-1",
      project_status: "active",
      is_modified: true,
    },
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    const result = await reactivateProjectForModificationById(managerUser, "project-1", { reason: "customer_modification" });

    assert.equal(result.status, "active");
    assert.equal(result.previous_status, "active");
    assert.equal(mocks.auditSink.length, 1);
  } finally {
    mocks.restore();
  }
});
test("authorized owner release preserves lifecycle transaction and audit behavior", async () => {
  const db = require("../db");
  const batchRepository = require("../repositories/batchRepository");
  const auditRepository = require("../repositories/auditRepository");
  const accessControlService = require("../services/accessControlService");
  const originals = {
    connect: db.pool.connect,
    getBatchByIdForUser: batchRepository.getBatchByIdForUser,
    releaseProject: batchRepository.releaseProject,
    createAuditLog: auditRepository.createAuditLog,
    requireOwningLeaderPair: accessControlService.requireOwningLeaderPair,
  };
  const tx = [];
  const audits = [];
  const client = {
    query: async (sql) => {
      tx.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release: () => tx.push("RELEASE"),
  };

  db.pool.connect = async () => client;
  batchRepository.getBatchByIdForUser = async () => ({
    project_id: "project-1",
    project_no: "PARC-001",
    project_status: "active",
  });
  batchRepository.releaseProject = async (projectId, employeeId, txClient) => {
    assert.equal(projectId, "project-1");
    assert.equal(employeeId, managerUser.employee_id);
    assert.equal(txClient, client);
  };
  accessControlService.requireOwningLeaderPair = async (user, projectId) => {
    assert.equal(user, managerUser);
    assert.equal(projectId, "project-1");
  };
  auditRepository.createAuditLog = async (entry) => audits.push(entry);
  clearServiceCache();

  try {
    const { releaseProjectForBatch } = require("../services/batchService");
    const result = await releaseProjectForBatch(managerUser, "batch-1");

    assert.equal(result.status, "completed");
    assert.deepEqual(tx, ["BEGIN", "COMMIT", "RELEASE"]);
    assert.equal(audits[0]?.actionType, "PROJECT_RELEASED");
  } finally {
    db.pool.connect = originals.connect;
    batchRepository.getBatchByIdForUser = originals.getBatchByIdForUser;
    batchRepository.releaseProject = originals.releaseProject;
    auditRepository.createAuditLog = originals.createAuditLog;
    accessControlService.requireOwningLeaderPair = originals.requireOwningLeaderPair;
    clearServiceCache();
  }
});
