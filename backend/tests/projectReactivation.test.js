const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

function clearServiceCache() {
  delete require.cache[require.resolve("../services/batchService")];
}

function installReactivationMocks({ projectContext, reactivatedProject, auditSink = [] }) {
  const db = require("../db");
  const batchRepository = require("../repositories/batchRepository");
  const auditRepository = require("../repositories/auditRepository");

  const originals = {
    connect: db.pool.connect,
    getProjectLifecycleContextByIdForUser: batchRepository.getProjectLifecycleContextByIdForUser,
    reactivateProjectForModification: batchRepository.reactivateProjectForModification,
    createAuditLog: auditRepository.createAuditLog,
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
      auditRepository.createAuditLog = originals.createAuditLog;
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
    });
    assert.ok(Date.parse(mocks.auditSink[0].metadata.reactivated_at));
    assert.ok(mocks.tx.some((entry) => entry === "BEGIN"));
    assert.ok(mocks.tx.some((entry) => entry === "COMMIT"));
  } finally {
    mocks.restore();
  }
});

test("normal employees cannot reactivate released projects", async () => {
  const mocks = installReactivationMocks({
    projectContext: releasedProject,
    reactivatedProject: null,
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    await assert.rejects(
      () => reactivateProjectForModificationById(employeeUser, "project-1", { reason: "other" }),
      /permission to reactivate/,
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

test("active projects cannot use the reactivation path", async () => {
  const mocks = installReactivationMocks({
    projectContext: {
      ...releasedProject,
      project_status: "active",
      is_modified: true,
    },
    reactivatedProject: null,
  });

  try {
    const { reactivateProjectForModificationById } = require("../services/batchService");
    await assert.rejects(
      () => reactivateProjectForModificationById(managerUser, "project-1", { reason: "customer_modification" }),
      /Only on-hold, released, or completed projects/,
    );
    assert.equal(mocks.auditSink.length, 0);
    assert.equal(mocks.tx.length, 0);
  } finally {
    mocks.restore();
  }
});
