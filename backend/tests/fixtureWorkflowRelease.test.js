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

function readyProgress(releaseStatus = "PENDING") {
  return [
    progressRow("Concept", 1, "APPROVED", { completed_at: "2026-06-01T08:00:00.000Z" }),
    progressRow("DAP", 2, "APPROVED", { completed_at: "2026-06-02T08:00:00.000Z" }),
    progressRow("3D Finish", 3, "APPROVED", { completed_at: "2026-06-03T08:00:00.000Z" }),
    progressRow("2D Finish", 4, "APPROVED", { completed_at: "2026-06-04T08:00:00.000Z" }),
    progressRow("Release", 5, releaseStatus, {
      completed_at: releaseStatus === "APPROVED" ? "2026-06-05T08:00:00.000Z" : null,
      revision_code: "REL00",
    }),
  ];
}

function submitted2DProgress() {
  const progress = readyProgress();
  progress[3] = progressRow("2D Finish", 4, "SUBMITTED_FOR_VERIFICATION", {
    assigned_to: "2D-1",
    completed_at: "2026-06-04T08:00:00.000Z",
  });
  return progress;
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
  const releaseDeliverablesService = require("../services/fixtureReleaseDeliverablesService");
  const revisionService = require("../services/designRevisionService");

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
    markFixtureIncomplete: workflowRepository.markFixtureIncomplete,
    listFixtureRevisions: workflowRepository.listFixtureRevisions,
    insertCompletionSnapshot: completionRepository.insertCompletionSnapshot,
    listStageContributions: contributionRepository.listStageContributions,
    listContributionsForFixtures: contributionRepository.listContributionsForFixtures,
    insertStageContribution: contributionRepository.insertStageContribution,
    markRemainingContributionActual: contributionRepository.markRemainingContributionActual,
    ensureFixtureReleasePackage: releaseDeliverablesService.ensureFixtureReleasePackage,
    getFixtureReleaseReadiness: releaseDeliverablesService.getFixtureReleaseReadiness,
    executeDesignStageRework: revisionService.executeDesignStageRework,
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
    markIncomplete: 0,
    reworks: [],
    packageEnsures: [],
    readinessChecks: [],
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
  workflowRepository.markFixtureIncomplete = async (_fixtureId, txClient) => {
    assert.equal(txClient, client);
    calls.markIncomplete += 1;
    transactionFixture.is_workflow_complete = false;
  };
  workflowRepository.listFixtureRevisions = async () => [];
  completionRepository.insertCompletionSnapshot = async (snapshot, txClient) => {
    assert.equal(txClient, client);
    transactionSnapshots.push(clone(snapshot));
    return { id: `snapshot-${transactionSnapshots.length}`, captured_at: "2026-06-26T00:00:00.000Z" };
  };
  contributionRepository.listStageContributions = async () => clone(options.stageContributions || []);
  contributionRepository.listContributionsForFixtures = async () => [];
  contributionRepository.insertStageContribution = async () => null;
  contributionRepository.markRemainingContributionActual = async () => null;
  releaseDeliverablesService.ensureFixtureReleasePackage = async (input, txClient) => {
    calls.packageEnsures.push({ ...clone(input), clientMatched: txClient === client });
    return {
      id: "release-package-1",
      fixture_id: FIXTURE_ID,
      status: "IN_PROGRESS",
      deliverables: [],
    };
  };
  releaseDeliverablesService.getFixtureReleaseReadiness = async (fixtureId, progressRows, txClient) => {
    calls.readinessChecks.push({
      fixtureId,
      progress: clone(progressRows),
      clientMatched: txClient === client,
    });
    return {
      package: { id: "release-package-1", fixture_id: FIXTURE_ID, status: "READY_FOR_RELEASE" },
      status: "READY_FOR_RELEASE",
      blockers: clone(options.releaseBlockers || []),
    };
  };

  revisionService.executeDesignStageRework = async (input) => {
    calls.reworks.push(clone(input));
    const target = committedProgress.find((stage) => (
      stage.stage_name === input.targetStageName
      || Number(stage.stage_order) === Number(input.targetStageOrder)
    ));
    if (!target) {
      throw new Error("Mock rework target was not found");
    }
    if (target.status === "APPROVED") {
      target.stage_version = Number(target.stage_version || 0) + 1;
    }
    Object.assign(target, {
      status: "PENDING",
      assigned_to: null,
      assigned_at: null,
      started_at: null,
      completed_at: null,
      duration_minutes: null,
      updated_at: "2026-06-27T00:00:00.000Z",
    });
    fixtureContext.revision_no += 1;
    return { revisionCode: "REL01", stageVersion: target.stage_version };
  };
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
      workflowRepository.markFixtureIncomplete = originals.markFixtureIncomplete;
      workflowRepository.listFixtureRevisions = originals.listFixtureRevisions;
      completionRepository.insertCompletionSnapshot = originals.insertCompletionSnapshot;
      contributionRepository.listStageContributions = originals.listStageContributions;
      contributionRepository.listContributionsForFixtures = originals.listContributionsForFixtures;
      contributionRepository.insertStageContribution = originals.insertStageContribution;
      contributionRepository.markRemainingContributionActual = originals.markRemainingContributionActual;
      releaseDeliverablesService.ensureFixtureReleasePackage = originals.ensureFixtureReleasePackage;
      releaseDeliverablesService.getFixtureReleaseReadiness = originals.getFixtureReleaseReadiness;
      revisionService.executeDesignStageRework = originals.executeDesignStageRework;
      clearServiceCache();
    },
  };
}

