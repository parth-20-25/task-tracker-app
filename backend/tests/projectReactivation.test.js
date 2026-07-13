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
    restoreProjectWorkflowForReactivation: batchRepository.restoreProjectWorkflowForReactivation,
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
      clearServiceCache();
    },
  };
}

function installReleaseGateMocks(unreleasedFixtures, { lockedStatus = "active" } = {}) {
  const db = require("../db");
  const batchRepository = require("../repositories/batchRepository");
  const auditRepository = require("../repositories/auditRepository");
  const releaseRepository = require("../repositories/fixtureReleaseDeliverablesRepository");

  const originals = {
    connect: db.pool.connect,
    getBatchByIdForUser: batchRepository.getBatchByIdForUser,
    lockProjectForRelease: batchRepository.lockProjectForRelease,
    releaseProject: batchRepository.releaseProject,
    createAuditLog: auditRepository.createAuditLog,
    listUnreleasedProjectFixtures: releaseRepository.listUnreleasedProjectFixtures,
  };

  const tx = [];
  let releaseCalls = 0;
  let auditCalls = 0;
  const client = {
    query: async (sql) => {
      tx.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release: () => tx.push("RELEASE"),
  };
  const project = {
    project_id: "project-1",
    project_no: "PARC-001",
    project_status: "active",
    department_id: "design",
    project_created_by_user_id: "OWNER-1",
  };

  db.pool.connect = async () => client;
  batchRepository.getBatchByIdForUser = async () => project;
  batchRepository.lockProjectForRelease = async (projectId, txClient) => {
    assert.equal(projectId, project.project_id);
    assert.equal(txClient, client);
    tx.push("LOCK_PROJECT");
    return { project_id: projectId, project_status: lockedStatus };
  };
  batchRepository.releaseProject = async () => {
    tx.push("RELEASE_PROJECT");
    releaseCalls += 1;
  };
  releaseRepository.listUnreleasedProjectFixtures = async (projectId, txClient) => {
    assert.equal(projectId, project.project_id);
    assert.equal(txClient, client);
    tx.push("CHECK_FIXTURES");
    return unreleasedFixtures;
  };
  auditRepository.createAuditLog = async () => {
    auditCalls += 1;
  };

  clearServiceCache();

  return {
    tx,
    getReleaseCalls: () => releaseCalls,
    getAuditCalls: () => auditCalls,
    restore() {
      db.pool.connect = originals.connect;
      batchRepository.getBatchByIdForUser = originals.getBatchByIdForUser;
      batchRepository.lockProjectForRelease = originals.lockProjectForRelease;
      batchRepository.releaseProject = originals.releaseProject;
      auditRepository.createAuditLog = originals.createAuditLog;
      releaseRepository.listUnreleasedProjectFixtures = originals.listUnreleasedProjectFixtures;
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

test("project uploader can reactivate without special lifecycle permissions", async () => {
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

test("project release is blocked until every fixture is explicitly released", async () => {
  const mocks = installReleaseGateMocks([
    { fixture_id: "fixture-1", fixture_no: "FX-001" },
  ]);

  try {
    const { releaseProjectForBatch } = require("../services/batchService");
    await assert.rejects(
      () => releaseProjectForBatch(managerUser, "batch-1"),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.errorCode, "PROJECT_RELEASE_BLOCKED");
        assert.deepEqual(error.details, {
          code: "PROJECT_RELEASE_BLOCKED",
          blockers: [{
            code: "FIXTURE_NOT_RELEASED",
            fixture_id: "fixture-1",
            fixture_no: "FX-001",
            message: "FX-001 has not been released",
          }],
        });
        return true;
      },
    );

    assert.equal(mocks.getReleaseCalls(), 0);
    assert.equal(mocks.getAuditCalls(), 0);
    assert.deepEqual(mocks.tx, ["BEGIN", "LOCK_PROJECT", "CHECK_FIXTURES", "ROLLBACK", "RELEASE"]);
  } finally {
    mocks.restore();
  }
});

test("project release locks the project before checking fixtures and commits without mass mutation", async () => {
  const mocks = installReleaseGateMocks([]);

  try {
    const { releaseProjectForBatch } = require("../services/batchService");
    const result = await releaseProjectForBatch(managerUser, "batch-1");

    assert.equal(result.status, "completed");
    assert.equal(mocks.getReleaseCalls(), 1);
    assert.equal(mocks.getAuditCalls(), 1);
    assert.deepEqual(mocks.tx, [
      "BEGIN",
      "LOCK_PROJECT",
      "CHECK_FIXTURES",
      "RELEASE_PROJECT",
      "COMMIT",
      "RELEASE",
    ]);
  } finally {
    mocks.restore();
  }
});

test("project release rechecks terminal state after taking the project lock", async () => {
  const mocks = installReleaseGateMocks([], { lockedStatus: "completed" });

  try {
    const { releaseProjectForBatch } = require("../services/batchService");
    const result = await releaseProjectForBatch(managerUser, "batch-1");

    assert.equal(result.status, "completed");
    assert.equal(mocks.getReleaseCalls(), 0);
    assert.equal(mocks.getAuditCalls(), 0);
    assert.deepEqual(mocks.tx, ["BEGIN", "LOCK_PROJECT", "COMMIT", "RELEASE"]);
  } finally {
    mocks.restore();
  }
});

test("project release lock uses a row-level FOR UPDATE lock", async () => {
  const statements = [];
  const client = {
    query: async (sql, params) => {
      statements.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      return { rows: [{ project_id: "project-1", project_status: "active" }], rowCount: 1 };
    },
  };
  const { lockProjectForRelease } = require("../repositories/batchRepository");

  const project = await lockProjectForRelease("project-1", client);

  assert.equal(project.project_status, "active");
  assert.match(statements[0].sql, /FROM design\.projects WHERE id = \$1 FOR UPDATE$/);
  assert.deepEqual(statements[0].params, ["project-1", "active"]);
});
test("project release repository does not mutate fixture, workflow, or task state", async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim().toLowerCase());
      return { rows: [], rowCount: 1 };
    },
  };
  const { releaseProject } = require("../repositories/batchRepository");

  await releaseProject("project-1", "MGR-1", client);

  assert.ok(statements.some((sql) => (
    sql.startsWith("insert into design.workflow_completion_snapshots ")
  )));
  const updateStatements = statements.filter((sql) => sql.startsWith("update "));
  assert.equal(updateStatements.length, 1);
  assert.match(updateStatements[0], /^update design\.projects /);
  assert.equal(statements.some((sql) => sql.startsWith("update design.fixtures ")), false);
  assert.equal(statements.some((sql) => sql.startsWith("update fixture_workflow_progress ")), false);
  assert.equal(statements.some((sql) => sql.startsWith("update tasks ")), false);
});
