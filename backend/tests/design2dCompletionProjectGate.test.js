const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { FIXTURE_TASK_CODES, PROJECT_TASK_CODES, DESIGN_2D_COMPLETION_TASKS } = require("../lib/design2dCompletionTasks");

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

function completionTask(code, overrides = {}) {
  const definition = DESIGN_2D_COMPLETION_TASKS[code];
  const scope = overrides.scope_type || definition.scope;
  return {
    id: code,
    title: `${definition.displayName} 00`,
    task_type: "design_2d_completion",
    scope_type: scope,
    fixture_id: scope === "fixture" ? "fixture-1" : null,
    completion_task_code: code,
    completion_task_revision: 0,
    status: "closed",
    verification_status: "approved",
    ...overrides,
  };
}

function approvedMandatoryTasks() {
  return [
    ...FIXTURE_TASK_CODES.map((code) => completionTask(code)),
    ...PROJECT_TASK_CODES
      .filter((code) => DESIGN_2D_COMPLETION_TASKS[code].isMandatory)
      .map((code) => completionTask(code, { scope_type: "project", fixture_id: null })),
  ];
}

test("the 2D completion gate does not alter Control or other departments", async () => {
  const mocks = installGateMocks({ department: { department_id: "control", department_name: "Control" } });
  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("control-project"), true);
    assert.deepEqual(mocks.calls, { fixtures: 0, tasks: 0 });
  } finally {
    mocks.restore();
  }
});

test("a completed original Design workflow is blocked until mandatory completion activities are approved", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [completedFixture],
    tasks: [],
  });
  try {
    await assert.rejects(
      () => mocks.service.assertDesign2DCompletionProjectReady("design-project"),
      (error) => error.statusCode === 409 && /Drafting Checking 00 is incomplete/.test(error.message),
    );
  } finally {
    mocks.restore();
  }
});

test("a created active mandatory completion activity must finish before the project itself closes", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [completedFixture],
    tasks: [
      ...approvedMandatoryTasks().filter((task) => task.completion_task_code !== "FIXTURE_IGES"),
      completionTask("FIXTURE_IGES", {
        status: "in_progress",
        verification_status: "pending",
      }),
    ],
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

test("approved mandatory completion activities close the Design project without requiring optional Mimic", async () => {
  const mocks = installGateMocks({
    department: { department_id: "design", department_name: "Design" },
    fixtures: [completedFixture],
    tasks: approvedMandatoryTasks(),
  });
  try {
    assert.equal(await mocks.service.assertDesign2DCompletionProjectReady("design-project"), true);
    assert.equal(completedFixture.workflow_complete, true);
  } finally {
    mocks.restore();
  }
});