test("release returns structured blockers and performs no mutations while readiness is unresolved", async () => {
  const initialProgress = defaultProgress();
  const blockers = [
    {
      code: "MAIN_WORKFLOW_INCOMPLETE",
      stage: "DAP",
      message: "DAP is not approved",
    },
    {
      code: "DELIVERABLE_PENDING_APPROVAL",
      deliverable: "CMM_DATA",
      message: "CMM Data is pending approval",
    },
  ];
  const mocks = installReleaseMocks({ progress: initialProgress, releaseBlockers: blockers });

  try {
    const { releaseFixtureWorkflow } = require("../services/fixtureWorkflowService");

    await assert.rejects(
      () => releaseFixtureWorkflow({
        actor: { employee_id: "MGR-1" },
        fixtureId: FIXTURE_ID,
        departmentId: DEPARTMENT_ID,
      }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.errorCode, "FIXTURE_RELEASE_BLOCKED");
        assert.equal(error.details?.code, "FIXTURE_RELEASE_BLOCKED");
        assert.deepEqual(error.details?.blockers, blockers);
        return true;
      },
    );

    assert.deepEqual(mocks.getState().progress, initialProgress);
    assert.equal(mocks.getState().fixture.is_workflow_complete, false);
    assert.equal(mocks.calls.progressUpdates.length, 0);
    assert.equal(mocks.calls.approvals.length, 0);
    assert.equal(mocks.calls.markComplete, 0);
    assert.equal(mocks.getState().snapshots.length, 0);
    assert.equal(mocks.calls.readinessChecks.length, 1);
    assert.equal(mocks.calls.readinessChecks[0].clientMatched, true);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
    assert.equal(mocks.calls.tx.includes("COMMIT"), false);
  } finally {
    mocks.restore();
  }
});

