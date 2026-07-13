const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const DEPARTMENT_ID = "design";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function progressRow(stageName, stageOrder, status = "PENDING", extra = {}) {
  return {
    fixture_id: FIXTURE_ID,
    department_id: DEPARTMENT_ID,
    stage_name: stageName,
    stage_order: stageOrder,
    stage_version: 0,
    status,
    assigned_to: null,
    assigned_at: null,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
    updated_at: "2026-06-01T00:00:00.000Z",
    ...extra,
  };
}

function defaultProgress() {
  return [
    progressRow("Concept", 1, "APPROVED", { completed_at: "2026-06-01T08:00:00.000Z" }),
    progressRow("DAP", 2, "PENDING"),
    progressRow("3D Finish", 3, "REJECTED"),
    progressRow("2D Finish", 4, "PENDING"),
    progressRow("Release", 5, "PENDING", { revision_code: "REL00" }),
  ];
}

function workflowDefinition() {
  return {
    id: "workflow-design",
    name: "Design Workflow",
    department_id: DEPARTMENT_ID,
    stages: [
      { id: "stage-concept", name: "Concept", order: 1 },
      { id: "stage-dap", name: "DAP", order: 2 },
      { id: "stage-3d", name: "3D Finish", order: 3 },
      { id: "stage-2d", name: "2D Finish", order: 4 },
      { id: "stage-release", name: "Release", order: 5 },
    ],
  };
}

function clearServiceCache() {
  delete require.cache[require.resolve("../services/fixtureWorkflowService")];
}

