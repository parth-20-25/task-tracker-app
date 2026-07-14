const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { FIXTURE_TASK_CODES, PROJECT_TASK_CODES } = require("../lib/design2dCompletionTasks");

function installGateMocks({ department, fixtures = [], tasks = [] }) {
  const repository = require("../repositories/design2dCompletionTaskRepository");
  const originals = {
    getDepartment: repository.getDesign2DCompletionProjectDepartment,
    listFixtures: repository.listProjectFixturesWith2DStatus,
    listTasks: repository.listDesign2DCompletionTasks,
  };
  const calls = { fixtures: 0, tasks: 0 };

  repository.getDesign2DCompletionProjectDepartment = async () => department;
  repository.listProjectFixturesWith2DStatus = async () => {
    calls.fixtures += 1;
    return fixtures;
  };
  repository.listDesign2DCompletionTasks = async () => {
    calls.tasks += 1;
    return tasks;
  };
  delete require.cache[require.resolve("../services/design2dCompletionTaskService")];

  return {
    calls,
    service: require("../services/design2dCompletionTaskService"),
    restore() {
      repository.getDesign2DCompletionProjectDepartment = originals.getDepartment;
      repository.listProjectFixturesWith2DStatus = originals.listFixtures;
      repository.listDesign2DCompletionTasks = originals.listTasks;
      delete require.cache[require.resolve("../services/design2dCompletionTaskService")];
    },
  };
}

function approvedTask(code, fixtureId = null) {
  return {
    id: `${fixtureId || "project"}-${code}`,
    scope_type: fixtureId ? "fixture" : "project",
    fixture_id: fixtureId,
    completion_task_code: code,
    completion_task_revision: 0,
    status: "closed",
    verification_status: "approved",
  };
}

test("the 2D completion release gate does not alter Control or other department completion", async () => {
  const mocks = installGateMocks({
    department: { department_id: "control", department_name: "Control" },
  });

  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("control-project"), true);
    assert.deepEqual(mocks.calls, { fixtures: 0, tasks: 0 });
  } finally {
    mocks.restore();
  }
});

test("the backend blocks Design project completion while mandatory completion tasks are missing", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [{
      fixture_id: "fixture-1",
      fixture_no: "FX-1",
      two_d_complete: true,
      workflow_complete: true,
    }],
    tasks: [],
  });

  try {
    await assert.rejects(
      () => mocks.service.assertDesign2DCompletionProjectReady("design-project"),
      (error) => error.statusCode === 409 && /Drafting Checking/.test(error.message),
    );
  } finally {
    mocks.restore();
  }
});

test("the backend allows Design completion when all latest mandatory revisions are approved", async () => {
  const fixtureId = "fixture-1";
  const tasks = [
    ...FIXTURE_TASK_CODES.map((code) => approvedTask(code, fixtureId)),
    ...PROJECT_TASK_CODES.map((code) => approvedTask(code)),
  ];
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [{
      fixture_id: fixtureId,
      fixture_no: "FX-1",
      two_d_complete: true,
      workflow_complete: true,
    }],
    tasks,
  });

  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("design-project"), true);
  } finally {
    mocks.restore();
  }
});