test("ready release approves only Release and repeated release is idempotent", async () => {
  const initialProgress = readyProgress();
  const mocks = installReleaseMocks({ progress: initialProgress });

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
    assert.deepEqual(firstState.progress.slice(0, 4), initialProgress.slice(0, 4));
    assert.equal(firstState.progress[4].status, "APPROVED");
    assert.ok(firstState.progress[4].completed_at);
    assert.deepEqual(mocks.calls.progressUpdates.map((call) => call.stageName), ["Release"]);
    assert.deepEqual(mocks.calls.approvals.map((call) => call.stageName), ["Release"]);
    assert.equal(mocks.calls.markComplete, 1);
    assert.equal(firstState.snapshots.length, 1);
    assert.equal(firstState.snapshots[0].trigger, "workflow_release");
    assert.equal(firstState.snapshots[0].payload.release.released_by, "MGR-1");
    assert.equal(mocks.calls.readinessChecks.length, 1);

    const secondResult = await releaseFixtureWorkflow({
      actor: { employee_id: "MGR-1" },
      fixtureId: FIXTURE_ID,
      departmentId: DEPARTMENT_ID,
    });

    assert.equal(secondResult.is_complete, true);
    assert.deepEqual(mocks.calls.progressUpdates.map((call) => call.stageName), ["Release"]);
    assert.deepEqual(mocks.calls.approvals.map((call) => call.stageName), ["Release"]);
    assert.equal(mocks.calls.markComplete, 1);
    assert.equal(mocks.getState().snapshots.length, 1);
    assert.equal(mocks.calls.readinessChecks.length, 1);
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

test("release rolls back the entire transaction when the Release-stage update fails", async () => {
  const initialProgress = readyProgress();
  const mocks = installReleaseMocks({
    progress: initialProgress,
    failOnStageName: "Release",
  });

  try {
    const { releaseFixtureWorkflow } = require("../services/fixtureWorkflowService");

    await assert.rejects(
      () => releaseFixtureWorkflow({
        actor: { employee_id: "MGR-1" },
        fixtureId: FIXTURE_ID,
        departmentId: DEPARTMENT_ID,
      }),
      /forced update failure for Release/,
    );

    const state = mocks.getState();
    assert.deepEqual(state.progress, initialProgress);
    assert.equal(state.fixture.is_workflow_complete, false);
    assert.equal(state.snapshots.length, 0);
    assert.equal(mocks.calls.markComplete, 0);
    assert.equal(mocks.calls.readinessChecks.length, 1);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
    assert.equal(mocks.calls.tx.includes("COMMIT"), false);
  } finally {
    mocks.restore();
  }
});

test("an already released fixture remains unchanged", async () => {
  const initialProgress = readyProgress("APPROVED");
  const mocks = installReleaseMocks({
    progress: initialProgress,
    fixtureComplete: true,
  });

  try {
    const { releaseFixtureWorkflow } = require("../services/fixtureWorkflowService");
    const result = await releaseFixtureWorkflow({
      actor: { employee_id: "MGR-1" },
      fixtureId: FIXTURE_ID,
      departmentId: DEPARTMENT_ID,
    });

    assert.equal(result.is_complete, true);
    assert.deepEqual(mocks.getState().progress, initialProgress);
    assert.equal(mocks.getState().fixture.is_workflow_complete, true);
    assert.equal(mocks.calls.progressUpdates.length, 0);
    assert.equal(mocks.calls.approvals.length, 0);
    assert.equal(mocks.calls.markComplete, 0);
    assert.equal(mocks.getState().snapshots.length, 0);
    assert.equal(mocks.calls.readinessChecks.length, 0);
  } finally {
    mocks.restore();
  }
});

test("normal 2D task approval creates the release package with the approving actor", async () => {
  const mocks = installReleaseMocks({
    progress: submitted2DProgress(),
    stageContributions: [{
      id: "contribution-1",
      contribution_kind: "ACTUAL",
      contribution_percent: 100,
    }],
  });

  try {
    const { advanceWorkflowAfterTaskApproval } = require("../services/fixtureWorkflowService");
    await advanceWorkflowAfterTaskApproval({
      fixture_id: FIXTURE_ID,
      department_id: DEPARTMENT_ID,
      task_id: "task-2d",
      actor_employee_id: "MGR-1",
    });

    const state = mocks.getState();
    assert.equal(state.progress.find((row) => row.stage_name === "2D Finish").status, "APPROVED");
    assert.equal(state.progress.find((row) => row.stage_name === "Release").status, "PENDING");
    assert.deepEqual(mocks.calls.progressUpdates.map((call) => call.stageName), ["2D Finish", "Release"]);
    assert.deepEqual(mocks.calls.approvals.map((call) => call.stageName), ["2D Finish"]);
    assert.deepEqual(mocks.calls.packageEnsures, [{
      fixtureId: FIXTURE_ID,
      createdBy: "MGR-1",
      clientMatched: true,
    }]);
    assert.equal(mocks.calls.markComplete, 0);
  } finally {
    mocks.restore();
  }
});

test("task approval cannot advance or approve the Release stage", async () => {
  const progress = readyProgress("SUBMITTED_FOR_VERIFICATION");
  progress[4].assigned_to = "2D-1";
  const mocks = installReleaseMocks({ progress });

  try {
    const { advanceWorkflowAfterTaskApproval } = require("../services/fixtureWorkflowService");
    await assert.rejects(
      () => advanceWorkflowAfterTaskApproval({
        fixture_id: FIXTURE_ID,
        department_id: DEPARTMENT_ID,
        task_id: "stale-release-task",
        actor_employee_id: "MGR-1",
      }),
      /Release can only be completed through the workflow release action/,
    );

    assert.deepEqual(mocks.getState().progress, progress);
    assert.equal(mocks.calls.progressUpdates.length, 0);
    assert.equal(mocks.calls.approvals.length, 0);
    assert.equal(mocks.calls.markComplete, 0);
    assert.equal(mocks.calls.readinessChecks.length, 0);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
  } finally {
    mocks.restore();
  }
});
test("reopening a released Release stage marks the fixture incomplete and ensures a new package cycle", async () => {
  const mocks = installReleaseMocks({
    progress: readyProgress("APPROVED"),
    fixtureComplete: true,
  });

  try {
    const { reopenFixtureStage } = require("../services/fixtureWorkflowService");
    const result = await reopenFixtureStage({
      actor: { employee_id: "MGR-1" },
      fixtureId: FIXTURE_ID,
      departmentId: DEPARTMENT_ID,
      targetStageName: "Release",
      revisionType: "CUSTOMER_CHANGE",
      revisionReason: "Customer requested a release revision",
    });

    const state = mocks.getState();
    assert.equal(state.fixture.is_workflow_complete, false);
    assert.equal(state.progress.find((stage) => stage.stage_name === "Release").status, "PENDING");
    assert.equal(result.stages.find((stage) => stage.stage_name === "Release").status, "PENDING");
    assert.equal(mocks.calls.markIncomplete, 1);
    assert.equal(mocks.calls.reworks.length, 1);
    assert.deepEqual(mocks.calls.packageEnsures, [{
      fixtureId: FIXTURE_ID,
      createdBy: "MGR-1",
      clientMatched: true,
    }]);
    assert.equal(mocks.calls.tx.at(-2), "COMMIT");
    assert.equal(mocks.calls.tx.at(-1), "RELEASE");
  } finally {
    mocks.restore();
  }
});
