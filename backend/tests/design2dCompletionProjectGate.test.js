const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

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

const completedFixture = {
  fixture_id: "fixture-1",
  fixture_no: "FX-1",
  two_d_complete: true,
  workflow_complete: true,
};

test("the 2D completion gate does not alter Control or other departments", async () => {
  const mocks = installGateMocks({ department: { department_id: "control", department_name: "Control" } });
  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("control-project"), true);
    assert.deepEqual(mocks.calls, { fixtures: 0, tasks: 0 });
  } finally {
    mocks.restore();
  }
});

test("a completed original Design workflow is not blocked by activities that were never requested", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [completedFixture],
    tasks: [],
  });
  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("design-project"), true);
  } finally {
    mocks.restore();
  }
});

test("a created active completion activity must finish before the project itself closes", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [completedFixture],
    tasks: [{
      id: 1,
      title: "IGES 00",
      task_type: "design_2d_completion",
      scope_type: "fixture",
      fixture_id: "fixture-1",
      completion_task_code: "FIXTURE_IGES",
      completion_task_revision: 0,
      status: "in_progress",
      verification_status: "pending",
    }],
  });
  try {
    await assert.rejects(
      () => mocks.service.assertDesign2DCompletionProjectReady("design-project"),
      (error) => error.statusCode === 409 && /IGES 00 is incomplete/.test(error.message),
    );
  } finally {
    mocks.restore();
  }
});

test("an approved completion activity does not mutate or block the completed original fixture", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [completedFixture],
    tasks: [{
      id: 1,
      title: "Drafting Checking 00",
      task_type: "design_2d_completion",
      scope_type: "fixture",
      fixture_id: "fixture-1",
      completion_task_code: "FIXTURE_DRAFTING_CHECKING",
      completion_task_revision: 0,
      status: "closed",
      verification_status: "approved",
    }],
  });
  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("design-project"), true);
    assert.equal(completedFixture.workflow_complete, true);
  } finally {
    mocks.restore();
  }
});