function installReleaseMocks(options = {}) {
  const db = require("../db");
  const workflowRepository = require("../repositories/fixtureWorkflowRepository");
  const completionRepository = require("../repositories/designCompletionRepository");
  const contributionRepository = require("../repositories/designStageContributionRepository");

  const originals = {
    connect: db.pool.connect,
    getFixtureWithDepartment: workflowRepository.getFixtureWithDepartment,
    getFixtureWorkflowContext: workflowRepository.getFixtureWorkflowContext,
    getActiveWorkflowForDepartment: workflowRepository.getActiveWorkflowForDepartment,
    initProgressForFixture: workflowRepository.initProgressForFixture,
    getProgressForFixture: workflowRepository.getProgressForFixture,
    updateProgressRow: workflowRepository.updateProgressRow,
    approveStageAttempt: workflowRepository.approveStageAttempt,
    getLatestStageAttempt: workflowRepository.getLatestStageAttempt,
    markFixtureComplete: workflowRepository.markFixtureComplete,
    insertCompletionSnapshot: completionRepository.insertCompletionSnapshot,
    listStageContributions: contributionRepository.listStageContributions,
    insertStageContribution: contributionRepository.insertStageContribution,
    markRemainingContributionActual: contributionRepository.markRemainingContributionActual,
  };

  let committedProgress = clone(options.progress || defaultProgress());
  let transactionProgress = null;
  let fixtureContext = {
    fixture_id: FIXTURE_ID,
    fixture_no: "PARC25016001",
    project_id: PROJECT_ID,
    project_no: "PARC2501",
    project_name: "Project One",
    department_id: DEPARTMENT_ID,
    project_status: "active",
    revision_no: 0,
    is_legacy_workflow: false,
    is_workflow_complete: options.fixtureComplete === true,
  };
  let transactionFixture = null;
  let transactionSnapshots = null;

  const calls = {
    tx: [],
    progressUpdates: [],
    approvals: [],
    snapshots: [],
    markComplete: 0,
  };

  const client = {
    query: async (sql) => {
      const statement = String(sql).trim();
      calls.tx.push(statement);

      if (statement === "BEGIN") {
        transactionProgress = clone(committedProgress);
        transactionFixture = clone(fixtureContext);
        transactionSnapshots = [];
        return { rows: [], rowCount: 0 };
      }

      if (statement === "COMMIT") {
        committedProgress = clone(transactionProgress);
        fixtureContext = clone(transactionFixture);
        calls.snapshots.push(...transactionSnapshots);
        transactionProgress = null;
        transactionFixture = null;
        transactionSnapshots = null;
        return { rows: [], rowCount: 0 };
      }

      if (statement === "ROLLBACK") {
        transactionProgress = null;
        transactionFixture = null;
        transactionSnapshots = null;
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    },
    release: () => calls.tx.push("RELEASE"),
  };

  db.pool.connect = async () => client;
  workflowRepository.getFixtureWithDepartment = async () => ({ fixture_id: FIXTURE_ID, department_id: DEPARTMENT_ID });
  workflowRepository.getFixtureWorkflowContext = async (_fixtureId, txClient = null) => (
    txClient === client && transactionFixture ? clone(transactionFixture) : clone(fixtureContext)
  );
  workflowRepository.getActiveWorkflowForDepartment = async () => workflowDefinition();
  workflowRepository.initProgressForFixture = async (_fixtureId, departmentId, stages, txClient) => {
    assert.equal(txClient, client);
    for (const stage of stages) {
      if (!transactionProgress.some((row) => row.stage_name === stage.name)) {
        transactionProgress.push(progressRow(stage.name, stage.order, "PENDING", { department_id: departmentId }));
      }
    }
    if (!options.preserveProgressOrder) {
      transactionProgress.sort((left, right) => Number(left.stage_order) - Number(right.stage_order));
    }
  };
  workflowRepository.getProgressForFixture = async (_fixtureId, _departmentId, txClient = null) => (
    clone(txClient === client && transactionProgress ? transactionProgress : committedProgress)
  );
  workflowRepository.updateProgressRow = async (_fixtureId, stageName, fields, txClient) => {
    assert.equal(txClient, client);
    if (options.failOnStageName === stageName) {
      throw new Error(`forced update failure for ${stageName}`);
    }
    calls.progressUpdates.push({ stageName, fields: clone(fields) });
    const row = transactionProgress.find((entry) => entry.stage_name === stageName);
    Object.assign(row, clone(fields), { updated_at: "2026-06-26T00:00:00.000Z" });
  };
  workflowRepository.approveStageAttempt = async (_fixtureId, stageName, timestamp, txClient) => {
    assert.equal(txClient, client);
    calls.approvals.push({ stageName, timestamp });
  };
  workflowRepository.getLatestStageAttempt = async () => null;
  workflowRepository.markFixtureComplete = async (_fixtureId, txClient) => {
    assert.equal(txClient, client);
    calls.markComplete += 1;
    transactionFixture.is_workflow_complete = true;
  };
  completionRepository.insertCompletionSnapshot = async (snapshot, txClient) => {
    assert.equal(txClient, client);
    transactionSnapshots.push(clone(snapshot));
    return { id: `snapshot-${transactionSnapshots.length}`, captured_at: "2026-06-26T00:00:00.000Z" };
  };
  contributionRepository.listStageContributions = async () => [];
  contributionRepository.insertStageContribution = async () => null;
  contributionRepository.markRemainingContributionActual = async () => null;

  clearServiceCache();

  return {
    calls,
    getState() {
      return {
        progress: clone(committedProgress),
        fixture: clone(fixtureContext),
        snapshots: clone(calls.snapshots),
      };
    },
    restore() {
      db.pool.connect = originals.connect;
      workflowRepository.getFixtureWithDepartment = originals.getFixtureWithDepartment;
      workflowRepository.getFixtureWorkflowContext = originals.getFixtureWorkflowContext;
      workflowRepository.getActiveWorkflowForDepartment = originals.getActiveWorkflowForDepartment;
      workflowRepository.initProgressForFixture = originals.initProgressForFixture;
      workflowRepository.getProgressForFixture = originals.getProgressForFixture;
      workflowRepository.updateProgressRow = originals.updateProgressRow;
      workflowRepository.approveStageAttempt = originals.approveStageAttempt;
      workflowRepository.getLatestStageAttempt = originals.getLatestStageAttempt;
      workflowRepository.markFixtureComplete = originals.markFixtureComplete;
      completionRepository.insertCompletionSnapshot = originals.insertCompletionSnapshot;
      contributionRepository.listStageContributions = originals.listStageContributions;
      contributionRepository.insertStageContribution = originals.insertStageContribution;
      contributionRepository.markRemainingContributionActual = originals.markRemainingContributionActual;
      clearServiceCache();
    },
  };
}

test("release approves incomplete previous stages, completes release, and is idempotent", async () => {
  const mocks = installReleaseMocks();

  try {
    const { releaseFixtureWorkflow } = require("../services/fixtureWorkflowService");

    const firstResult = await releaseFixtureWorkflow({
      actor: { employee_id: "MGR-1" },
      fixtureId: FIXTURE_ID,
      departmentId: DEPARTMENT_ID,
    });

    assert.equal(firstResult.is_complete, true);
    assert.equal(firstResult.status, "APPROVED");

    const firstState = mocks.getState();
    assert.equal(firstState.fixture.is_workflow_complete, true);
    assert.deepEqual(firstState.progress.map((row) => [row.stage_name, row.status]), [
      ["Concept", "APPROVED"],
      ["DAP", "APPROVED"],
      ["3D Finish", "APPROVED"],
      ["2D Finish", "APPROVED"],
      ["Release", "APPROVED"],
    ]);
    assert.equal(firstState.progress[0].completed_at, "2026-06-01T08:00:00.000Z");
    assert.ok(firstState.progress.find((row) => row.stage_name === "Release").completed_at);
    assert.deepEqual(mocks.calls.progressUpdates.map((call) => call.stageName), ["DAP", "3D Finish", "2D Finish", "Release"]);
    assert.deepEqual(mocks.calls.approvals.map((call) => call.stageName), ["DAP", "3D Finish", "2D Finish", "Release"]);
    assert.equal(firstState.snapshots.length, 1);
    assert.equal(firstState.snapshots[0].trigger, "workflow_release");
    assert.equal(firstState.snapshots[0].payload.release.released_by, "MGR-1");
    assert.deepEqual(
      firstState.snapshots[0].payload.progress.map((row) => [row.stage_name, row.status]),
      firstState.progress.map((row) => [row.stage_name, "APPROVED"]),
    );

    const updateCount = mocks.calls.progressUpdates.length;
    const approvalCount = mocks.calls.approvals.length;
    const snapshotCount = firstState.snapshots.length;

    const secondResult = await releaseFixtureWorkflow({
      actor: { employee_id: "MGR-1" },
      fixtureId: FIXTURE_ID,
      departmentId: DEPARTMENT_ID,
    });

    assert.equal(secondResult.is_complete, true);
    assert.equal(mocks.calls.progressUpdates.length, updateCount);
    assert.equal(mocks.calls.approvals.length, approvalCount);
    assert.equal(mocks.getState().snapshots.length, snapshotCount);
  } finally {
    mocks.restore();
  }
});

test("ordinary non-release assignment validation still rejects unmet prerequisites", async () => {
  const mocks = installReleaseMocks({
    progress: [
      progressRow("3D Finish", 3, "PENDING"),
      progressRow("DAP", 2, "PENDING"),
      progressRow("Release", 4, "PENDING"),
    ],
    preserveProgressOrder: true,
  });

  try {
    const { validateAssignment } = require("../services/fixtureWorkflowService");
    const result = await validateAssignment(FIXTURE_ID, DEPARTMENT_ID);

    assert.equal(result.canAssign, false);
    assert.equal(result.reason, "Previous stage is not completed");
    assert.equal(mocks.calls.tx.includes("ROLLBACK"), false);
  } finally {
    mocks.restore();
  }
});

test("release rolls back the entire transaction when a database step fails", async () => {
  const initialProgress = defaultProgress();
  const mocks = installReleaseMocks({
    progress: initialProgress,
    failOnStageName: "3D Finish",
  });

  try {
    const { releaseFixtureWorkflow } = require("../services/fixtureWorkflowService");

    await assert.rejects(
      () => releaseFixtureWorkflow({
        actor: { employee_id: "MGR-1" },
        fixtureId: FIXTURE_ID,
        departmentId: DEPARTMENT_ID,
      }),
      /forced update failure for 3D Finish/,
    );

    const state = mocks.getState();
    assert.deepEqual(state.progress, initialProgress);
    assert.equal(state.fixture.is_workflow_complete, false);
    assert.equal(state.snapshots.length, 0);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
    assert.equal(mocks.calls.tx.includes("COMMIT"), false);
  } finally {
    mocks.restore();
  }
});